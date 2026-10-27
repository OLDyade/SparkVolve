import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { optimize, optimizerLedger } from '../src/optimizer.js';
import { Docker, type ContainerSpec } from '../src/docker.js';
import { Store } from '../src/store.js';
import { Controller } from '../src/controller.js';
import { serve } from '../src/api.js';
import { treeDigest } from '../src/artifacts.js';
import { specification } from './fixtures.js';
import type { EgressFactory } from '../src/egress-session.js';
import { containerIdentity } from '../src/isolation.js';

test('normal session completion continues with durable feedback; restart never reruns completed episodes', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'he-optimizer-'));
  const spec = specification();
  await mkdir(path.join(root, 'drafts'));
  const bundle = path.join(root, 'dataset', spec.optimizerHarness.directory);
  await mkdir(bundle, { recursive: true });
  await writeFile(path.join(bundle, 'plugins.yml'), '[]');
  spec.optimizerHarness.digest = await treeDigest(bundle);
  const verification = path.join(root, 'dataset/verification');
  await mkdir(verification);
  await writeFile(path.join(verification, 'check.mjs'), 'export async function probe(){}');
  spec.candidate.qa = {
    directory: 'verification',
    digest: await treeDigest(verification),
    entry: 'check.mjs',
  };
  const token = 'a'.repeat(64);
  await writeFile(path.join(root, 'controller-token'), token);
  const store = new Store(path.join(root, 'experiment.sqlite'), spec);
  const server = await serve(new Controller(root, root, spec, store), token, 0, '127.0.0.1');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const endpoints = {
    endpoint: 'http://192.0.2.1:8787',
    controlEndpoint: `http://127.0.0.1:${address.port}`,
  };
  class Driver extends Docker {
    creations: ContainerSpec[] = [];
    collections: string[] = [];
    fail = false;
    override async create(spec: ContainerSpec): Promise<void> {
      this.creations.push(spec);
    }
    override async inspect() {
      return {
        Status: 'exited',
        Running: false,
        ExitCode: 0,
        StartedAt: '2026-10-27T00:00:00Z',
        FinishedAt: '2026-10-27T00:00:01Z',
      };
    }
    override async halt() {}
    override async collect(spec: ContainerSpec, logDir: string) {
      this.collections.push(spec.name);
      await mkdir(logDir, { recursive: true });
      for (const file of ['isolation.json', 'isolation-final.json'])
        await writeFile(
          path.join(logDir, file),
          JSON.stringify({ intent: containerIdentity(spec), containerId: spec.name }),
        );
      for (const file of ['stdout.log', 'stderr.log']) await writeFile(path.join(logDir, file), '');
      if (spec.name.endsWith('-1'))
        store.setMeta('searchConclusion', JSON.stringify({ reason: 'Evidence exhausted' }));
      return {
        Status: 'exited',
        Running: false,
        ExitCode: this.fail ? 1 : 0,
        StartedAt: '2026-10-27T00:00:00Z',
        FinishedAt: '2026-10-27T00:00:01Z',
      };
    }
  }
  const driver = new Driver();
  const gateways: EgressFactory = () => ({
    async prepare() {},
    async verify() {},
    async stop() {},
    async release() {},
    async abort() {},
    async candidateNetwork() {
      return 'none';
    },
  });
  const run = (value = spec, target = endpoints) =>
    optimize(root, value, target, driver, new AbortController().signal, gateways);
  try {
    await run();
    assert.equal(driver.creations.length, 2);
    assert.ok(
      driver.creations.every((c) =>
        c.mounts.some((m) => m.target === '/verification' && !m.writable && m.source === verification),
      ),
    );
    assert.equal(driver.creations[1]!.timeoutSeconds, 59);
    assert.ok(driver.creations[1]!.mounts.some((m) => m.target === '/previous' && !m.writable));
    await run();
    assert.equal(driver.creations.length, 2);
    assert.equal((await optimizerLedger(root)).length, 2);
    const summary = JSON.parse(await readFile(path.join(root, 'optimizer/summary.json'), 'utf8'));
    assert.equal(summary.consumedSeconds, 2);
    assert.equal(summary.reason, 'optimizer_concluded');
    await assert.rejects(run(spec, { ...endpoints, endpoint: 'http://192.0.2.2:8787' }), /contract changed/);
    driver.fail = true;
    await run();
    assert.equal(driver.collections.length, 2, 'Archived episodes never collect or execute a replacement');
    assert.equal(driver.creations.length, 2);
    await assert.rejects(run({ ...spec, purpose: 'validation' }), /cannot launch/);
    await writeFile(path.join(verification, 'check.mjs'), 'changed');
    await assert.rejects(run(), /Domain QA digest mismatch/);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    store.close();
    await rm(root, { recursive: true, force: true });
  }
});
