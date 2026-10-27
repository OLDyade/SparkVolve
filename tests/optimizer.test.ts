import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { optimize } from '../src/optimizer.js';
import { Docker } from '../src/docker.js';
import type { ContainerSpec } from '../src/docker.js';
import { specification } from './fixtures.js';

test('optimizer recovery reattaches the same container and never creates a second attempt', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'he-optimizer-'));
  class Driver extends Docker {
    creations = 0;
    collections: string[] = [];
    override async create(_spec: ContainerSpec): Promise<void> {
      this.creations++;
    }
    override async collect(spec: ContainerSpec) {
      this.collections.push(spec.name);
      return { Status: 'exited', Running: false, ExitCode: 0, StartedAt: '', FinishedAt: '' };
    }
  }
  const driver = new Driver();
  try {
    await mkdir(path.join(root, 'drafts'));
    await writeFile(path.join(root, 'controller-token'), 'test-capability');
    await optimize(root, specification(), 'http://controller:8787', driver);
    await optimize(root, specification(), 'http://controller:8787', driver);
    assert.equal(driver.creations, 1);
    assert.equal(driver.collections[0], driver.collections[1]);
    await assert.rejects(optimize(root, specification(), 'http://changed:8787', driver), /contract changed/);
    await assert.rejects(
      optimize(root, { ...specification(), purpose: 'validation' }, 'http://controller:8787', driver),
      /cannot launch/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
