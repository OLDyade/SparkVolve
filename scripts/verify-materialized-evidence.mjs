import assert from 'node:assert/strict';
import { randomBytes, createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, cp } from 'node:fs/promises';
import { isIP } from 'node:net';
import { parseArgs, isDeepStrictEqual } from 'node:util';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { stringify } from 'yaml';
import { Experiment, Image, Isolation, Model } from '../dist/contracts.js';
import { Controller } from '../dist/controller.js';
import { Store } from '../dist/store.js';
import { serve } from '../dist/api.js';
import { treeDigest, atomicJSON, fileDigest, confined } from '../dist/artifacts.js';
import { Docker } from '../dist/docker.js';
import { evolutionPreset, sdkPreset } from '../dist/preset.js';
import { createEgressSession } from '../dist/egress-session.js';
import { controlRoutes } from '../dist/control-routes.js';
import {
  prepareExecution,
  collectExecution,
  settleExecutionFailure,
  ReclamationError,
} from '../dist/execution.js';
import { configureEgress } from '../examples/venus/egress.mjs';

// A real-model native interface acceptance. No search, scored task, retry, or candidate promotion.
const { values } = parseArgs({
  options: Object.fromEntries(
    ['root', 'image', 'isolation', 'model', 'controller-ip'].map((key) => [key, { type: 'string' }]),
  ),
});
for (const key of ['root', 'image', 'isolation', 'model', 'controller-ip'])
  assert.ok(values[key], `Required --${key}`);
assert.ok(process.env.VENUS_API_KEY, 'Trusted launcher requires VENUS_API_KEY');
assert.equal(
  isIP(values['controller-ip']),
  4,
  'Pass the explicit container-reachable IPv4 controller address',
);
const image = Image.parse(values.image);
const isolation = Isolation.parse(JSON.parse(await readFile(values.isolation, 'utf8')));
assert.equal(
  isolation.network.executor,
  'controlled',
  'Use the explicit controlled-network acceptance policy',
);
const repo = fileURLToPath(new URL('..', import.meta.url));
const root = path.resolve(values.root),
  dataset = path.join(root, 'dataset');
await mkdir(path.dirname(root), { recursive: true });
await mkdir(root);
for (const directory of [
  'dataset/input',
  'dataset/private',
  'seed',
  'work',
  'materialized',
  'execution/trace',
])
  await mkdir(path.join(root, directory), { recursive: true });
const receipt = {
  passed: false,
  startedAt: new Date().toISOString(),
  image,
  boundary:
    'Native materialization interface acceptance with a real model; no task score, search effectiveness, or quality gain claim. The fixture candidate remains frozen and is never executed or promoted.',
};
let store, controller, server, gateway;
const executionRoot = path.join(root, 'execution');
const docker = new Docker();
try {
  await cp(path.join(repo, 'examples/venus'), path.join(dataset, 'environment'), { recursive: true });
  await cp(path.join(repo, 'optimizers/evidence-driven'), path.join(dataset, 'method'), { recursive: true });
  const model = Model.parse({ ...JSON.parse(await readFile(values.model, 'utf8')), maxTokens: 4096 });
  const egress = await configureEgress(path.join(dataset, 'environment'), model);
  // Random bytes are held on the trusted host. Neither bytes nor expected hash are included in the prompt.
  const bytes = randomBytes(8192),
    sha256 = createHash('sha256').update(bytes).digest('hex');
  await writeFile(path.join(root, 'seed/payload.bin'), bytes);
  const pkg = {
    name: '@harness-evolution/materialization-fixture',
    version: '1.0.0',
    type: 'module',
    scripts: { build: 'node --check index.mjs' },
    files: ['index.mjs', 'cordis.patch.yml', 'payload.bin'],
    dsh: { bundle: { patch: './cordis.patch.yml' } },
  };
  await writeFile(path.join(root, 'seed/package.json'), JSON.stringify(pkg));
  await writeFile(
    path.join(root, 'seed/package-lock.json'),
    JSON.stringify({
      name: pkg.name,
      version: pkg.version,
      lockfileVersion: 3,
      packages: { '': { name: pkg.name, version: pkg.version } },
    }),
  );
  await writeFile(path.join(root, 'seed/index.mjs'), 'export function apply() {}\n');
  await writeFile(path.join(root, 'seed/cordis.patch.yml'), '[]\n');
  const spec = Experiment.parse({
    name: 'materialized-evidence-native-acceptance',
    purpose: 'search',
    objective: 'Verify native materialization transport; do not submit mutations or schedule tasks.',
    isolation,
    runtime: {
      image,
      dshVersion: '0.2.1-rc.4',
      profile: 'sdk',
      environment: {
        directory: 'environment',
        patch: 'cordis.patch.yml',
        digest: await treeDigest(path.join(dataset, 'environment')),
      },
    },
    egress,
    executor: model,
    optimizer: model,
    optimizerHarness: {
      directory: 'method',
      digest: await treeDigest(path.join(dataset, 'method')),
      composition: 'plugins.yml',
    },
    researchLibrary: null,
    candidate: { patch: 'cordis.patch.yml', build: { image, timeoutSeconds: 60 }, qa: null },
    evaluator: {
      image,
      command: ['node', '-e', 'throw Error("No scored task belongs to this interface acceptance")'],
      timeoutSeconds: 10,
    },
    tasks: [
      {
        id: 'not-scheduled',
        prompt: 'Protocol acceptance only; this task must never execute.',
        input: 'input',
        inputDigest: await treeDigest(path.join(dataset, 'input')),
        evaluation: 'private',
        evaluationDigest: await treeDigest(path.join(dataset, 'private')),
      },
    ],
    repetitions: 1,
    concurrency: 1,
    timeoutSeconds: 180,
    failureLimit: 0,
    budget: { candidates: 1, optimizerSeconds: 180 },
    probes: null,
    metric: { name: 'not-measured', direction: 'maximize', minimum: 0, maximum: 1, failure: 0 },
    constraints: [],
  });
  await atomicJSON(path.join(root, 'experiment.json'), spec);
  store = new Store(path.join(root, 'experiment.sqlite'), spec);
  controller = new Controller(root, dataset, spec, store, docker);
  await controller.start();
  const candidate = await controller.seed(path.join(root, 'seed'));
  const token = randomBytes(32).toString('hex');
  server = await serve(controller, token, 0, '0.0.0.0');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const endpoint = `http://${values['controller-ip']}:${address.port}`;
  const reference = { kind: 'candidate', id: candidate.digest, area: 'source', file: 'payload.bin' };
  await writeFile(
    path.join(executionRoot, 'cordis.patch.yml'),
    stringify([
      {
        insert: [
          ...sdkPreset('evolution', '/app/dist/sdk-preset.js'),
          evolutionPreset({
            plugin: '/app/dist/plugin.js',
            endpoint: 'http://evolution-egress:8080',
            tokenEnv: 'EVOLUTION_TOKEN',
          }),
        ],
      },
    ]),
  );
  await atomicJSON(path.join(executionRoot, 'launch.json'), {
    profile: 'sdk',
    model,
    patch: '/optimizer.patch.yml',
    environmentPatch: '/environment/cordis.patch.yml',
    timeoutSeconds: 180,
    prompt: [
      'Perform this one native interface acceptance; do not run an optimization search, submit mutations, or grade tasks.',
      `Call evolution_materialize with ${JSON.stringify(reference)}. Use the returned path as a filesystem path; do not transcribe or decode base64.`,
      'Use bash to read those actual bytes, copy them unchanged to /workspace/observed.bin, and independently compute their byte length and SHA256.',
      'In that bash invocation use Python or Node to actually attempt creating /evidence/write-attempt and catch the resulting filesystem exception. Obtain its symbolic operating-system errno from Python errno.errorcode[exception.errno] or Node exception.code. Do not substitute a shell exit status, parse an error message, guess a code, or prefill an expected value. If the write succeeds, record null.',
      'Write /workspace/observed.json with exactly these four fields: path is the unchanged materialization path; bytes is the integer length of the bytes actually read; sha256 is their independently computed lowercase SHA256 hex digest; writeError is the symbolic errno string obtained from that actual write exception, or null on success. A successful write is a failed boundary and must remain visible.',
      'Do not alter the materialized source. Finish with a brief message after saving both observations. No other task is required.',
    ].join('\n'),
  });
  await atomicJSON(path.join(root, 'registration.json'), {
    kind: 'real-model-native-materialization-interface',
    image,
    isolation,
    model,
    reference,
    hostExpected: { bytes: bytes.length, sha256 },
    promptReceivesExpectedHash: false,
    environmentDigest: spec.runtime.environment.digest,
    sourceDigest: candidate.digest,
    driverSha256: await fileDigest(fileURLToPath(import.meta.url)),
    startedAt: receipt.startedAt,
  });
  const name = `he-materialize-live-${randomUUID()}`;
  gateway = createEgressSession(
    {
      root: path.join(executionRoot, 'egress'),
      execution: name,
      image,
      isolation,
      timeoutSeconds: 180,
      routes: [
        ...controlRoutes(endpoint, 180).filter((route) => route.path === '/materialize'),
        ...egress.optimizer,
      ],
    },
    docker,
  );
  const execution = await prepareExecution(
    executionRoot,
    { reference, image, model, isolation },
    docker,
    gateway,
    async () => ({
      name,
      image,
      command: ['node', '/app/dist/runtime/worker.js', '/launch.json'],
      isolation,
      network: await gateway.candidateNetwork(),
      timeoutSeconds: 180,
      env: Object.fromEntries(
        ['EVOLUTION_TOKEN', ...model.credentialEnv].map((key) => [key, 'egress-client-placeholder']),
      ),
      mounts: [
        { source: path.join(dataset, 'environment'), target: '/environment', writable: false },
        { source: path.join(root, 'materialized'), target: '/evidence', writable: false },
        { source: path.join(root, 'work'), target: '/workspace', writable: true },
        { source: path.join(executionRoot, 'trace'), target: '/trace', writable: true },
        { source: path.join(executionRoot, 'launch.json'), target: '/launch.json', writable: false },
        {
          source: path.join(executionRoot, 'cordis.patch.yml'),
          target: '/optimizer.patch.yml',
          writable: false,
        },
      ],
    }),
    { ...process.env, EVOLUTION_TOKEN: token },
  );
  const result = await collectExecution(executionRoot, execution, executionRoot, docker, gateway);
  receipt.container = result;
  assert.equal(result.ExitCode, 0, 'Native session failed; original trace is preserved');
  const native = JSON.parse(await readFile(path.join(executionRoot, 'trace/receipt.json'), 'utf8'));
  assert.equal(native.status, 'completed');
  const observed = JSON.parse(await readFile(path.join(root, 'work/observed.json'), 'utf8'));
  assert.deepEqual(Object.keys(observed).sort(), ['path', 'bytes', 'sha256', 'writeError'].sort());
  const session = JSON.parse(await readFile(path.join(executionRoot, 'trace/result.json'), 'utf8'));
  const call = session.events.find(
    (event) =>
      event.type === 'tool/call' &&
      event.data.name === 'evolution_materialize' &&
      isDeepStrictEqual(JSON.parse(event.data.arguments), reference),
  );
  assert.ok(call, 'The real model must invoke the native materialization tool for the registered reference');
  const toolResult = session.events.find(
    (event) => event.type === 'tool/result' && event.data.message.toolCallId === call.data.callId,
  );
  assert.ok(toolResult, 'Native materialization call must have a matching result');
  const materializedResult = toolResult.data.message.content
    .filter((block) => block.type === 'text')
    .map((block) => JSON.parse(block.text))
    .find((value) => value.path === observed.path);
  assert.ok(materializedResult, 'Native tool result must identify the file actually copied');
  assert.ok(session.events.some((event) => event.type === 'tool/call' && event.data.name === 'bash'));
  assert.match(observed.path, /^\/evidence\/[a-f0-9]{64}\/files\/payload\.bin$/);
  const materialized = confined(path.join(root, 'materialized'), observed.path.slice('/evidence/'.length));
  assert.deepEqual(await readFile(materialized), bytes);
  assert.deepEqual(await readFile(path.join(root, 'work/observed.bin')), bytes);
  assert.equal(observed.bytes, bytes.length);
  assert.equal(observed.sha256, sha256);
  assert.equal(observed.writeError, 'EROFS');
  const provenance = JSON.parse(
    await readFile(path.join(path.dirname(path.dirname(materialized)), 'provenance.json'), 'utf8'),
  );
  assert.deepEqual(provenance.reference, reference);
  assert.equal(provenance.sha256, sha256);
  assert.equal(provenance.bytes, bytes.length);
  assert.equal(await treeDigest(path.join(root, 'candidates', candidate.digest)), candidate.digest);
  assert.equal(store.runs().length, 0);
  assert.equal(store.probes().length, 0);
  assert.equal(store.candidates().length, 1);
  assert.equal(store.candidate(candidate.digest).phase, 'frozen');
  const usage = JSON.parse(await readFile(path.join(executionRoot, 'trace/metrics.json'), 'utf8'));
  assert.equal(usage.failed, 0);
  assert.equal(usage.unfinished, 0);
  assert.ok(usage.started > 0);
  assert.equal(usage.started, usage.results);
  const requests = (await readFile(path.join(executionRoot, 'egress/ledger/requests.jsonl'), 'utf8'))
    .trim()
    .split('\n')
    .map(JSON.parse);
  const started = requests.filter((item) => item.phase === 'started'),
    finished = requests.filter((item) => item.phase === 'finished');
  for (const entry of started) assert.equal(finished.filter((item) => item.id === entry.id).length, 1);
  assert.equal(started.length, finished.length);
  assert.ok(finished.some((item) => item.route === 'controller_materialize' && item.upstreamStatus === 200));
  const isolationReceipt = JSON.parse(
    await readFile(path.join(executionRoot, 'isolation-final.json'), 'utf8'),
  );
  assert.equal(isolationReceipt.observed.mounts.find((item) => item.Destination === '/evidence').RW, false);
  const release = JSON.parse(await readFile(path.join(executionRoot, 'egress/release.json'), 'utf8'));
  assert.equal(release.phase, 'released');
  Object.assign(receipt, {
    passed: true,
    observed,
    native,
    usage,
    sourceDigest: candidate.digest,
    http: { started: started.length, finished: finished.length },
    sourceUnchanged: true,
    noScoredTasks: true,
    readOnlyMountVerified: true,
    lifecycleReclaimed: true,
    provenance,
  });
} catch (error) {
  receipt.error = String(error);
  if (gateway && !(error instanceof ReclamationError))
    await settleExecutionFailure(executionRoot, docker, gateway, error);
  throw error;
} finally {
  if (server) await new Promise((resolve) => server.close(resolve));
  if (controller) await controller.close();
  store?.close();
  receipt.completedAt = new Date().toISOString();
  await atomicJSON(path.join(root, 'acceptance.json'), receipt);
}
console.log(
  JSON.stringify({
    passed: receipt.passed,
    evidence: root,
    observed: receipt.observed,
    usage: receipt.usage,
  }),
);
