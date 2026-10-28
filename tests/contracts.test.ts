import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_TASK_TIMEOUT_SECONDS, Experiment } from '../src/contracts.js';
import { specification } from './fixtures.js';

test('task budgets default to 600 seconds and preserve explicit experiment decisions', () => {
  const { timeoutSeconds: _timeout, ...input } = specification();
  const resolved = Experiment.parse(input);
  assert.equal(DEFAULT_TASK_TIMEOUT_SECONDS, 600);
  assert.equal(resolved.timeoutSeconds, 600);
  assert.equal(Experiment.parse(JSON.parse(JSON.stringify(resolved))).timeoutSeconds, 600);
  for (const seconds of [300, 600, 3600])
    assert.equal(Experiment.parse({ ...input, timeoutSeconds: seconds }).timeoutSeconds, seconds);
  for (const seconds of [0, -1, 0.5, NaN, Infinity])
    assert.throws(() => Experiment.parse({ ...input, timeoutSeconds: seconds }));
});

test('additional QA is explicit: null or independently identified native suite, never omitted', () => {
  const spec = specification();
  assert.equal(Experiment.parse({ ...spec, candidate: { ...spec.candidate, qa: null } }).candidate.qa, null);
  assert.deepEqual(Experiment.parse(spec).candidate.qa, spec.candidate.qa);
  assert.throws(() => Experiment.parse({ ...spec, candidate: { ...spec.candidate, qa: [] } }));
  const qa = { directory: 'verification', digest: 'a'.repeat(64), entry: 'checks/contract.mjs' };
  assert.deepEqual(Experiment.parse({ ...spec, candidate: { ...spec.candidate, qa } }).candidate.qa, qa);
  assert.throws(() =>
    Experiment.parse({
      ...spec,
      candidate: { ...spec.candidate, qa: { ...qa, directory: spec.tasks[0]!.evaluation } },
    }),
  );
  assert.throws(() =>
    Experiment.parse({ ...spec, candidate: { ...spec.candidate, qa: { ...qa, entry: '../outside.mjs' } } }),
  );
  const { qa: _qa, ...candidate } = spec.candidate;
  assert.throws(() => Experiment.parse({ ...spec, candidate }));
});
