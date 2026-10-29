import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { Docker, command, type ContainerReference, type ContainerSpec } from '../../src/docker.js';
import { prepareExecution } from '../../src/execution.js';
import { cancelExecutionTree, type ExecutionRegistration } from '../../src/cancellation.js';
import { EgressSession } from '../../src/egress-session.js';
import { containerSpecification } from '../fixtures.js';

test(
  'real cancellation stops only registered execution IDs, recovers removal and reclaims controlled egress',
  { timeout: 120_000 },
  async () => {
    const image = process.env.SPARKVOLVE_TEST_IMAGE;
    assert.ok(image, 'SPARKVOLVE_TEST_IMAGE required');
    const isolation = containerSpecification().isolation;
    const root = await mkdtemp(path.join(os.tmpdir(), 'he-real-cancellation-'));
    console.log(`Cancellation evidence retained: ${root}`);
    class InterruptRemoval extends Docker {
      interrupt = true;
      override async remove(reference: ContainerReference) {
        await super.remove(reference);
        if (this.interrupt) {
          this.interrupt = false;
          throw Error('injected post-removal interruption');
        }
      }
    }
    const docker = new InterruptRemoval();
    const registrations: ExecutionRegistration[] = [];
    const workers: ContainerSpec[] = [];
    for (const role of ['build', 'qa', 'optimizer', 'executor', 'scorer', 'probe'] as const) {
      const home = path.join(root, role);
      await mkdir(home);
      const input: ContainerSpec = {
        name: `he-cancel-${role}-${randomUUID()}`,
        image,
        isolation,
        timeoutSeconds: 300,
        env: {},
        mounts: [],
        network: 'none',
        command: ['node', '-e', 'console.log("original execution");setInterval(()=>{},1000)'],
      };
      const gateway =
        role === 'optimizer'
          ? new EgressSession(
              {
                root: path.join(home, 'egress'),
                execution: input.name,
                image,
                isolation,
                timeoutSeconds: 300,
                routes: [
                  {
                    id: 'fixture',
                    method: 'GET',
                    path: '/fixture',
                    upstream: 'https://example.org/',
                    addresses: { kind: 'public' },
                    credential: null,
                    body: { kind: 'empty' },
                    maxRequestBytes: 1,
                    timeoutSeconds: 1,
                  },
                ],
              },
              docker,
            )
          : null;
      const execution = await prepareExecution(
        home,
        { role },
        docker,
        gateway,
        async () => ({ ...input, network: gateway ? await gateway.candidateNetwork() : 'none' }),
        {},
      );
      workers.push(execution);
      registrations.push({ directory: role, role });
      await command('docker', ['start', execution.name]);
    }
    const originalIds = await Promise.all(workers.map((worker) => docker.executionReference(worker)));
    const observed = workers.find((worker) => worker.name.includes('-executor-'))!;
    const observation = new AbortController();
    const wait = docker.collect(observed, path.join(root, 'executor/observation'), observation.signal);
    const timer = setTimeout(() => observation.abort(Error('parent stopped observing')), 100);
    try {
      await assert.rejects(wait);
    } finally {
      clearTimeout(timer);
    }
    assert.equal((await docker.inspect(observed.name))?.Running, true);
    await assert.rejects(
      cancelExecutionTree(root, registrations, docker),
      /injected post-removal interruption/,
    );
    const receipt = await cancelExecutionTree(root, registrations, new Docker());
    assert.equal(receipt.executions.length, 6);
    for (const reference of originalIds) {
      assert.equal(await docker.inspect(reference.name), undefined);
      assert.ok(receipt.executions.some((execution) => execution.reference?.id === reference.id));
    }
    const egress = JSON.parse(await readFile(path.join(root, 'optimizer/egress/intent.json'), 'utf8'));
    assert.equal(await docker.inspect(egress.broker), undefined);
    const networks = (await command('docker', ['network', 'ls', '--format', '{{.ID}}'])).split('\n');
    assert.ok(!networks.some((id) => egress.isolatedId.startsWith(id) || egress.uplinkId.startsWith(id)));
    assert.deepEqual(await cancelExecutionTree(root, registrations, new Docker()), receipt);
    await assert.rejects(
      prepareExecution(
        path.join(root, 'executor'),
        { role: 'executor' },
        new Docker(),
        null,
        async () => observed,
        {},
      ),
      /explicitly cancelled/,
    );
  },
);

test(
  'real same-name replacement is never stopped or removed by the original cancellation authority',
  { timeout: 60_000 },
  async () => {
    const image = process.env.SPARKVOLVE_TEST_IMAGE;
    assert.ok(image, 'SPARKVOLVE_TEST_IMAGE required');
    const root = await mkdtemp(path.join(os.tmpdir(), 'he-cancel-replacement-'));
    console.log(`Replacement refusal evidence retained: ${root}`);
    const home = path.join(root, 'execution');
    await mkdir(home);
    class ReplaceBeforeStop extends Docker {
      replacement: ContainerReference | undefined;
      override async failureEvidence(input: ContainerSpec, directory: string, expected?: ContainerReference) {
        assert.ok(expected);
        await this.remove(expected);
        await this.create(input);
        this.replacement = await this.executionReference(input);
        await command('docker', ['start', this.replacement.id]);
        return super.failureEvidence(input, directory, expected);
      }
    }
    const docker = new ReplaceBeforeStop();
    const spec: ContainerSpec = {
      name: `he-cancel-replacement-${randomUUID()}`,
      image,
      isolation: containerSpecification().isolation,
      timeoutSeconds: 300,
      env: {},
      mounts: [],
      network: 'none',
      command: ['node', '-e', 'setInterval(()=>{},1000)'],
    };
    await prepareExecution(home, { test: 'replacement' }, docker, null, async () => spec, {});
    const original = await docker.executionReference(spec);
    try {
      await assert.rejects(
        cancelExecutionTree(root, [{ directory: 'execution', role: 'executor' }], docker),
        /replacement execution/,
      );
      assert.ok(docker.replacement);
      assert.notEqual(original.id, docker.replacement.id);
      assert.equal((await docker.inspect(spec.name))?.Running, true);
    } finally {
      await docker.halt(spec);
      await docker.remove(docker.replacement ?? original);
    }
  },
);
