import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Recipe, main, assessmentContract, registerSplits } from '../scripts/start.mjs';
import { specification } from './fixtures.ts';

test('startup recipes replace task generation, contract and seed without launcher branches', async () => {
  for (const name of ['structured-data', 'spreadsheet']) {
    const recipe = Recipe.parse(
      JSON.parse(await readFile(new URL(`../examples/${name}/recipe.json`, import.meta.url), 'utf8')),
    );
    assert.equal(recipe.name, name);
    assert.deepEqual(Object.keys(recipe.generate).sort(), ['reuse', 'search', 'validation']);
    for (const file of [recipe.prepare, `${recipe.seed}/package.json`, recipe.preflight].filter(Boolean))
      assert.ok((await readFile(new URL(`../examples/${name}/${file}`, import.meta.url))).length > 0);
  }
  assert.throws(() =>
    Recipe.parse({
      name: 'x',
      dockerfile: null,
      generate: ['python3'],
      prepare: '../outside',
      seed: 'seed',
      preflight: null,
    }),
  );
});

test('assessment uses the same executor and grader without search or probe budgets', () => {
  const raw = specification();
  const result = assessmentContract(raw, 'fresh-validation');
  assert.deepEqual(result.executor, raw.executor);
  assert.deepEqual(result.evaluator, raw.evaluator);
  assert.equal(result.purpose, 'validation');
  assert.equal(result.probes, null);
  assert.equal(result.budget.candidates, 1);
  assert.equal(raw.purpose, 'search');
});

test('three-split registration rejects reused inputs and a changed model before inference', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'he-split-'));
  try {
    const splits = {},
      specs = {};
    for (const [index, name] of ['search', 'validation', 'reuse'].entries()) {
      const dataset = path.join(root, name);
      await mkdir(dataset);
      const spec = name === 'search' ? specification() : assessmentContract(specification(), name);
      spec.tasks.forEach((task, taskIndex) => {
        task.inputDigest = `${index + 1}${taskIndex}`.repeat(32);
      });
      const file = path.join(dataset, 'spec.json');
      await writeFile(file, JSON.stringify(spec));
      splits[name] = { dataset, specification: file };
      specs[name] = spec;
    }
    assert.deepEqual(Object.keys(await registerSplits(splits)), ['search', 'validation', 'reuse']);
    specs.reuse.tasks[0].inputDigest = specs.search.tasks[0].inputDigest;
    await writeFile(splits.reuse.specification, JSON.stringify(specs.reuse));
    await assert.rejects(registerSplits(splits), /reused across splits/);
    specs.reuse.tasks[0].inputDigest = '3'.repeat(64);
    specs.reuse.executor.model = 'different-model';
    await writeFile(splits.reuse.specification, JSON.stringify(specs.reuse));
    await assert.rejects(registerSplits(splits), /changes frozen executor/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('startup refuses missing deployment pool before commands or model calls', async () => {
  await assert.rejects(main(['--pool', '']), /reserved private IPv4 CIDR/);
});
