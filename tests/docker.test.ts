import test from 'node:test';
import assert from 'node:assert/strict';
import { command } from '../src/docker.js';
import { Experiment } from '../src/contracts.js';
import { specification } from './fixtures.js';

test('isolation is a required experiment contract and never grants root or grader network', () => {
  const spec = specification();
  assert.ok(Experiment.safeParse(spec).success);
  for (const isolation of [
    undefined,
    { ...spec.isolation, runtime: '' },
    { ...spec.isolation, user: { uid: 0, gid: 0 } },
    { ...spec.isolation, network: { ...spec.isolation.network, evaluator: 'bridge' } },
    { ...spec.isolation, network: { ...spec.isolation.network, qa: 'bridge' } },
    { ...spec.isolation, memoryMiB: -1 },
    { ...spec.isolation, cpus: 0.0001 },
  ])
    assert.equal(Experiment.safeParse({ ...spec, isolation }).success, false);
});

test('abort cancels the host wait promptly instead of waiting for the full model budget', async () => {
  const abort = new AbortController();
  const start = Date.now();
  const waiting = command(process.execPath, ['-e', 'setTimeout(()=>{},60000)'], { signal: abort.signal });
  setTimeout(() => abort.abort(), 50);
  await assert.rejects(waiting, /abort/i);
  assert.ok(Date.now() - start < 3000);
});
