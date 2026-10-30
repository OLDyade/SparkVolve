import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  main,
  assessmentContract,
  registerSplits,
  selectValidation,
  installedComparison,
} from '../scripts/start.mjs';
import { treeDigest } from '../dist/artifacts.js';
import { specification } from './fixtures.ts';

test('community panel has fixed category quotas, family-separated splits and an embedded smoke set', async () => {
  const roster = JSON.parse(
    await readFile(new URL('../benchmarks/spreadsheetbench2/mixed36.json', import.meta.url), 'utf8'),
  );
  const expected = { development: [6, 4, 2], validation: [4, 4, 2], test: [6, 4, 4] };
  const families = new Map(),
    inputs = new Map(),
    ids = new Set();
  for (const [split, rows] of Object.entries(roster.splits)) {
    assert.deepEqual(
      ['Debugging', 'Financial_Model', 'Template'].map(
        (category) => rows.filter((r) => r.category === category).length,
      ),
      expected[split],
    );
    for (const row of rows) {
      assert.ok(!families.has(row.family) || families.get(row.family) === split);
      assert.ok(!inputs.has(row.inputSha256) || inputs.get(row.inputSha256) === split);
      assert.ok(!ids.has(row.id));
      families.set(row.family, split);
      inputs.set(row.inputSha256, split);
      ids.add(row.id);
    }
  }
  assert.equal(ids.size, 36);
  assert.equal(new Set(roster.smoke).size, 4);
  assert.ok(roster.smoke.every((id) => roster.splits.development.some((r) => r.id === id)));
});
test('assessment removes the screen while preserving the model and grader', () => {
  const raw = specification();
  raw.hostSearchProtocol.screening = { tasks: ['one'], minimumBaselineDelta: 0 };
  const result = assessmentContract(raw, 'fresh-validation');
  assert.equal(result.hostSearchProtocol.screening, undefined);
  assert.deepEqual(result.executor, raw.executor);
  assert.deepEqual(result.evaluator, raw.evaluator);
  assert.equal(result.budget.candidates, 1);
  assert.equal(raw.purpose, 'search');
});
test('split registration rejects reused inputs and changed models before inference', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'he-split-'));
  try {
    const splits = {};
    for (const [index, name] of ['development', 'validation', 'test'].entries()) {
      await mkdir(path.join(root, name));
      const spec = name === 'development' ? specification() : assessmentContract(specification(), name);
      spec.tasks.forEach((task, i) => {
        task.inputDigest = (String(index + 1) + String(i)).repeat(32);
      });
      splits[name] = {
        specification: spec,
        dataset: { directory: name, digest: await treeDigest(path.join(root, name)) },
      };
    }
    assert.equal(Object.keys(await registerSplits(splits, root)).length, 3);
    splits.test.specification.tasks[0].inputDigest = splits.development.specification.tasks[0].inputDigest;
    await assert.rejects(registerSplits(splits, root), /reused across splits/);
    splits.test.specification.tasks[0].inputDigest = '3'.repeat(64);
    splits.test.specification.executor.model = 'different';
    await assert.rejects(registerSplits(splits, root), /changes frozen executor/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test('validation selection does not select sampling gain from the same bundle or use unseen test', () => {
  const h0 = { id: 'h0', complete: true, eligible: true, mean: 0.4, bundle: 'original' };
  assert.equal(
    selectValidation(
      h0,
      [{ id: 'same', complete: true, eligible: true, mean: 0.9, bundle: 'original' }],
      'maximize',
    ),
    h0,
  );
  const first = { id: 'first', complete: true, eligible: true, mean: 0.7, bundle: 'new' };
  assert.equal(selectValidation(h0, [first, { ...first, id: 'later' }], 'maximize'), first);
  assert.equal(selectValidation(h0, [{ ...first, mean: 0.4 }], 'maximize'), h0);
  assert.throws(() => selectValidation(h0, [{ ...first, complete: false }], 'maximize'), /incomplete/);
  assert.throws(() => selectValidation({ ...h0, eligible: false }, [], 'maximize'), /registered failure/);
  const lower = { ...first, mean: 0.2 };
  assert.equal(selectValidation(h0, [lower], 'minimize'), lower);
});
test('startup refuses an absent deployment pool before commands or model calls', async () => {
  await assert.rejects(main(['--pool', '']), /reserved private IPv4 CIDR/);
});

test('installed comparison preserves failures, auxiliary metrics and the fixed test denominator', () => {
  const spec = specification();
  const rows = [
    { task: 'one', phase: 'scored', grade: { score: 0.4, metrics: { official_accuracy: 0 } } },
    { task: 'two', phase: 'failed', grade: null },
  ];
  const baseline = { id: 'h0', candidate: 'a', bundle: 'a', result: { rows } };
  const selected = {
    id: 'open-plugins',
    candidate: 'b',
    bundle: 'b',
    result: {
      rows: [
        { task: 'one', phase: 'scored', grade: { score: 0.8, metrics: { official_accuracy: 1 } } },
        { task: 'two', phase: 'scored', grade: { score: 0.6, metrics: { official_accuracy: 0 } } },
      ],
    },
  };
  const result = installedComparison([baseline, selected], 'open-plugins', spec);
  assert.equal(result.denominator, 2);
  assert.equal(result.meanDelta, 0.5);
  assert.equal(result.pairs[1].baseline, 0);
  assert.deepEqual(result.pairs[0].selectedMetrics, { official_accuracy: 1 });
  assert.equal(installedComparison([baseline], 'h0', spec).meanDelta, 0);
  assert.throws(
    () => installedComparison([baseline, { ...selected, result: { rows: [] } }], 'open-plugins', spec),
    /denominator/,
  );
});
