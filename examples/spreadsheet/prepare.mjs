// Generate a concrete contract from content hashes; no task answers or model credentials enter code.
import { readFile, writeFile, cp } from 'node:fs/promises';
import path from 'node:path';
import { treeDigest } from '../../dist/artifacts.js';
import { Experiment } from '../../dist/contracts.js';
import { configureEgress } from '../venus/egress.mjs';

const [dataset, image, modelFile, output, isolationFile] = process.argv.slice(2);
if (!dataset || !image || !modelFile || !output || !isolationFile)
  throw new Error('Usage: prepare.mjs <dataset> <image-digest> <model.json> <spec-output> <isolation.json>');
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
await cp(new URL('./verification/', import.meta.url), path.join(dataset, 'verification'), {
  recursive: true,
  force: false,
  errorOnExist: true,
});
for (const task of tasks) {
  task.inputDigest = await treeDigest(path.join(dataset, task.input));
  task.evaluationDigest = await treeDigest(path.join(dataset, task.evaluation));
}
const spec = Experiment.parse({
  egress: await configureEgress(path.join(dataset, 'runtime'), model),
  name: 'spreadsheet-business-search',
  purpose: 'search',
  hostSearchProtocol: { ancestry: 'unrestricted', feedback: 'full' },
  isolation: JSON.parse(await readFile(isolationFile, 'utf8')),
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
  researchLibrary: null,
  optimizerHarness: {
    kind: 'source',
    source: {
      directory: 'optimizer-bundle',
      digest: await treeDigest(path.join(dataset, 'optimizer-bundle')),
    },
    composition: 'plugins.yml',
    build: { image, timeoutSeconds: 300 },
  },
  evaluator: { image, command: ['python3', '/evaluation/grade.py'], timeoutSeconds: 120 },
  candidate: {
    patch: 'cordis.patch.yml',
    build: { image, timeoutSeconds: 300 },
    qa: {
      directory: 'verification',
      digest: await treeDigest(path.join(dataset, 'verification')),
      entry: 'check.mjs',
    },
  },
  tasks,
  repetitions: 1,
  concurrency: 3,
  timeoutSeconds: 300,
  failureLimit: 0,
  budget: { candidates: 4, optimizerSeconds: 1800 },
  probes: { limit: 6, timeoutSeconds: 120 },
  metric: { name: 'formula_value_accuracy', direction: 'maximize', minimum: 0, maximum: 1, failure: 0 },
  constraints: [],
});
await writeFile(output, JSON.stringify(spec, null, 2));
