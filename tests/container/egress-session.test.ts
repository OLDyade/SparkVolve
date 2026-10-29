import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, writeFile, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { EgressSession } from '../../src/egress-session.js';
import { Docker, command, type ContainerSpec } from '../../src/docker.js';
import { containerSpecification } from '../fixtures.js';
import { prepareExecution } from '../../src/execution.js';

test(
  'controlled egress: original network/broker recovery, credential boundary and terminal loss',
  { timeout: 120_000 },
  async (t) => {
    const image = process.env.SPARKVOLVE_TEST_IMAGE;
    assert.ok(image, 'SPARKVOLVE_TEST_IMAGE is required; real network acceptance cannot skip');
    const root = await mkdtemp(path.join(os.tmpdir(), 'he-egress-session-'));
    console.log(`Egress lifecycle evidence retained: ${root}`);
    const docker = new Docker(),
      isolation = containerSpecification().isolation;
    const secret = randomUUID();
    let requests = 0;
    const upstream = http.createServer((req, res) => {
      requests++;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ authenticated: req.headers.authorization === `Bearer ${secret}` }));
    });
    t.after(async () => {
      upstream.closeAllConnections();
      await new Promise<void>((resolve) => upstream.close(() => resolve()));
    });
    await new Promise<void>((resolve) => upstream.listen(0, '0.0.0.0', resolve));
    const address = upstream.address();
    assert.ok(address && typeof address !== 'string');
    // Docker's explicit host-gateway mapping supplies a fixture address, never a production fallback.
    const hostIP = (
      await command('docker', [
        'run',
        '--rm',
        '--network=bridge',
        '--add-host=host.docker.internal:host-gateway',
        image,
        'getent',
        'ahostsv4',
        'host.docker.internal',
      ])
    ).split(/\s+/)[0]!;
    const execution = `he-egress-worker-${randomUUID()}`;
    const sessionSpec = {
      root: path.join(root, 'gateway'),
      execution,
      image,
      isolation,
      timeoutSeconds: 60,
      routes: [
        {
          id: 'fixture',
          method: 'GET' as const,
          path: '/fixture',
          upstream: `http://${hostIP}:${address.port}/fixture`,
          addresses: { kind: 'exact' as const, values: [hostIP] },
          credential: { env: 'FIXTURE_KEY', header: 'authorization', prefix: 'Bearer ' },
          body: { kind: 'empty' as const },
          maxRequestBytes: 1024,
          timeoutSeconds: 5,
        },
      ],
    };
    const session = new EgressSession(sessionSpec);
    let intent: { broker: string; isolated: string; uplink: string } | undefined;
    const rogue = `he-egress-rogue-${randomUUID()}`;
    try {
      await session.prepare({ FIXTURE_KEY: secret });
      intent = JSON.parse(await readFile(path.join(sessionSpec.root, 'intent.json'), 'utf8'));
      assert.ok(intent);
      const brokerID = (await docker.configuration(intent.broker)).Id;
      const resolverFile = path.join(sessionSpec.root, 'resolv.conf');
      const resolver = await readFile(resolverFile, 'utf8');
      assert.equal(resolver, isolation.network.egressDns.map((ip) => `nameserver ${ip}\n`).join(''));
      const resolverMount = (await docker.configuration(intent.broker)).Mounts.find(
        (mount) => mount.Destination === '/etc/resolv.conf',
      );
      assert.equal(resolverMount?.RW, false);
      assert.equal(resolverMount?.Source, resolverFile);
      assert.equal(
        await command('docker', [
          'exec',
          intent.broker,
          'node',
          '-e',
          'process.stdout.write(require("node:fs").readFileSync("/etc/resolv.conf","utf8"))',
        ]),
        resolver.trim(),
      );
      await writeFile(resolverFile, 'nameserver 192.0.2.99\n');
      await assert.rejects(new EgressSession(sessionSpec).prepare({}), /resolver configuration changed/);
      assert.equal(await readFile(resolverFile, 'utf8'), 'nameserver 192.0.2.99\n');
      await writeFile(resolverFile, resolver); // End the explicit drift injection, preserving the same broker.
      await mkdir(path.join(root, 'work'));
      const worker: ContainerSpec = {
        name: execution,
        image,
        isolation,
        timeoutSeconds: 45,
        env: {},
        network: await session.candidateNetwork(),
        mounts: [{ source: path.join(root, 'work'), target: '/workspace', writable: true }],
        command: [
          'node',
          '--input-type=module',
          '-e',
          `
        import assert from 'node:assert/strict';
        import net from 'node:net';
        import {readFile,writeFile} from 'node:fs/promises';
        assert.equal(process.env.FIXTURE_KEY, undefined);
        const result=await fetch('http://evolution-egress:8080/fixture', {headers:{authorization:'forged'}});
        assert.equal(result.status,200);
        assert.deepEqual(await result.json(),{authenticated:true});
        assert.equal((await fetch('http://evolution-egress:8080/other')).status,403);
        await new Promise((resolve,reject)=>{const socket=net.connect(443,'1.1.1.1');
          socket.setTimeout(400,()=>{socket.destroy();resolve();});
          socket.on('error',()=>resolve());socket.on('connect',()=>{socket.destroy();reject(Error('direct public route'));});});
        await writeFile('/workspace/proof.json',JSON.stringify({credentialAbsent:true,authenticated:true,denied:true}));
        for(;;){try{await readFile('/workspace/release');break;}catch(e){if(e.code!=='ENOENT')throw e;}
          await new Promise(r=>setTimeout(r,30));}
      `,
        ],
      };
      await assert.rejects(
        prepareExecution(
          path.join(root, 'launch'),
          { execution },
          docker,
          session,
          async () => {
            throw Error('injected host interruption before worker creation');
          },
          {},
        ),
        /injected host interruption/,
      );
      assert.equal(await docker.inspect(execution), undefined);
      await prepareExecution(
        path.join(root, 'launch'),
        { execution },
        docker,
        new EgressSession(sessionSpec),
        async () => worker,
        {},
      );
      await command('docker', ['start', execution]);
      const workerID = (await docker.configuration(execution)).Id;
      const deadline = Date.now() + 15000;
      for (;;) {
        try {
          await readFile(path.join(root, 'work/proof.json'));
          break;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        }
        assert.ok((await docker.inspect(execution))?.Running, await command('docker', ['logs', execution]));
        assert.ok(Date.now() < deadline, 'Worker boundary proof timed out');
        await new Promise((resolve) => setTimeout(resolve, 40));
      }
      const recovered = new EgressSession(sessionSpec, new Docker());
      await recovered.verify(true);
      await recovered.prepare({}); // Ready recovery needs no credentials and creates no replacement.
      assert.equal((await docker.configuration(intent.broker)).Id, brokerID);
      assert.equal((await docker.configuration(execution)).Id, workerID);
      assert.equal(requests, 1);
      const abort = new AbortController();
      abort.abort(Error('host interrupted'));
      await assert.rejects(
        docker.collect(worker, path.join(root, 'interrupted'), abort.signal),
        /host interrupted/,
      );
      assert.ok((await docker.inspect(execution))?.Running);
      await writeFile(path.join(root, 'work/release'), 'done');
      assert.equal((await docker.collect(worker, path.join(root, 'worker-log'))).ExitCode, 0);
      await recovered.stop();
      await recovered.stop();
      await recovered.verify(false);
      await prepareExecution(
        path.join(root, 'launch'),
        { execution },
        docker,
        recovered,
        async () => worker,
        {},
      );
      await assert.rejects(recovered.prepare({}), /stopping or stopped/);
      const ledger = (await readFile(path.join(sessionSpec.root, 'ledger/requests.jsonl'), 'utf8'))
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
      assert.equal(ledger.filter((e) => e.phase === 'started').length, 2);
      assert.equal(ledger.filter((e) => e.phase === 'finished').length, 2);
      assert.ok(!JSON.stringify(ledger).includes(secret));
      assert.ok(!(await readFile(path.join(sessionSpec.root, 'observed.json'), 'utf8')).includes(secret));
      // A foreign endpoint invalidates the network rather than broadening its allowlist.
      await command('docker', [
        'create',
        '--name',
        rogue,
        '--network',
        intent.isolated,
        image,
        'sleep',
        '30',
      ]);
      await command('docker', ['start', rogue]);
      await assert.rejects(recovered.verify(false), /Unexpected container/);
      await command('docker', ['rm', '-f', rogue]);
      // A persisted broker identity cannot be resurrected by prepare or verify.
      await command('docker', ['rm', intent.broker]);
      await assert.rejects(recovered.verify(false), /Original egress broker missing/);
      assert.equal(await docker.inspect(intent.broker), undefined);
      await command('docker', ['rm', execution]);
      await assert.rejects(
        prepareExecution(path.join(root, 'launch'), { execution }, docker, recovered, async () => worker, {}),
        /Original execution container missing/,
      );
      assert.equal(await docker.inspect(execution), undefined);
      await writeFile(
        path.join(root, 'acceptance.json'),
        JSON.stringify(
          {
            passed: true,
            brokerID,
            workerID,
            requests,
            credentialAbsent: true,
            directPublicDenied: true,
            sameExecutionRecovered: true,
            foreignNetworkMemberRejected: true,
            missingBrokerRejected: true,
          },
          null,
          2,
        ),
      );
    } finally {
      for (const name of [execution, rogue, ...(intent ? [intent.broker] : [])])
        if (await docker.inspect(name)) await command('docker', ['rm', '-f', name]);
      if (intent)
        for (const name of [intent.isolated, intent.uplink]) await command('docker', ['network', 'rm', name]);
    }
  },
);
