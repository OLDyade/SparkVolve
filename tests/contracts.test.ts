import test from 'node:test';
import assert from 'node:assert/strict';
import { Experiment } from '../src/contracts.js';
import { specification } from './fixtures.js';

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
