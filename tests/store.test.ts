import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.js';
import { Experiment } from '../src/contracts.js';
import { specification, candidate, runs, hash } from './fixtures.js';

function score(store: Store, id: string, value: number): void {
  store.transition(id, 'queued', 'executing');
  store.transition(id, 'executing', 'delivered');
  store.transition(id, 'delivered', 'scoring');
  store.transition(id, 'scoring', 'scored', { grade: { score: value, metrics: {}, feedback: '' } });
}
test('strict experiment schema rejects task duplication and implicit fields', () => {
  assert.throws(() => Experiment.parse({ ...specification(), fallback: true }));
  const spec = specification();
  spec.tasks[1] = spec.tasks[0]!;
  assert.throws(() => Experiment.parse(spec));
  assert.throws(() => Experiment.parse({ ...specification(), purpose: 'validation' }));
});
test('scored state requires a finite, bounded independent grade', () => {
  const store = new Store(':memory:', specification());
  try {
    store.addCandidate(candidate());
    store.admit(candidate(), runs());
    const id = `${hash}-0`;
    store.transition(id, 'queued', 'executing');
    store.transition(id, 'executing', 'delivered');
    store.transition(id, 'delivered', 'scoring');
    assert.throws(() => store.transition(id, 'scoring', 'scored'));
    assert.throws(() =>
      store.transition(id, 'scoring', 'scored', { grade: { score: 2, metrics: {}, feedback: '' } }),
    );
    assert.equal(store.runs()[0]!.phase, 'scoring');
  } finally {
    store.close();
  }
});
test('selection uses every registered task including failed executions', () => {
  const store = new Store(':memory:', specification());
  try {
    store.addCandidate(candidate());
    store.admit(candidate(), runs());
    score(store, `${hash}-0`, 0.8);
    store.transition(`${hash}-1`, 'queued', 'executing');
    store.transition(`${hash}-1`, 'executing', 'execution_failed');
    assert.deepEqual(store.decide(hash), { promoted: true, mean: 0.4, failures: 1 });
  } finally {
    store.close();
  }
});
test('tie is rejected; strict improvement updates champion atomically', () => {
  const store = new Store(':memory:', specification());
  try {
    for (const [i, value] of [0.5, 0.5, 0.6].entries()) {
      const id = String(i).repeat(64),
        c = candidate(id, i);
      store.addCandidate(c);
      store.admit(c, runs(id));
      for (const run of runs(id)) score(store, run.id, value);
      assert.equal(store.decide(id).promoted, i !== 1);
    }
    assert.equal(store.getMeta('champion'), '2'.repeat(64));
  } finally {
    store.close();
  }
});
test('unscored tasks and mixed repetitions never produce a decision', () => {
  const store = new Store(':memory:', specification());
  try {
    store.addCandidate(candidate());
    store.admit(candidate(), runs());
    assert.throws(() => store.decide(hash), /unscored/);
    assert.throws(() => store.transition(`${hash}-0`, 'queued', 'scored'), /Invalid transition/);
    assert.throws(() => store.transition(`${hash}-0`, 'queued', 'executing', { task: 'fake' }), /immutable/);
  } finally {
    store.close();
  }
});
test('scoring recovery retains task attempt and cannot retry execution', () => {
  const store = new Store(':memory:', specification());
  try {
    store.addCandidate(candidate());
    store.admit(candidate(), runs());
    const id = `${hash}-0`;
    store.transition(id, 'queued', 'executing');
    store.transition(id, 'executing', 'delivered');
    store.transition(id, 'delivered', 'scoring');
    store.transition(id, 'scoring', 'scoring_failed', { error: 'Service unavailable' });
    assert.throws(() => store.transition(id, 'scoring_failed', 'queued'));
    store.transition(id, 'scoring_failed', 'scoring', { gradeAttempt: 1 });
    assert.equal(store.runs()[0]!.attempt, 0);
    assert.equal(store.runs()[0]!.gradeAttempt, 1);
  } finally {
    store.close();
  }
});
test('exclusive controller lease and rollback', () => {
  const store = new Store(':memory:', specification());
  try {
    store.acquire('A', Date.now(), 30_000);
    assert.throws(() => store.acquire('B', Date.now(), 30_000), /active controller/);
    assert.throws(() => store.assertLease('B'), /lease lost/);
    assert.throws(() =>
      store.transaction(() => {
        store.setMeta('partial', 'bad');
        throw new Error('crash');
      }),
    );
    assert.equal(store.getMeta('partial'), undefined);
    store.release('A');
    store.acquire('B', Date.now(), 30_000);
    store.assertLease('B');
  } finally {
    store.close();
  }
});
