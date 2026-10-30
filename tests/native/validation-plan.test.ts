import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import os from 'node:os';
import path from 'node:path';
import { Experiment } from '../../dist/contracts.js';
import { Store } from '../../dist/store.js';
import { Controller } from '../../dist/controller.js';
import { treeDigest } from '../../dist/artifacts.js';
import { specification, candidate } from '../fixtures.js';

const execute = promisify(execFile);
test('spreadsheet preparation and independent validation retain the same frozen native QA suite', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'he-verification-plan-'));
  const search = path.join(root, 'search'),
    dataset = path.join(search, 'dataset'),
    fresh = path.join(root, 'fresh');
  const tasks = [
    { id: 'fixture', input: 'inputs/fixture', evaluation: 'evaluation/fixture', prompt: 'public test' },
  ];
  for (const base of [dataset, fresh]) {
    await mkdir(path.join(base, tasks[0]!.input), { recursive: true });
    await mkdir(path.join(base, tasks[0]!.evaluation), { recursive: true });
    await writeFile(path.join(base, 'tasks.json'), JSON.stringify(tasks));
  }
  const defaults = specification();
  await writeFile(path.join(root, 'model.json'), await readFile('examples/venus/model.json'));
  defaults.isolation.network.executor = 'controlled';
  await writeFile(path.join(root, 'isolation.json'), JSON.stringify(defaults.isolation));
  await execute(process.execPath, [
    'tests/fixtures/spreadsheet/prepare.mjs',
    dataset,
    defaults.runtime.image,
    path.join(root, 'model.json'),
    path.join(search, 'experiment.json'),
    path.join(root, 'isolation.json'),
    'examples/venus',
  ]);
  const spec = Experiment.parse(JSON.parse(await readFile(path.join(search, 'experiment.json'), 'utf8')));
  assert.ok(spec.candidate.qa);
  const store = new Store(path.join(search, 'experiment.sqlite'), spec);
  const selected = 'b'.repeat(64);
  store.addCandidate({ ...candidate('a'.repeat(64), 0), phase: 'champion' });
  store.addCandidate({ ...candidate(selected, 1), phase: 'rejected' });
  store.close();
  const plan = path.join(root, 'plan');
  await execute(process.execPath, [
    'tests/fixtures/spreadsheet/validation.mjs',
    search,
    selected,
    fresh,
    plan,
    '2',
  ]);
  const validation = Experiment.parse(JSON.parse(await readFile(path.join(plan, 'spec.json'), 'utf8')));
  assert.equal(validation.purpose, 'validation');
  assert.deepEqual(validation.candidate.qa, spec.candidate.qa);
  assert.equal(
    await treeDigest(path.join(plan, 'dataset', spec.candidate.qa.directory)),
    spec.candidate.qa.digest,
  );
  const validationStore = new Store(path.join(root, 'validation.sqlite'), validation);
  const controller = new Controller(root, path.join(plan, 'dataset'), validation, validationStore);
  try {
    await controller.start();
  } finally {
    await controller.close();
    validationStore.close();
  }
  await writeFile(path.join(dataset, spec.candidate.qa.directory, spec.candidate.qa.entry), 'changed');
  await assert.rejects(
    execute(process.execPath, [
      'tests/fixtures/spreadsheet/validation.mjs',
      search,
      selected,
      fresh,
      path.join(root, 'tampered-plan'),
      '2',
    ]),
    /Frozen dependency changed: verification/,
  );
  console.log(`Verification handoff evidence retained: ${root}`);
});
