import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse, stringify } from 'yaml';
import ipaddr from 'ipaddr.js';
import { command } from '../dist/docker.js';
import { temporaryFilesystems } from '../dist/isolation.js';
import { runtimeEnvironment } from '../dist/runtime-environment.js';
import { timeoutSeconds } from '../examples/timeouts.mjs';
import { waitTaskContainer } from './container-task-deadline.mjs';

// Runs the shipped broker and the native DSH worker on separate container networks.
// This is transport acceptance, not a quality experiment or Controller recovery proof.
const repo = fileURLToPath(new URL('..', import.meta.url));
const root = path.resolve(process.argv[2] ?? '');
assert.ok(
  process.argv[2],
  'Usage: verify-egress-native.mjs <new-evidence-directory> [task-seconds] [model-http-seconds]',
);
const taskTimeoutSeconds = timeoutSeconds(process.argv[3]);
const httpTimeoutSeconds = timeoutSeconds(process.argv[4], taskTimeoutSeconds);
const image = process.env.SPARKVOLVE_TEST_IMAGE;
assert.match(image ?? '', /^sha256:[a-f0-9]{64}$/);
assert.ok(process.env.VENUS_API_KEY, 'VENUS_API_KEY is required in the trusted launcher environment');
const uid = process.getuid(),
  gid = process.getgid();
assert.ok(uid > 0, 'Run the acceptance launcher as a non-root user');
await mkdir(root);
for (const dir of ['broker', 'trace', 'work', 'launch']) await mkdir(path.join(root, dir));
const prefix = `he-native-egress-${randomUUID().slice(0, 8)}`;
const networks = [],
  containers = [];
const receipt = {
  startedAt: new Date().toISOString(),
  image,
  timeouts: { taskSeconds: taskTimeoutSeconds, modelHttpSeconds: httpTimeoutSeconds },
  passed: false,
  observations: {},
  artifacts: {},
};
const docker = (args, env = {}, timeoutMs = 30000) =>
  command('docker', args, { env: { ...process.env, ...env }, timeoutMs });
const json = async (file, value) => writeFile(path.join(root, file), JSON.stringify(value, null, 2) + '\n');
const inspect = async (name) => JSON.parse(await docker(['inspect', name]))[0];
async function network(kind, extra) {
  const name = `${prefix}-${kind}`;
  await docker(['network', 'create', ...extra, name]);
  networks.push(name);
  return JSON.parse(await docker(['network', 'inspect', name]))[0];
}
async function create(kind, network, cmd, mounts, env = {}, extra = []) {
  const name = `${prefix}-${kind}`;
  await docker(
    [
      'create',
      '--name',
      name,
      '--runtime=runc',
      '--entrypoint=',
      '--init',
      '--user',
      `${uid}:${gid}`,
      '--read-only',
      '--cap-drop=ALL',
      '--security-opt=no-new-privileges',
      '--pids-limit=256',
      '--memory=1536m',
      '--memory-swap=1536m',
      '--cpus=2',
      '--network',
      network,
      '--workdir=/workspace',
      ...Object.entries(
        temporaryFilesystems({ isolation: { user: { uid, gid }, tmpMiB: 128, homeMiB: 128 } }),
      ).flatMap(([target, options]) => ['--tmpfs', `${target}:${options}`]),
      ...mounts.flatMap(([source, target, writable]) => [
        '--mount',
        `type=bind,src=${source},dst=${target}${writable ? '' : ',readonly'}`,
      ]),
      ...Object.keys(env).flatMap((key) => ['--env', key]),
      ...extra,
      image,
      ...cmd,
    ],
    env,
  );
  containers.push(name);
  return name;
}
async function ready(name) {
  await docker(['start', name]);
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    const logs = await docker(['logs', name]);
    if (logs.includes('"event":"egress.ready"')) return;
    assert.equal((await inspect(name)).State.Running, true, 'Broker exited before readiness');
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw Error('Broker readiness timeout');
}
try {
  const isolated = await network('isolated', [
    '--internal',
    '--opt',
    'com.docker.network.bridge.gateway_mode_ipv4=isolated',
    '--opt',
    'com.docker.network.bridge.gateway_mode_ipv6=isolated',
  ]);
  const uplink = await network('uplink', []);
  const [base, bits] = ipaddr.parseCIDR(isolated.IPAM.Config[0].Subnet);
  assert.equal(base.kind(), 'ipv4');
  assert.ok(bits <= 30);
  const bytes = base.toByteArray();
  const integer = bytes.reduce((value, byte) => (value << 8n) + BigInt(byte), 0n) + 2n;
  const brokerIP = [24n, 16n, 8n, 0n].map((shift) => Number((integer >> shift) & 255n)).join('.');
  const model = JSON.parse(await readFile(path.join(repo, 'examples/venus/model.json'), 'utf8'));
  model.maxTokens = 1024;
  model.credentialEnv = [];
  const config = {
    bindAddress: brokerIP,
    port: 8080,
    routes: [
      {
        id: 'venus',
        path: '/v1/chat/completions',
        method: 'POST',
        upstream: 'https://venus.xfinfr.com/v1/chat/completions',
        addresses: { kind: 'public' },
        credential: { env: 'VENUS_API_KEY', header: 'authorization', prefix: 'Bearer ' },
        body: { kind: 'json', equals: { model: model.model }, maximum: { max_tokens: model.maxTokens } },
        maxRequestBytes: 2 * 1024 * 1024,
        timeoutSeconds: httpTimeoutSeconds,
      },
    ],
  };
  await json('launch/broker.json', config);
  const environment = parse(await readFile(path.join(repo, 'examples/venus/cordis.patch.yml'), 'utf8'));
  const provider = environment.find((entry) => entry.id === 'llm-pi-ai').config.providers.venus;
  provider.baseURL = 'http://evolution-egress:8080/v1';
  provider.apiKeyEnv = 'EGRESS_CLIENT_TOKEN';
  provider.timeoutMs = httpTimeoutSeconds * 1000;
  provider.streamIdleTimeoutMs = httpTimeoutSeconds * 1000;
  await writeFile(path.join(root, 'launch/environment.yml'), stringify(environment));
  await writeFile(path.join(root, 'launch/candidate.yml'), '[]\n');
  await json('launch/worker.json', {
    profile: 'sdk',
    model,
    bundle: null,
    patches: ['/launch/candidate.yml'],
    environmentPatch: '/launch/environment.yml',
    prompt:
      'Use your bash tool to run Python and calculate sum(range(11)). Write the result as JSON {"sum": <calculated value>} to /workspace/proof.json. Then reply briefly. This verifies a native tool invocation; do not access the network.',
    timeoutSeconds: taskTimeoutSeconds,
  });
  const broker = await create(
    'broker',
    uplink.Name,
    ['node', '/app/dist/runtime/egress.js', '/launch/broker.json', '/ledger/requests.jsonl'],
    [
      [path.join(repo, 'dist'), '/app/dist', false],
      [path.join(repo, 'node_modules/ipaddr.js'), '/app/node_modules/ipaddr.js', false],
      [path.join(root, 'launch/broker.json'), '/launch/broker.json', false],
      [path.join(root, 'broker'), '/ledger', true],
    ],
    { VENUS_API_KEY: process.env.VENUS_API_KEY },
  );
  await docker(['network', 'connect', '--ip', brokerIP, isolated.Name, broker]);
  await ready(broker);
  const wrapper = `
    import assert from 'node:assert/strict';
    import {readFile,writeFile} from 'node:fs/promises';
    import net from 'node:net';
    assert.equal(process.env.VENUS_API_KEY,undefined);
    assert.ok(!(await readFile('/proc/self/environ','utf8')).includes('VENUS_API_KEY='));
    await new Promise((resolve,reject)=>{const s=net.connect(443,'1.1.1.1');
      s.setTimeout(800,()=>{s.destroy();resolve();});s.once('error',()=>resolve());
      s.once('connect',()=>{s.destroy();reject(Error('Candidate has a direct public route'));});});
    const denied=await fetch('http://evolution-egress:8080/not-authorized');
    assert.equal(denied.status,403);
    await writeFile('/trace/boundary.json',JSON.stringify({credentialAbsent:true,directPublicDenied:true,unapprovedRouteDenied:true}));
    process.argv[2]='/launch/worker.json';
    await import('/app/dist/runtime/worker.js');
  `;
  const worker = await create(
    'worker',
    isolated.Name,
    ['node', '--input-type=module', '-e', wrapper],
    [
      [path.join(repo, 'dist'), '/app/dist', false],
      [path.join(root, 'launch'), '/launch', false],
      [path.join(root, 'trace'), '/trace', true],
      [path.join(root, 'work'), '/workspace', true],
    ],
    { ...runtimeEnvironment, EGRESS_CLIENT_TOKEN: 'local-broker-placeholder' },
    ['--dns=127.0.0.1', '--add-host', `evolution-egress:${brokerIP}`],
  );
  await docker(['start', worker]);
  assert.equal(
    await waitTaskContainer(docker, worker, taskTimeoutSeconds),
    '0',
    'Native worker failed; retain logs and receipt',
  );
  const actual = await inspect(worker);
  assert.deepEqual(Object.keys(actual.NetworkSettings.Networks), [isolated.Name]);
  assert.deepEqual(actual.HostConfig.Dns, ['127.0.0.1']);
  assert.ok(
    actual.Config.Env.every(
      (value) => !value.startsWith('VENUS_API_KEY=') && !value.includes(process.env.VENUS_API_KEY),
    ),
  );
  const result = JSON.parse(await readFile(path.join(root, 'trace/result.json'), 'utf8'));
  assert.ok(
    result.events.some((event) => event.type === 'tool/result'),
    'Native model must invoke a tool',
  );
  assert.deepEqual(JSON.parse(await readFile(path.join(root, 'work/proof.json'), 'utf8')), { sum: 55 });
  const candidateReceipt = JSON.parse(await readFile(path.join(root, 'trace/receipt.json'), 'utf8'));
  assert.equal(candidateReceipt.status, 'completed');
  const metrics = JSON.parse(await readFile(path.join(root, 'trace/metrics.json'), 'utf8'));
  assert.equal(metrics.failed, 0);
  assert.equal(metrics.unfinished, 0);
  await docker(['stop', '--time=5', broker]);
  assert.equal((await inspect(broker)).State.ExitCode, 0);
  const ledger = (await readFile(path.join(root, 'broker/requests.jsonl'), 'utf8'))
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  const starts = ledger.filter((event) => event.phase === 'started');
  const ends = ledger.filter((event) => event.phase === 'finished');
  assert.equal(starts.length, ends.length);
  for (const start of starts) assert.equal(ends.filter((event) => event.id === start.id).length, 1);
  const modelEnds = ends.filter((event) => event.route === 'venus');
  assert.ok(modelEnds.length >= 2);
  // Native SSE consumers may close HTTP after the completion sentinel. Keep that transport
  // cancellation visible; native turn completion and delivered output are checked separately.
  assert.ok(
    modelEnds.every(
      (event) => ['completed', 'cancelled'].includes(event.outcome) && event.upstreamStatus === 200,
    ),
  );
  assert.equal(metrics.results, modelEnds.length);
  receipt.observations = {
    nativeToolInvocation: true,
    delivered: { sum: 55 },
    credentialAbsent: true,
    directPublicDenied: true,
    unapprovedRouteDenied: true,
    brokerListensOnlyOn: brokerIP,
    modelRequests: modelEnds.length,
    started: starts.length,
    finished: ends.length,
    brokerExit: 0,
    transportOutcomes: modelEnds.map((event) => event.outcome),
    nativeMetrics: metrics,
    candidateNetwork: actual.HostConfig.NetworkMode,
    dns: actual.HostConfig.Dns,
    nativeReceipt: candidateReceipt,
  };
  for (const file of [
    'src/egress.ts',
    'src/runtime/egress.ts',
    'src/runtime/worker.ts',
    'src/telemetry.ts',
    'dist/egress.js',
    'dist/runtime/egress.js',
    'dist/runtime/worker.js',
    'dist/telemetry.js',
    'package-lock.json',
    'scripts/verify-egress-native.mjs',
  ])
    receipt.artifacts[file] = createHash('sha256')
      .update(await readFile(path.join(repo, file)))
      .digest('hex');
  receipt.passed = true;
} catch (error) {
  receipt.error = String(error);
  throw error;
} finally {
  const cleanupErrors = [];
  for (const name of containers.reverse()) {
    try {
      // docker inspect's Config.Env contains credentials, so persist only lifecycle fields.
      const actual = await inspect(name);
      await json(`${name}.state.json`, { id: actual.Id, image: actual.Image, state: actual.State });
      const logs = await promisify(execFile)('docker', ['logs', name], {
        timeout: 10000,
        maxBuffer: 4 * 1024 * 1024,
      });
      for (const channel of ['stdout', 'stderr']) {
        assert.ok(
          !logs[channel].includes(process.env.VENUS_API_KEY),
          'Credential unexpectedly found in logs',
        );
        await writeFile(path.join(root, `${name}.${channel}.log`), logs[channel]);
      }
    } catch (error) {
      cleanupErrors.push(String(error));
    }
    try {
      await docker(['rm', '--force', name]);
    } catch (error) {
      cleanupErrors.push(String(error));
    }
  }
  for (const name of networks.reverse()) {
    try {
      await docker(['network', 'rm', name]);
    } catch (error) {
      cleanupErrors.push(String(error));
    }
  }
  receipt.completedAt = new Date().toISOString();
  receipt.cleanupErrors = cleanupErrors;
  await json('receipt.json', receipt);
  if (cleanupErrors.length) throw new AggregateError(cleanupErrors, 'Acceptance cleanup failed');
}
console.log(JSON.stringify({ passed: receipt.passed, evidence: root, observations: receipt.observations }));
