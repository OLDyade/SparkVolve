import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { assessConstraints } from '../src/constraints.js';
import { Experiment, type OutcomeConstraintSpec, type TaskRun } from '../src/contracts.js';
import { Store } from '../src/store.js';
import { specification, candidate, runs } from './fixtures.js';

const preservation: OutcomeConstraintSpec = {
  id: 'preserve-source',
  metric: 'preserved',
  aggregation: 'each',
  operator: 'gte',
  threshold: 1,
};
test('declared constraints reject damaging improvements without altering observed quality', () => {
  const spec = specification();
  spec.constraints = [preservation];
  const store = new Store(':memory:', spec);
  try {
    for (const [ordinal, quality, preserved, promote] of [
      [0, 0.6, 1, true],
      [1, 1, 0.99, false],
      [2, 0.8, 1, true],
    ] as const) {
      const id = String(ordinal).repeat(64);
      store.addCandidate(candidate(id, ordinal));
      store.admit(candidate(id, ordinal), runs(id));
      for (const run of runs(id)) {
        store.transition(run.id, 'queued', 'executing');
        store.transition(run.id, 'executing', 'delivered');
        store.transition(run.id, 'delivered', 'scoring');
        store.transition(run.id, 'scoring', 'scored', {
          grade: { score: quality, metrics: { preserved }, feedback: '' },
        });
      }
      const result = store.decide(id);
      assert.equal(result.promoted, promote);
      assert.equal(result.mean, quality);
      const event = store.decision(id) as { constraintsSatisfied: boolean; constraints: unknown[] };
      assert.equal(event.constraintsSatisfied, promote);
      assert.equal(event.constraints.length, 1);
    }
    assert.equal(store.getMeta('champion'), '2'.repeat(64));
  } finally {
    store.close();
  }
});

test('constraint aggregation preserves the full denominator and explicit missing evidence', () => {
  const input: TaskRun[] = runs().map((run, i) => ({
    ...run,
    phase: 'scored' as const,
    grade: { score: 1, metrics: { preserved: i === 0 ? 0.5 : 1, errors: 0 }, feedback: '' },
  }));
  const mean = { ...preservation, aggregation: 'mean' as const, threshold: 0.75 };
  let [each, average, errors] = assessConstraints(
    [preservation, mean, { ...preservation, metric: 'errors', operator: 'lte', threshold: 0 }],
    input,
  );
  assert.equal(each!.status, 'violated');
  assert.equal(average!.status, 'passed');
  assert.deepEqual(average!.aggregate, { numerator: '3', denominator: '4' });
  assert.equal(errors!.status, 'passed');
  input[1]!.grade!.metrics = { errors: 0 };
  [average] = assessConstraints([mean], input);
  assert.equal(average!.status, 'unavailable');
  assert.equal(average!.aggregate, null);
  assert.equal(average!.denominator, 2);
  assert.equal(average!.observed, 1);
  assert.equal(average!.samples[1]!.reason, 'metric_missing');
  const failed = [{ ...input[0]!, phase: 'execution_failed' as const }, input[1]!];
  assert.equal(assessConstraints([mean], failed)[0]!.samples[0]!.value, null);
  assert.equal(assessConstraints([mean], failed)[0]!.samples[0]!.reason, 'run_execution_failed');
  assert.equal(assessConstraints([mean], [])[0]!.status, 'unavailable');
  assert.deepEqual(assessConstraints([], failed), []);
});

test('exact decimal means preserve equality, extreme magnitudes and strict thresholds without epsilon', () => {
  for (const count of [3, 6, 7, 10, 30]) {
    for (const value of [0, 0.1, 1, -0.1, 1e308, 5e-324]) {
      const input = Array.from({ length: count }, (_, index): TaskRun => ({
        ...runs()[0]!,
        id: `run-${index}`,
        repetition: index,
        phase: 'scored',
        grade: { score: 1, metrics: { measured: value }, feedback: '' },
      }));
      for (const operator of ['gte', 'lte'] as const) {
        const result = assessConstraints(
          [{ ...preservation, metric: 'measured', aggregation: 'mean', operator, threshold: value }],
          input,
        )[0]!;
        assert.equal(result.status, 'passed', `${count} copies of ${value}, ${operator}`);
      }
    }
  }
  const input = [0.1, 0.2].map((value, index): TaskRun => ({
    ...runs()[index]!,
    phase: 'scored',
    grade: { score: 1, metrics: { preserved: value }, feedback: '' },
  }));
  const constraint = { ...preservation, aggregation: 'mean' as const, threshold: 0.15 };
  assert.deepEqual(assessConstraints([constraint], input)[0]!.aggregate, {
    numerator: '3',
    denominator: '20',
  });
  assert.equal(assessConstraints([{ ...constraint, operator: 'lte' }], input)[0]!.status, 'passed');
  assert.equal(
    assessConstraints([{ ...constraint, threshold: 0.15000000000000002 }], input)[0]!.status,
    'violated',
  );
});

test('infeasible seed and absent required measurements cannot become champion', () => {
  for (const grade of [
    { score: 1, metrics: { preserved: 0.96 }, feedback: '' },
    { score: 1, metrics: {}, feedback: '' },
  ]) {
    const spec = specification();
    spec.constraints = [preservation];
    const store = new Store(':memory:', spec);
    try {
      const c = candidate();
      store.addCandidate(c);
      store.admit(c, runs());
      for (const run of runs()) {
        store.transition(run.id, 'queued', 'executing');
        store.transition(run.id, 'executing', 'delivered');
        store.transition(run.id, 'delivered', 'scoring');
        store.transition(run.id, 'scoring', 'scored', { grade });
      }
      assert.equal(store.decide(c.digest).promoted, false);
      assert.equal(store.getMeta('champion'), undefined);
      assert.equal(store.candidate(c.digest).mean, 1);
    } finally {
      store.close();
    }
  }
});

test('constraint declarations are mandatory, unique and frozen across controller recovery', async () => {
  assert.throws(() => Experiment.parse({ ...specification(), constraints: undefined }));
  assert.throws(() => Experiment.parse({ ...specification(), constraints: [preservation, preservation] }));
  assert.throws(() =>
    Experiment.parse({ ...specification(), constraints: [{ ...preservation, threshold: Infinity }] }),
  );
  const root = await mkdtemp(path.join(os.tmpdir(), 'he-constraint-contract-'));
  const file = path.join(root, 'experiment.sqlite');
  try {
    const spec = specification();
    const original = new Store(file, spec);
    original.close();
    assert.throws(() => new Store(file, { ...spec, constraints: [preservation] }), /specification changed/);
  } finally {
    await rm(root, { recursive: true });
  }
});
