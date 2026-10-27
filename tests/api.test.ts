import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { serve } from '../src/api.js';
import { Controller } from '../src/controller.js';
import { Store } from '../src/store.js';
import { Experiment } from '../src/contracts.js';
import { specification, candidate, runs } from './fixtures.js';

test('optimizer API enforces capability, authorized areas and realpath boundaries', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'he-api-'));
  const spec = specification(),
    store = new Store(':memory:', spec);
  const controller = new Controller(root, root, spec, store);
  const token = 'a'.repeat(64),
    run = { ...runs()[0]!, id: 'e'.repeat(64) };
  store.addCandidate(candidate());
  store.addRuns([run]);
  await mkdir(path.join(root, 'inputs/one'), { recursive: true });
  await writeFile(path.join(root, 'private.txt'), 'private');
  await writeFile(path.join(root, 'inputs/one/public.txt'), 'public');
  await symlink(path.join(root, 'private.txt'), path.join(root, 'inputs/one/escape'));
  const server = await serve(controller, token, 0, '127.0.0.1');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing address');
  const base = `http://127.0.0.1:${address.port}`;
  const request = (route: string, body: unknown, auth = token) =>
    fetch(base + route, {
      method: 'POST',
      headers: { authorization: `Bearer ${auth}` },
      body: JSON.stringify(body),
    });
  try {
    assert.equal((await request('/status', {}, 'wrong')).status, 401);
    assert.equal((await request('/status', {})).status, 200);
    assert.equal(
      (await request('/evidence', { run: run.id, area: 'evaluation', file: 'expected.json' })).status,
      400,
    );
    assert.equal(
      (await request('/evidence', { run: run.id, area: 'input', file: '../private.txt' })).status,
      400,
    );
    assert.equal((await request('/evidence', { run: run.id, area: 'input', file: 'escape' })).status, 400);
    const response = await request('/evidence', { run: run.id, area: 'input', file: 'public.txt' });
    const body = (await response.json()) as { artifact: { data: string } };
    assert.equal(Buffer.from(body.artifact.data, 'base64').toString(), 'public');
    const validation = new Controller(root, root, { ...spec, purpose: 'validation' }, store);
    await assert.rejects(serve(validation, token, 0, '127.0.0.1'), /no optimizer API/);
    const overlap = specification();
    overlap.tasks[0]!.evaluation = 'inputs/one/hidden';
    assert.throws(() => Experiment.parse(overlap), /must be disjoint/);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    store.close();
    await rm(root, { recursive: true, force: true });
  }
});
