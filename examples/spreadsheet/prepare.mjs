// Generate a concrete contract from content hashes; no task answers or model credentials enter code.
import { readFile, writeFile, cp } from 'node:fs/promises';
import path from 'node:path';
import { treeDigest } from '../../dist/artifacts.js';
import { Experiment } from '../../dist/contracts.js';

const [dataset, image, modelFile, output] = process.argv.slice(2);
if (!dataset || !image || !modelFile || !output)
  throw new Error('Usage: prepare.mjs <dataset> <image-digest> <model.json> <spec-output>');
const model = JSON.parse(await readFile(modelFile, 'utf8'));
await cp(new URL('../venus/', import.meta.url), path.join(dataset, 'runtime'), {
  recursive: true,
  force: false,
  errorOnExist: true,
});
await cp(
  new URL('../../optimizers/evidence-driven/', import.meta.url),
  path.join(dataset, 'optimizer-bundle'),
  {
    recursive: true,
    force: false,
    errorOnExist: true,
  },
);
const tasks = JSON.parse(await readFile(path.join(dataset, 'tasks.json'), 'utf8'));
for (const task of tasks) {
  task.inputDigest = await treeDigest(path.join(dataset, task.input));
  task.evaluationDigest = await treeDigest(path.join(dataset, task.evaluation));
}
const spec = Experiment.parse({
  name: 'spreadsheet-business-search',
  purpose: 'search',
  objective:
    'Improve the general spreadsheet capability bundle from actual task evidence. Conduct at least one substantive, evidence-backed plugin experiment, including implementation or composition changes; test the resulting candidate under the fixed task contract. Do not insert case-specific answers. Correctness is primary; report preservation and cost separately. A tie is a legitimate negative result, never a reason to modify the evaluator.',
  runtime: {
    image,
    dshVersion: '0.2.1-rc.4',
    profile: 'sdk',
    environment: {
      directory: 'runtime',
      digest: await treeDigest(path.join(dataset, 'runtime')),
      patch: 'cordis.patch.yml',
    },
  },
  executor: model,
  optimizer: model,
  optimizerHarness: {
    directory: 'optimizer-bundle',
    digest: await treeDigest(path.join(dataset, 'optimizer-bundle')),
    patch: 'cordis.patch.yml',
  },
  evaluator: { image, command: ['python3', '/evaluation/grade.py'], timeoutSeconds: 120 },
  candidate: {
    patch: 'cordis.patch.yml',
    qa: ['node', '/app/spreadsheet-qa.mjs', '/candidate/index.mjs'],
  },
  tasks,
  repetitions: 1,
  concurrency: 3,
  timeoutSeconds: 300,
  failureLimit: 0,
  budget: { candidates: 4, optimizerSeconds: 1800 },
  metric: { name: 'formula_value_accuracy', direction: 'maximize', minimum: 0, maximum: 1, failure: 0 },
});
await writeFile(output, JSON.stringify(spec, null, 2));
