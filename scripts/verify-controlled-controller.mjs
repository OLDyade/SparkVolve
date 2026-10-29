import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile, cp } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Experiment } from '../dist/contracts.js';
import { Controller } from '../dist/controller.js';
import { Store } from '../dist/store.js';
import { treeDigest, fileDigest } from '../dist/artifacts.js';
import { containerSpecification } from '../tests/fixtures.ts';
import { configureEgress } from '../examples/venus/egress.mjs';
import { timeoutSeconds } from '../examples/timeouts.mjs';

const repo = fileURLToPath(new URL('..', import.meta.url));
assert.ok(process.argv[2], 'Provide a NEW evidence directory [task-seconds] [model-http-seconds]');
const taskTimeoutSeconds = timeoutSeconds(process.argv[3]);
const httpTimeoutSeconds = timeoutSeconds(process.argv[4], taskTimeoutSeconds);
assert.ok(process.env.VENUS_API_KEY, 'Trusted launcher requires VENUS_API_KEY');
assert.match(process.env.SPARKVOLVE_TEST_IMAGE ?? '', /^sha256:[a-f0-9]{64}$/);
const root = path.resolve(process.argv[2]),
  dataset = path.join(root, 'dataset');
await mkdir(root);
for (const dir of ['dataset/input', 'dataset/private', 'seed'])
  await mkdir(path.join(root, dir), { recursive: true });
await cp(path.join(repo, 'examples/venus'), path.join(dataset, 'runtime'), { recursive: true });
const model = JSON.parse(await readFile(path.join(repo, 'examples/venus/model.json'), 'utf8'));
model.maxTokens = 1024;
const egress = await configureEgress(path.join(dataset, 'runtime'), model, httpTimeoutSeconds);
await writeFile(path.join(dataset, 'input/request.json'), JSON.stringify({ from: 0, to: 10 }));
await writeFile(
  path.join(dataset, 'private/grade.mjs'),
  `
import {readFile,writeFile} from 'node:fs/promises';
const result=JSON.parse(await readFile('/delivery/result.json','utf8'));
await writeFile('/workspace/result.json',JSON.stringify({score:Number(result.sum===55),metrics:{},feedback:'Independent arithmetic delivery check'}));
`,
);
const packageJSON = {
  name: '@sparkvolve/native-network-acceptance',
  version: '1.0.0',
  type: 'module',
  scripts: { build: 'node --check index.mjs' },
  files: ['cordis.patch.yml', 'index.mjs'],
  dsh: { bundle: { patch: './cordis.patch.yml' } },
};
await writeFile(path.join(root, 'seed/index.mjs'), 'export function apply() {}\n');
await writeFile(path.join(root, 'seed/package.json'), JSON.stringify(packageJSON));
await writeFile(
  path.join(root, 'seed/package-lock.json'),
  JSON.stringify({
    name: packageJSON.name,
    version: '1.0.0',
    lockfileVersion: 3,
    packages: { '': { name: packageJSON.name, version: '1.0.0' } },
  }),
);
await writeFile(path.join(root, 'seed/cordis.patch.yml'), '[]\n');
const defaults = containerSpecification();
defaults.isolation.network.executor = 'controlled';
const image = process.env.SPARKVOLVE_TEST_IMAGE;
const spec = Experiment.parse({
  ...defaults,
  name: 'controlled-native-acceptance',
  egress,
  runtime: {
    image,
    dshVersion: '0.2.1-rc.4',
    profile: 'sdk',
    environment: {
      directory: 'runtime',
      patch: 'cordis.patch.yml',
      digest: await treeDigest(path.join(dataset, 'runtime')),
    },
  },
  executor: model,
  optimizer: model,
  candidate: { patch: 'cordis.patch.yml', build: { image, timeoutSeconds: 60 }, qa: null },
  evaluator: { image, command: ['node', '/evaluation/grade.mjs'], timeoutSeconds: 30 },
  tasks: [
    {
      id: 'arithmetic',
      prompt:
        'Read /input/request.json. Use your bash tool to calculate the inclusive integer sum from from to to using Python. Write JSON {"sum": value} to /workspace/result.json and finish.',
      input: 'input',
      inputDigest: await treeDigest(path.join(dataset, 'input')),
      evaluation: 'private',
      evaluationDigest: await treeDigest(path.join(dataset, 'private')),
    },
  ],
  concurrency: 1,
  repetitions: 1,
  failureLimit: 0,
  timeoutSeconds: taskTimeoutSeconds,
});
await writeFile(path.join(root, 'experiment.json'), JSON.stringify(spec, null, 2));
const store = new Store(path.join(root, 'experiment.sqlite'), spec);
let controller = new Controller(root, dataset, spec, store);
const receipt = {
  passed: false,
  image,
  startedAt: new Date().toISOString(),
  timeouts: { taskSeconds: taskTimeoutSeconds, modelHttpSeconds: httpTimeoutSeconds },
};
try {
  await controller.start();
  const candidate = await controller.seed(path.join(root, 'seed'));
  const abort = new AbortController();
  const pumping = controller.pump(abort.signal);
  let pumpDone = false;
  const observedPump = pumping.then(
    () => {
      pumpDone = true;
      return null;
    },
    (error) => {
      pumpDone = true;
      return error;
    },
  );
  const deadline = Date.now() + (spec.candidate.build.timeoutSeconds + 2 * spec.timeoutSeconds) * 1000;
  let workerID, brokerID;
  while (!pumpDone) {
    const run = store.runs(candidate.digest)[0];
    if (run?.phase === 'executing' && (await controller.docker.inspect(run.container))?.Running) {
      workerID = (await controller.docker.configuration(run.container)).Id;
      const intent = JSON.parse(
        await readFile(path.join(root, 'runs', run.id, 'egress/intent.json'), 'utf8'),
      );
      brokerID = (await controller.docker.configuration(intent.broker)).Id;
      break;
    }
    if (Date.now() > deadline) throw Error('No running executor before recovery deadline');
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  if (!workerID || !brokerID) {
    const failure = await observedPump;
    throw Error(
      `No running worker before interruption: ${failure ?? JSON.stringify(store.candidate(candidate.digest))}`,
    );
  }
  abort.abort(Error('acceptance controller interruption'));
  assert.ok(await observedPump, 'Controller wait must observe interruption');
  await controller.close();
  controller = new Controller(root, dataset, spec, store);
  await controller.start();
  await controller.pump();
  const run = store.runs(candidate.digest)[0];
  assert.equal(run.phase, 'scored', run.error);
  assert.equal(run.grade.score, 1);
  const runRoot = path.join(root, 'runs', run.id);
  const completed = JSON.parse(await readFile(path.join(runRoot, 'execution-completion.json'), 'utf8'));
  assert.equal(completed.reference.id, workerID);
  const intent = JSON.parse(await readFile(path.join(runRoot, 'egress/intent.json'), 'utf8'));
  const release = JSON.parse(await readFile(path.join(runRoot, 'egress/release.json'), 'utf8'));
  assert.equal(release.phase, 'released');
  const resolverFile = path.join(runRoot, 'egress/resolv.conf');
  assert.equal(
    await readFile(resolverFile, 'utf8'),
    spec.isolation.network.egressDns.map((ip) => `nameserver ${ip}\n`).join(''),
  );
  assert.equal(release.evidence['resolv.conf'], await fileDigest(resolverFile));
  const brokerObserved = JSON.parse(await readFile(path.join(runRoot, 'egress/observed.json'), 'utf8'));
  assert.equal(brokerObserved.observed.settings.Runtime, spec.isolation.runtime);
  assert.equal(brokerObserved.observed.mounts.find((m) => m.Destination === '/etc/resolv.conf')?.RW, false);
  assert.equal(release.containers.find((c) => c.name === intent.broker)?.id, brokerID);
  assert.equal(await controller.docker.inspect(run.container), undefined);
  assert.equal(await controller.docker.inspect(intent.broker), undefined);
  assert.equal(intent.phase, 'stopped');
  const usage = JSON.parse(await readFile(path.join(root, 'runs', run.id, 'trace/metrics.json'), 'utf8'));
  const ledger = (await readFile(path.join(root, 'runs', run.id, 'egress/ledger/requests.jsonl'), 'utf8'))
    .trim()
    .split('\n')
    .map(JSON.parse);
  const starts = ledger.filter((e) => e.phase === 'started').length;
  assert.ok(starts > 0);
  const finished = ledger.filter((e) => e.phase === 'finished');
  assert.equal(finished.length, starts);
  const startedIds = ledger.filter((e) => e.phase === 'started').map((e) => e.id);
  assert.equal(new Set(startedIds).size, starts);
  for (const id of startedIds) assert.equal(finished.filter((e) => e.id === id).length, 1);
  assert.ok(
    finished.every((e) => e.address && e.upstreamStatus === 200),
    'Every request reached its authenticated upstream',
  );
  assert.equal(usage.failed, 0);
  assert.ok(usage.started > 0);
  assert.equal(usage.unfinished, 0);
  assert.equal(usage.results, usage.started);
  await controller.pump();
  assert.equal(
    (await readFile(path.join(root, 'runs', run.id, 'egress/ledger/requests.jsonl'), 'utf8'))
      .trim()
      .split('\n')
      .map(JSON.parse)
      .filter((e) => e.phase === 'started').length,
    starts,
  );
  Object.assign(receipt, {
    passed: true,
    workerID,
    brokerID,
    score: run.grade.score,
    taskAttempt: run.attempt,
    sameContainersRecovered: true,
    terminalEvidenceArchived: true,
    originalContainersReclaimed: true,
    noExtraRequestsOnCompletedResume: true,
    resolverContractVerified: true,
    brokerRuntime: spec.isolation.runtime,
    brokerDns: spec.isolation.network.egressDns,
    usage,
    httpStarted: starts,
    httpFinished: finished.length,
    httpOutcomes: Object.fromEntries(
      [...new Set(finished.map((e) => e.outcome))].map((outcome) => [
        outcome,
        finished.filter((e) => e.outcome === outcome).length,
      ]),
    ),
  });
} catch (error) {
  receipt.error = String(error);
  throw error;
} finally {
  await controller.close();
  store.close();
  await writeFile(path.join(root, 'acceptance.json'), JSON.stringify(receipt, null, 2));
  console.log(JSON.stringify(receipt));
}
