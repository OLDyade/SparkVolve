import test from 'node:test';
import assert from 'node:assert/strict';
import { Experiment } from '../src/contracts.js';
import { specification } from './fixtures.js';

test('additional QA is explicit: null or nonempty command, never omitted', () => {
  const spec = specification();
  assert.equal(Experiment.parse({ ...spec, candidate: { ...spec.candidate, qa: null } }).candidate.qa, null);
  assert.deepEqual(Experiment.parse(spec).candidate.qa, spec.candidate.qa);
  assert.throws(() => Experiment.parse({ ...spec, candidate: { ...spec.candidate, qa: [] } }));
  const { qa: _qa, ...candidate } = spec.candidate;
  assert.throws(() => Experiment.parse({ ...spec, candidate }));
});
