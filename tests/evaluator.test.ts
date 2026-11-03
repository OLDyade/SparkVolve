import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluatorIsolation, evaluatorQueue } from '../src/evaluator.js';
import { Experiment } from '../src/contracts.js';
import { specification } from './fixtures.js';

test('grader resources are registered separately and invalid resource limits fail parsing', () => {
  const spec = specification();
  assert.deepEqual(evaluatorIsolation(spec), spec.isolation);
  const before = structuredClone(spec.isolation);
  spec.evaluator.memoryMiB = 16384;
  spec.evaluator.concurrency = 1;
  assert.equal(Experiment.parse(spec).evaluator.memoryMiB, 16384);
  assert.equal(evaluatorIsolation(spec).memoryMiB, 16384);
  assert.deepEqual(spec.isolation, before);
  for (const field of ['memoryMiB', 'concurrency'] as const) {
    for (const value of [0, -1, 1.5]) {
      assert.equal(
        Experiment.safeParse({ ...spec, evaluator: { ...spec.evaluator, [field]: value } }).success,
        false,
      );
    }
  }
});

test('grader queue releases failed slots, keeps FIFO order and never exceeds task concurrency', async () => {
  for (const [taskLimit, gradeLimit] of [
    [4, 1],
    [2, 9],
  ]) {
    const spec = specification();
    spec.concurrency = taskLimit!;
    spec.evaluator.concurrency = gradeLimit!;
    const queue = evaluatorQueue(spec);
    let active = 0,
      peak = 0;
    const order: number[] = [];
    const results = await Promise.allSettled(
      Array.from({ length: 6 }, (_, i) =>
        queue(async () => {
          order.push(i);
          peak = Math.max(peak, ++active);
          await new Promise((resolve) => setTimeout(resolve, 5));
          active--;
          if (i === 0) throw new Error('grading failure');
          return i;
        }),
      ),
    );
    assert.equal(peak, Math.min(taskLimit!, gradeLimit!));
    assert.deepEqual(order, [0, 1, 2, 3, 4, 5]);
    assert.equal(results[0]!.status, 'rejected');
    assert.equal(
      results.slice(1).every((r) => r.status === 'fulfilled'),
      true,
    );
    assert.equal(await queue(async () => 7), 7);
  }
});
