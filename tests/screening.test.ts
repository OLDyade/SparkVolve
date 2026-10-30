import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.js';
import { Experiment } from '../src/contracts.js';
import { specification, candidate, runs, hash } from './fixtures.js';

function scored(store: Store, id: string, score: number) {
  store.transition(id, 'queued', 'executing');
  store.transition(id, 'executing', 'delivered');
  store.transition(id, 'delivered', 'scoring');
  store.transition(id, 'scoring', 'scored', { grade: { score, metrics: {}, feedback: '' } });
}
function setup() {
  const spec = specification();
  spec.hostSearchProtocol.screening = { tasks: ['one'], minimumBaselineDelta: 0 };
  const store = new Store(':memory:', Experiment.parse(spec));
  store.addCandidate(candidate());
  store.admit(candidate(), runs());
  for (const run of runs()) scored(store, run.id, 0.5);
  store.decide(hash);
  const child = candidate('b'.repeat(64), 1);
  child.proposal.parents = [hash];
  store.addCandidate(child);
  store.admit(child, runs(child.digest));
  return { store, child };
}
test('screened remainder stays unobserved and cannot compete with a full denominator', () => {
  const { store, child } = setup();
  try {
    assert.throws(() => store.screen(child.digest), /incomplete/);
    scored(store, child.digest + '-0', 0.4);
    assert.equal(store.screen(child.digest), false);
    assert.equal(store.screen(child.digest), false);
    assert.equal(store.runs(child.digest)[1]!.phase, 'screened_out');
    assert.equal(store.candidate(child.digest).mean, undefined);
    assert.equal(store.candidate(child.digest).phase, 'screened_out');
    assert.equal(store.getMeta('champion'), hash);
    assert.throws(() => store.decide(child.digest), /awaiting/);
    assert.equal(store.events().filter((e) => e.type === 'candidate.screened').length, 1);
  } finally {
    store.close();
  }
});
test('screen pass keeps original observations and completes the same candidate denominator', () => {
  const { store, child } = setup();
  try {
    scored(store, child.digest + '-0', 0.5);
    assert.equal(store.screen(child.digest), true);
    assert.equal(store.screen(child.digest), true);
    scored(store, child.digest + '-1', 0.8);
    assert.equal(store.decide(child.digest).mean, 0.65);
    assert.equal(store.runs(child.digest).length, 2);
    assert.ok(store.runs(child.digest).every((run) => run.attempt === 0));
  } finally {
    store.close();
  }
});
test('screening cannot leak into independent validation or name nonregistered tasks', () => {
  const spec = specification();
  spec.hostSearchProtocol.screening = { tasks: ['missing'], minimumBaselineDelta: 0 };
  assert.throws(() => Experiment.parse(spec), /subset/);
  spec.hostSearchProtocol.screening.tasks = ['one'];
  spec.purpose = 'validation';
  spec.budget.candidates = 1;
  assert.throws(() => Experiment.parse(spec), /subset/);
});
