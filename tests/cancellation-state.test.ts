import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { Controller } from '../src/controller.js';
import { Store } from '../src/store.js';
import { optimize } from '../src/optimizer.js';
import { assertNotCancelled } from '../src/cancellation-state.js';
import { specification } from './fixtures.js';

test('persisted cancellation intent stops admission even before the JSON cleanup receipt exists', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'he-cancellation-admission-'));
  const spec = specification();
  const store = new Store(':memory:', spec);
  const controller = new Controller(root, root, spec, store);
  try {
    assert.doesNotThrow(() => assertNotCancelled(root));
    await writeFile(path.join(root, 'cancellation.sqlite'), 'reserved');
    await assert.rejects(controller.start(), /cancellation has started/);
    await assert.rejects(controller.submit({}), /cancellation has started/);
    await assert.rejects(
      optimize(root, spec, { endpoint: 'http://127.0.0.1:1234' }),
      /cancellation has started/,
    );
    assert.deepEqual(store.candidates(), []);
    assert.deepEqual(store.runs(), []);
  } finally {
    store.close();
    await rm(root, { recursive: true, force: true });
  }
});
