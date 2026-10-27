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

test('normal session completion continues with durable feedback; restart never reruns completed episodes', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'he-optimizer-'));
  const spec = specification();
  await mkdir(path.join(root, 'drafts'));
  const bundle = path.join(root, 'dataset', spec.optimizerHarness.directory);
  await mkdir(bundle, { recursive: true });
  await writeFile(path.join(bundle, 'plugins.yml'), '[]');
  spec.optimizerHarness.digest = await treeDigest(bundle);
  const token = 'a'.repeat(64);
  await writeFile(path.join(root, 'controller-token'), token);
  const store = new Store(path.join(root, 'experiment.sqlite'), spec);
  const server = await serve(new Controller(root, root, spec, store), token, 0, '127.0.0.1');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const endpoints = {
    endpoint: 'http://controller:8787',
    controlEndpoint: `http://127.0.0.1:${address.port}`,
  };
  class Driver extends Docker {
    creations: ContainerSpec[] = [];
    collections: string[] = [];
    fail = false;
    override async create(spec: ContainerSpec): Promise<void> {
      this.creations.push(spec);
    }
    override async collect(spec: ContainerSpec) {
      this.collections.push(spec.name);
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
  try {
    await optimize(root, spec, endpoints, driver);
    assert.equal(driver.creations.length, 2);
    assert.equal(driver.creations[1]!.timeoutSeconds, 59);
    assert.ok(driver.creations[1]!.mounts.some((m) => m.target === '/previous' && !m.writable));
    await optimize(root, spec, endpoints, driver);
    assert.equal(driver.creations.length, 2);
    assert.equal((await optimizerLedger(root)).length, 2);
    const summary = JSON.parse(await readFile(path.join(root, 'optimizer/summary.json'), 'utf8'));
    assert.equal(summary.consumedSeconds, 2);
    assert.equal(summary.reason, 'optimizer_concluded');
    await assert.rejects(
      optimize(root, spec, { ...endpoints, endpoint: 'http://changed:8787' }, driver),
      /contract changed/,
    );
    driver.fail = true;
    await assert.rejects(optimize(root, spec, endpoints, driver), /no automatic retry/);
    assert.equal(driver.creations.length, 2);
    await assert.rejects(
      optimize(root, { ...spec, purpose: 'validation' }, endpoints, driver),
      /cannot launch/,
    );
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    store.close();
    await rm(root, { recursive: true, force: true });
  }
});
