import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { atomicJSON, digest, treeDigest } from '../src/artifacts.js';
import { Docker, type ContainerSpec } from '../src/docker.js';
import type { EgressFactory } from '../src/egress-session.js';
import { containerIdentity } from '../src/isolation.js';
import {
  OptimizerStudy,
  studyCases,
  studyBaselineMethod,
  type FrozenStudyMethodRef,
} from '../src/optimizer-study-contracts.js';
import { OptimizerStudyStore } from '../src/optimizer-study-store.js';
import { evolveOptimizerStudy } from '../src/optimizer-study-runner.js';
import {
  OptimizerStudyCoordinator,
  prepareOptimizerStudy,
  type StudyTransport,
} from '../src/optimizer-study.js';
import { optimizerArtifactFixture } from './optimizer-fixture.js';
import { specification } from './fixtures.js';

// These tests drive the real host ledger/HTTP/execution lifecycle with a synthetic container driver.
// They never invoke a model or represent a successful native optimizer/benchmark acceptance.
const terminal = {
  Status: 'exited',
  Running: false,
  ExitCode: 0,
  StartedAt: '2026-10-28T00:00:00Z',
  FinishedAt: '2026-10-28T00:00:01Z',
};
class Driver extends Docker {
  creations: ContainerSpec[] = [];
  collections = 0;
  halts = 0;
  exitCode = 0;
  malformedMetrics = false;
  onCollect: (spec: ContainerSpec, signal?: AbortSignal) => Promise<void> = async () => {};
  override async create(spec: ContainerSpec) {
    this.creations.push(spec);
  }
  override async inspect() {
    return terminal;
  }
  override async executionReference(spec: ContainerSpec) {
    return { name: spec.name, id: spec.name, intent: containerIdentity(spec) };
  }
  override async halt() {
    this.halts++;
  }
  override async collect(spec: ContainerSpec, logDir: string, signal?: AbortSignal) {
    this.collections++;
    await this.onCollect(spec, signal);
    await mkdir(logDir, { recursive: true });
    for (const file of ['isolation.json', 'isolation-final.json'])
      await atomicJSON(path.join(logDir, file), { intent: containerIdentity(spec), containerId: spec.name });
    for (const file of ['stdout.log', 'stderr.log']) await writeFile(path.join(logDir, file), '');
    const trace = spec.mounts.find((mount) => mount.target === '/trace')!.source;
    await writeFile(
      path.join(trace, 'requests.jsonl'),
      this.malformedMetrics
        ? '{bad-json'
        : [
            { id: 'fixture-request', kind: 'started' },
            {
              id: 'fixture-request',
              kind: 'result',
              durationMs: 1,
              usage: { inputTokens: 3, outputTokens: 2 },
            },
          ]
            .map((row) => JSON.stringify(row))
            .join('\n'),
    );
    return { ...terminal, ExitCode: this.exitCode };
  }
}
class Coordinator extends OptimizerStudyCoordinator {
  pumpCount = 0;
  validations = 0;
  beforeValidation: () => Promise<void> = async () => {};
  beforePump: (() => Promise<void>) | undefined;
  override async pump(transport: StudyTransport, signal?: AbortSignal) {
    signal?.throwIfAborted();
    assert.equal(transport.endpoint, 'http://192.0.2.2:0');
    await this.beforePump?.();
    this.pumpCount++;
    for (const method of this.store.methods()) {
      if (method.phase === 'preparing')
        this.store.failMethod(this.owner, method.id, 'synthetic build failure');
      if (method.phase === 'ready') this.complete(method.methodIdentity!, 'development');
    }
  }
  override async submitMethod(raw: Parameters<OptimizerStudyCoordinator['submitMethod']>[0]) {
    return this.store.reserveMethod(this.owner, {
      source: { directory: 'methods/synthetic/source', digest: digest('synthetic change') },
      composition: raw.composition,
      proposal: raw.proposal as Parameters<OptimizerStudyStore['reserveMethod']>[1]['proposal'],
    });
  }
  private complete(method: string, stage: 'development' | 'validation') {
    const cases = studyCases(this.spec, stage);
    for (const item of cases)
      for (let repetition = 0; repetition < this.spec.repetitions; repetition++) {
        const job = this.store.reserveJob(this.owner, { stage, method, caseId: item.id, repetition });
        if (job.phase === 'complete') continue;
        this.store.startJob(this.owner, job.id, digest(['search', job.id]));
        this.store.startAssessment(this.owner, job.id, item.seed, digest(['assessment', job.id]));
        this.store.completeJob(this.owner, job.id, {
          score: 0.5,
          failures: 0,
          denominator: item.assessment.specification.tasks.length * item.assessment.specification.repetitions,
          constraintsSatisfied: true,
          reportDigest: digest(['fixture-report', job.id]),
        });
      }
  }
  override async runValidation(transport: StudyTransport, signal?: AbortSignal) {
    signal?.throwIfAborted();
    assert.equal(transport.endpoint, 'http://192.0.2.2:0');
    this.validations++;
    await this.beforeValidation();
    this.complete(this.store.state().selectedMethod!, 'validation');
    this.store.finish(this.owner, 'Synthetic lifecycle validation complete');
    await this.report();
    return this.store.state();
  }
}
async function fixture() {
  const parent = await mkdtemp(path.join(os.tmpdir(), 'he-meta-runner-'));
  const root = path.join(parent, 'study'),
    inputs = path.join(parent, 'dataset');
  const base = specification();
  await optimizerArtifactFixture(parent, base);
  if (base.optimizerHarness.kind !== 'artifact') throw Error('fixture');
  const method: FrozenStudyMethodRef = {
    source: base.optimizerHarness.source,
    artifact: base.optimizerHarness.artifact,
    composition: base.optimizerHarness.composition,
  };
  const cases = [];
  for (const id of ['development', 'sealed']) {
    const pair = [];
    for (const role of ['search', 'assessment']) {
      const child = structuredClone(base),
        directory = `${id}/${role}`;
      if (role === 'assessment') {
        child.purpose = 'validation';
        child.budget.candidates = 1;
        child.probes = null;
      }
      for (const task of child.tasks) {
        for (const area of [task.input, task.evaluation]) {
          await mkdir(path.join(inputs, directory, area), { recursive: true });
          await writeFile(path.join(inputs, directory, area, 'data.txt'), `${id}/${role}/${area}`);
        }
        task.inputDigest = await treeDigest(path.join(inputs, directory, task.input));
        task.evaluationDigest = await treeDigest(path.join(inputs, directory, task.evaluation));
      }
      pair.push({
        specification: child,
        dataset: { directory, digest: await treeDigest(path.join(inputs, directory)) },
      });
    }
    cases.push({
      id,
      seed: { source: method.source, artifact: method.artifact },
      search: pair[0],
      assessment: pair[1],
    });
  }
  const spec = OptimizerStudy.parse({
    name: 'meta-runner',
    objective: 'Improve optimizer plugins using development evidence',
    baseline: method,
    metaOptimizer: method,
    metaRuntime: { runtime: base.runtime, model: base.optimizer, isolation: base.isolation, egress: [] },
    methodBuild: base.candidate.build,
    methodQA: null,
    developmentCases: [cases[0]],
    validationCases: [cases[1]],
    repetitions: 1,
    budget: { methodCandidates: 3, metaOptimizerSeconds: 10, concurrentSearches: 1 },
    selection: { failureLimit: 0 },
  });
  await prepareOptimizerStudy(root, spec, inputs);
  const store = new OptimizerStudyStore(path.join(root, 'study.sqlite'), spec),
    driver = new Driver();
  const coordinator = new Coordinator(root, store, driver);
  let aborts = 0;
  const gateways: EgressFactory = () => ({
    async prepare() {},
    async verify() {},
    async stop() {},
    async release() {},
    async abort() {
      aborts++;
    },
    async candidateNetwork() {
      return 'none';
    },
  });
  const options = {
    host: '127.0.0.1',
    port: 0,
    endpoint: 'http://127.0.0.1:0',
    childTransport: { host: '127.0.0.1', port: 0, endpoint: 'http://192.0.2.2:0' },
  };
  async function request(route: string, body: unknown = {}) {
    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(path.join(root, 'meta-optimizer/control-transport.sqlite'), {
      readOnly: true,
    });
    const row = db.prepare('SELECT record FROM transport').get();
    db.close();
    const endpoint = JSON.parse(String(row!.record)).controlEndpoint;
    const token = await readFile(path.join(root, 'meta-controller-token'), 'utf8');
    const response = await fetch(new URL(route, endpoint), {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw Error(await response.text());
    return (await response.json()) as Record<string, unknown>;
  }
  async function cleanup() {
    store.close();
    async function writable(directory: string): Promise<void> {
      await chmod(directory, 0o755);
      for (const item of await readdir(directory, { withFileTypes: true }))
        if (item.isDirectory()) await writable(path.join(directory, item.name));
    }
    await writable(parent);
    await rm(parent, { recursive: true });
  }
  return {
    root,
    store,
    coordinator,
    driver,
    request,
    options,
    gateways,
    aborts: () => aborts,
    cleanup,
    run: (signal?: AbortSignal) =>
      evolveOptimizerStudy(coordinator, { ...options, ...(signal ? { signal } : {}) }, gateways),
  };
}

test('meta uses real study HTTP, native preset and sealed mounts; persists completion before closing capability and validation', async () => {
  const f = await fixture();
  try {
    f.driver.onCollect = async (execution) => {
      assert.equal(f.store.metaEpisodes()[0]!.phase, 'running');
      assert.ok(f.coordinator.pumpCount >= 1);
      const status = await f.request('/study/status');
      assert.ok(!JSON.stringify(status).includes('sealed'));
      const reference = {
        kind: 'method',
        id: f.store.methods()[0]!.id,
        area: 'source',
        file: 'package-lock.json',
      };
      const evidence = await f.request('/study/evidence', reference);
      const materialized = await f.request('/study/materialize', reference);
      const actual = await readFile(
        path.join(f.root, 'materialized', String(materialized.path).replace(/^\/evidence\//, '')),
      );
      assert.deepEqual(actual, Buffer.from(String(evidence.data), 'base64'));
      const allowed = [
        '/method',
        '/workspace',
        '/evidence',
        '/trace',
        '/launch.json',
        '/optimizer.patch.yml',
      ];
      assert.deepEqual(
        execution.mounts.map((item) => item.target),
        allowed,
      );
      assert.equal(execution.mounts.find((m) => m.target === '/evidence')!.writable, false);
      const patch = await readFile(
        execution.mounts.find((m) => m.target === '/optimizer.patch.yml')!.source,
        'utf8',
      );
      assert.match(patch, /study-plugin\.js/);
      assert.doesNotMatch(patch, /\/dist\/plugin\.js/);
      assert.equal(
        JSON.parse(await readFile(execution.mounts.find((m) => m.target === '/launch.json')!.source, 'utf8'))
          .profile,
        'sdk',
      );
      await f.request('/study/finish', { reason: 'Development evidence examined' });
    };
    f.coordinator.beforeValidation = async () => {
      assert.equal(f.store.metaEpisodes()[0]!.phase, 'complete');
      const receipt = JSON.parse(await readFile(path.join(f.root, 'meta-optimizer/0/receipt.json'), 'utf8'));
      assert.equal(digest(receipt), f.store.metaEpisodes()[0]!.receiptDigest);
      await assert.rejects(f.request('/study/status'), /fetch failed/);
    };
    await f.run();
    assert.equal(f.store.state().phase, 'complete');
    assert.equal(f.driver.creations.length, 1);
    const metrics = JSON.parse(
      await readFile(path.join(f.root, 'meta-optimizer/0/trace/metrics.json'), 'utf8'),
    );
    assert.equal(metrics.started, 1);
    assert.equal(metrics.inputTokensReported, 3);
    await f.run();
    assert.equal(f.driver.creations.length, 1);
    assert.equal(f.coordinator.validations, 1);
  } finally {
    await f.cleanup();
  }
});

test('submitted method triggers an independent pump while the native session awaits study events', async () => {
  const f = await fixture();
  try {
    f.driver.onCollect = async () => {
      const before = f.coordinator.pumpCount;
      await f.request('/study/submit', {
        composition: 'plugins.yml',
        proposal: {
          draft: 'candidate',
          parents: [studyBaselineMethod(f.store.spec).source.digest],
          actions: ['author'],
          evidence: ['development fixture'],
          hypothesis: 'Synthetic lifecycle action',
          expectedChange: 'Test pump',
        },
      });
      let status = await f.request('/study/status');
      for (let count = 0; count < 10 && f.coordinator.pumpCount === before; count++) {
        await f.request('/study/events', { cursor: status.cursor, timeoutMs: 100, limit: 100 });
        status = await f.request('/study/status');
      }
      assert.ok(f.coordinator.pumpCount > before);
      assert.equal(f.store.methods()[1]!.phase, 'failed');
      await f.request('/study/finish', { reason: 'Recorded synthetic preparation failure' });
    };
    await f.run();
    assert.equal(f.coordinator.validations, 1);
  } finally {
    await f.cleanup();
  }
});

test('parent abort stops observation; restart collects the original episode without another container', async () => {
  const f = await fixture(),
    abort = new AbortController();
  try {
    f.driver.onCollect = async (_execution, signal) => {
      abort.abort(Error('observer left'));
      signal!.throwIfAborted();
    };
    await assert.rejects(f.run(abort.signal), /observer left/);
    assert.equal(f.store.metaEpisodes()[0]!.phase, 'running');
    assert.equal(f.aborts(), 0);
    assert.equal(f.driver.halts, 0);
    assert.equal(f.driver.creations.length, 1);
    f.driver.onCollect = async () => {
      await f.request('/study/finish', { reason: 'Recovered original session' });
    };
    await f.run();
    assert.equal(f.driver.creations.length, 1);
    assert.equal(f.driver.collections, 2);
  } finally {
    await f.cleanup();
  }
});

test('failed native episode remains terminal and cannot launch a replacement on resume', async () => {
  const f = await fixture();
  try {
    f.driver.exitCode = 9;
    await assert.rejects(f.run(), /exited 9/);
    assert.equal(f.store.metaEpisodes()[0]!.phase, 'failed');
    assert.equal(f.store.metaEpisodes()[0]!.actualSeconds, 1);
    await assert.rejects(f.run(), /no automatic retry/);
    assert.equal(f.driver.creations.length, 1);
    assert.equal(f.coordinator.validations, 0);
  } finally {
    await f.cleanup();
  }
});

test('recovery restores HTTP before awaiting an already-running child search', async () => {
  const f = await fixture(),
    abort = new AbortController();
  try {
    f.driver.onCollect = async (_execution, signal) => {
      abort.abort(Error('observer disconnected'));
      signal!.throwIfAborted();
    };
    await assert.rejects(f.run(abort.signal), /observer disconnected/);
    let release!: () => void;
    const pendingChild = new Promise<void>((resolve) => {
      release = resolve;
    });
    f.coordinator.beforePump = () => pendingChild;
    f.driver.onCollect = async () => {
      const status = await f.request('/study/status');
      assert.equal((status.metaEpisodes as Array<{ phase: string }>)[0]!.phase, 'running');
      release();
      await f.request('/study/finish', {
        reason: 'Original HTTP session recovered with child still in flight',
      });
    };
    await f.run();
    assert.equal(f.driver.creations.length, 1);
    assert.equal(f.store.metaEpisodes().length, 1);
  } finally {
    await f.cleanup();
  }
});

test('pre-execution infrastructure failure has unknown measured duration and no replacement budget', async () => {
  const f = await fixture();
  try {
    const failing: EgressFactory = (...args) => ({
      ...f.gateways(...args),
      async prepare() {
        throw Error('Synthetic broker preparation failure');
      },
    });
    await assert.rejects(
      evolveOptimizerStudy(f.coordinator, f.options, failing),
      /broker preparation failure/,
    );
    assert.equal(f.store.metaEpisodes()[0]!.phase, 'failed');
    assert.equal(f.store.metaEpisodes()[0]!.actualSeconds, null);
    assert.equal(f.store.metaEpisodes()[0]!.seconds, 10);
    assert.equal(f.driver.creations.length, 0);
    await assert.rejects(f.run(), /no automatic retry/);
    assert.equal(f.driver.creations.length, 0);
  } finally {
    await f.cleanup();
  }
});

test('completed normal sessions consume the durable budget and validation receives no meta capability', async () => {
  const f = await fixture();
  try {
    await f.run();
    assert.equal(f.driver.creations.length, 10);
    assert.deepEqual(
      f.store.metaEpisodes().map((row) => row.seconds),
      [10, 9, 8, 7, 6, 5, 4, 3, 2, 1],
    );
    assert.equal(
      f.store.metaEpisodes().reduce((sum, row) => sum + row.actualSeconds!, 0),
      10,
    );
    assert.equal(f.driver.creations[1]!.mounts.find((m) => m.target === '/previous')!.writable, false);
    const conclusion = JSON.parse(await readFile(path.join(f.root, 'development-conclusion.json'), 'utf8'));
    assert.equal(conclusion.reason, 'meta_optimizer_budget_exhausted');
  } finally {
    await f.cleanup();
  }
});

test('interrupted failure reclamation resumes cleanup and persists a terminal failed episode', async () => {
  const f = await fixture();
  let cleanups = 0;
  try {
    f.driver.onCollect = async () => {
      throw Error('Synthetic execution transport failure');
    };
    const gateway: EgressFactory = (...args) => ({
      ...f.gateways(...args),
      async abort() {
        cleanups++;
        if (cleanups === 1) throw Error('Synthetic temporary cleanup failure');
      },
    });
    await assert.rejects(evolveOptimizerStudy(f.coordinator, f.options, gateway), /Resource reclamation/);
    assert.equal(f.store.metaEpisodes()[0]!.phase, 'running');
    await assert.rejects(evolveOptimizerStudy(f.coordinator, f.options, gateway), /transport failure/);
    assert.equal(f.store.metaEpisodes()[0]!.phase, 'failed');
    assert.equal(f.store.metaEpisodes()[0]!.actualSeconds, null);
    assert.equal(cleanups, 2);
    assert.equal(f.driver.creations.length, 1);
    assert.equal(f.driver.collections, 1);
  } finally {
    await f.cleanup();
  }
});

test('malformed original telemetry fails the episode without stranding its ledger or rewriting events', async () => {
  const f = await fixture();
  try {
    f.driver.malformedMetrics = true;
    await assert.rejects(f.run(), /JSON/);
    assert.equal(f.store.metaEpisodes()[0]!.phase, 'failed');
    assert.equal(f.store.metaEpisodes()[0]!.actualSeconds, 1);
    assert.equal(
      await readFile(path.join(f.root, 'meta-optimizer/0/trace/requests.jsonl'), 'utf8'),
      '{bad-json',
    );
    const receipt = JSON.parse(await readFile(path.join(f.root, 'meta-optimizer/0/receipt.json'), 'utf8'));
    assert.match(receipt.metricsError, /JSON/);
    await assert.rejects(f.run(), /no automatic retry/);
    assert.equal(f.driver.creations.length, 1);
  } finally {
    await f.cleanup();
  }
});

test('validation recovery launches no meta endpoint or session', async () => {
  const f = await fixture();
  try {
    await f.coordinator.start();
    await f.coordinator.pump(f.options.childTransport);
    await f.coordinator.finishDevelopment('Previously frozen selection');
    f.coordinator.beginValidation();
    await f.coordinator.close();
    await f.run();
    assert.equal(f.driver.creations.length, 0);
    assert.equal(f.store.state().phase, 'complete');
    await assert.rejects(readFile(path.join(f.root, 'meta-controller-token')), { code: 'ENOENT' });
  } finally {
    await f.cleanup();
  }
});
