import { readFile, writeFile, cp } from 'node:fs/promises';
import path from 'node:path';
import { treeDigest } from '../../dist/artifacts.js';
import { Experiment } from '../../dist/contracts.js';
import { configureEgress } from '../venus/egress.mjs';
import { timeoutSeconds, optimizerSecondsForPlan } from '../timeouts.mjs';

const [dataset, image, modelFile, output, isolationFile, taskLimit, optimizerLimit, httpLimit, probeLimit] =
  process.argv.slice(2);
const taskTimeoutSeconds = timeoutSeconds(taskLimit);
const httpTimeoutSeconds = timeoutSeconds(httpLimit, taskTimeoutSeconds);
const probeTimeoutSeconds = timeoutSeconds(probeLimit, taskTimeoutSeconds);
if (!dataset || !image || !modelFile || !output || !isolationFile)
  throw new Error(
    'Usage: prepare.mjs <dataset> <image-digest> <model.json> <spec-output> <isolation.json> [task-seconds] [optimizer-seconds] [model-http-seconds] [probe-seconds]',
  );
const model = JSON.parse(await readFile(modelFile, 'utf8'));
for (const [source, destination] of [
  ['../venus/', 'runtime'],
  ['../../optimizers/evidence-driven/', 'optimizer-bundle'],
]) {
  await cp(new URL(source, import.meta.url), path.join(dataset, destination), {
    recursive: true,
    force: false,
    errorOnExist: true,
  });
}
const tasks = JSON.parse(await readFile(path.join(dataset, 'tasks.json'), 'utf8'));
for (const task of tasks) {
  task.inputDigest = await treeDigest(path.join(dataset, task.input));
  task.evaluationDigest = await treeDigest(path.join(dataset, task.evaluation));
}
const spec = Experiment.parse({
  egress: await configureEgress(path.join(dataset, 'runtime'), model, httpTimeoutSeconds),
  name: 'structured-data-native-evolution',
  purpose: 'search',
  hostSearchProtocol: { ancestry: 'unrestricted', feedback: 'full' },
  isolation: JSON.parse(await readFile(isolationFile, 'utf8')),
  objective:
    'Evolve the general structured-data capability bundle using observed task evidence. Perform a substantive plugin implementation or composition experiment, then evaluate the frozen candidate. You may introduce general data operations, replace tools, or compose services; choose the mechanism from actual evidence. Do not encode task IDs, fixture values or expected answers, repair outputs heuristically, or change the evaluator. Retain exact input evidence and explicit caller intent. A tie or negative result is valid; do not resample. This is a public synthetic development acceptance, not a claim of unseen-data gain.',
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
  evaluator: { image, command: ['python3', '/evaluation/grade.py'], timeoutSeconds: 30 },
  candidate: { patch: 'cordis.patch.yml', build: { image, timeoutSeconds: 300 }, qa: null },
  tasks,
  repetitions: 1,
  concurrency: 3,
  timeoutSeconds: taskTimeoutSeconds,
  failureLimit: 0,
  budget: { candidates: 2, optimizerSeconds: 600 },
  probes: { limit: 4, timeoutSeconds: probeTimeoutSeconds },
  metric: { name: 'structured_output_accuracy', direction: 'maximize', minimum: 0, maximum: 1, failure: 0 },
  constraints: [],
});
spec.budget.optimizerSeconds = timeoutSeconds(optimizerLimit, optimizerSecondsForPlan(spec, 600));
await writeFile(output, JSON.stringify(spec, null, 2), { flag: 'wx' });
