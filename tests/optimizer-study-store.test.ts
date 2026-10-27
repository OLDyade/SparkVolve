import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { digest } from '../src/artifacts.js';
import { OptimizerStudyStore, type StudyJob } from '../src/optimizer-study-store.js';
import {
  OptimizerStudy,
  studyAllocationCeiling,
  studyMethodIdentity,
  studyBaselineMethod,
  type FrozenStudyMethodRef,
  type OptimizerStudySpec,
} from '../src/optimizer-study-contracts.js';
import { specification } from './fixtures.js';
import { studyPaths } from '../src/study-paths.js';

const owner = 'study-coordinator';
const hash = (name: string) => digest(name);
function method(name: string): FrozenStudyMethodRef {
  return {
    source: { directory: `methods/${name}/source`, digest: hash(`${name}-source`) },
    artifact: {
      directory: `methods/${name}/artifact`,
      identity: {
        artifactDigest: hash(`${name}-artifact`),
        bundleDigest: hash(`${name}-bundle`),
        tarballDigest: hash(`${name}-tarball`),
        lockDigest: hash(`${name}-lock`),
        image: specification().runtime.image,
      },
    },
    composition: 'plugins.yml',
  };
}
function spec(): OptimizerStudySpec {
  const base = specification();
  const item = (id: string) => ({
    id,
    seed: { source: method('h0').source, artifact: method('h0').artifact },
    search: { specification: base, dataset: { directory: `${id}/search`, digest: hash(`${id}-search`) } },
    assessment: {
      specification: {
        ...base,
        purpose: 'validation' as const,
        budget: { ...base.budget, candidates: 1 },
        probes: null,
      },
      dataset: { directory: `${id}/assessment`, digest: hash(`${id}-assessment`) },
    },
  });
  return OptimizerStudy.parse({
    name: 'optimizer-study',
    objective: 'Evaluate autonomous optimizer changes under identical allocations',
    baseline: method('g0'),
    metaOptimizer: method('meta'),
    metaRuntime: {
      runtime: base.runtime,
      model: base.optimizer,
      isolation: base.isolation,
      egress: base.egress.optimizer,
    },
    methodBuild: base.candidate.build,
    methodQA: null,
    developmentCases: [item('development')],
    validationCases: [item('sealed')],
    repetitions: 2,
    budget: { methodCandidates: 3, metaOptimizerSeconds: 90, concurrentSearches: 1 },
    selection: { failureLimit: 1 },
  });
}
const proposal = (parent: string, name: string) => ({
  draft: name,
  parents: [parent],
  actions: ['author' as const],
  evidence: ['registered development evidence'],
  hypothesis: 'Change native optimizer behavior',
  expectedChange: 'Independent search-instance quality',
});
function admit(store: OptimizerStudyStore, name: string) {
  const value = method(name);
  const reserved = store.reserveMethod(owner, {
    source: value.source,
    composition: value.composition,
    proposal: proposal(studyBaselineMethod(store.spec).source.digest, name),
  });
  return store.publishMethod(owner, reserved.id, value);
}
function complete(store: OptimizerStudyStore, job: StudyJob, score: number) {
  store.startJob(owner, job.id, hash(`search-${job.id}`));
  store.startAssessment(
    owner,
    job.id,
    { source: method('h1').source, artifact: method('h1').artifact },
    hash(`assessment-${job.id}`),
  );
  return store.completeJob(owner, job.id, {
    score,
    failures: 0,
    denominator: 2,
    constraintsSatisfied: true,
    reportDigest: hash(`report-${job.id}`),
  });
}
function reserve(
  store: OptimizerStudyStore,
  methodId: string,
  repetition: number,
  stage: 'development' | 'validation' = 'development',
) {
  return store.reserveJob(owner, {
    stage,
    method: methodId,
    caseId: stage === 'development' ? 'development' : 'sealed',
    repetition,
  });
}
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'he-optimizer-study-store-'));
  const file = path.join(root, 'study.sqlite'),
    registration = spec();
  const store = new OptimizerStudyStore(file, registration);
  store.acquire(owner, Date.now(), 60_000);
  return { root, file, registration, store };
}

test('study contract binds native methods, data roles and finite equal allocations', () => {
  const registration = spec();
  const moved = structuredClone(registration.baseline);
  moved.source.directory = 'relocated/source';
  moved.artifact.directory = 'relocated/artifact';
  assert.equal(studyMethodIdentity(moved), studyMethodIdentity(registration.baseline));
  moved.artifact.identity.bundleDigest = hash('different-build');
  assert.notEqual(studyMethodIdentity(moved), studyMethodIdentity(registration.baseline));
  assert.deepEqual(studyAllocationCeiling(registration), {
    candidates: 40,
    probes: 0,
    optimizerSeconds: 600,
    searchTasks: 80,
    assessmentTasks: 20,
  });
  const wrong = structuredClone(registration);
  wrong.validationCases[0]!.assessment.specification.metric.failure = 0.1;
  assert.throws(() => OptimizerStudy.parse(wrong), /same metric/);
  wrong.validationCases[0]!.assessment.specification.metric.failure = 0;
  wrong.validationCases[0]!.assessment.dataset.directory = wrong.validationCases[0]!.search.dataset.directory;
  assert.throws(() => OptimizerStudy.parse(wrong), /disjoint/);
  const credentials = structuredClone(registration);
  credentials.metaRuntime.model.credentialEnv = ['MISSING_KEY'];
  assert.throws(() => OptimizerStudy.parse(credentials), /credential/);
  for (const publicPath of ['sealed', 'sealed/search', 'sealed/search/nested']) {
    const crossing = structuredClone(registration);
    crossing.baseline.source.directory = publicPath;
    assert.throws(() => OptimizerStudy.parse(crossing), /Public study mounts must be disjoint/);
  }
  const developmentInput = structuredClone(registration);
  developmentInput.baseline.source.directory = developmentInput.developmentCases[0]!.search.dataset.directory;
  assert.doesNotThrow(() => OptimizerStudy.parse(developmentInput));
  const publicAssessment = structuredClone(registration);
  publicAssessment.methodQA = { directory: 'development', digest: hash('qa'), entry: 'test.mjs' };
  assert.throws(() => OptimizerStudy.parse(publicAssessment), /Public study mounts must be disjoint/);
});

test('meta provider routes cannot shadow any native study capability', () => {
  for (const path of studyPaths) {
    const registration = spec();
    registration.metaRuntime.egress = [
      {
        id: 'provider',
        path,
        method: 'POST',
        upstream: 'https://example.org/v1/chat/completions',
        addresses: { kind: 'public' },
        credential: { env: 'MODEL_KEY', header: 'authorization', prefix: 'Bearer ' },
        body: { kind: 'json', equals: { model: 'frozen' }, maximum: { max_tokens: 1024 } },
        maxRequestBytes: 1024,
        timeoutSeconds: 30,
      },
    ];
    assert.throws(() => OptimizerStudy.parse(registration), /controller capability/);
  }
});

test('study lease, immutable registration and committed cursor survive reopening', async () => {
  const { root, file, registration, store } = await fixture();
  let observer: OptimizerStudyStore | undefined;
  try {
    observer = new OptimizerStudyStore(file, registration, 'read');
    assert.equal(observer.state().phase, 'developing');
    assert.throws(() => observer!.acquire('other', Date.now(), 1000), /readonly/);
    const competing = new OptimizerStudyStore(file, registration);
    try {
      assert.throws(() => competing.acquire('other', Date.now(), 1000), /active coordinator/);
    } finally {
      competing.close();
    }
    assert.throws(
      () => new OptimizerStudyStore(file, { ...registration, objective: 'changed' }),
      /registration changed/,
    );
    const cursor = store.cursor();
    assert.throws(
      () =>
        store.reserveMethod('not-owner', {
          source: method('g1').source,
          composition: 'plugins.yml',
          proposal: proposal(registration.baseline.source.digest, 'g1'),
        }),
      /lease lost/,
    );
    assert.deepEqual(store.cursor(), cursor);
    admit(store, 'g1');
    assert.equal(observer.page(cursor).events.length, 2);
    assert.throws(() => observer!.page({ ...cursor, sequence: 99_999 }), /cursor/);
  } finally {
    observer?.close();
    store.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('method slots are reserved before builds and failed methods cannot be resampled', async () => {
  const { root, file, registration, store } = await fixture();
  let reopened: OptimizerStudyStore | undefined;
  try {
    const failed = method('broken');
    const input = {
      source: failed.source,
      composition: failed.composition,
      proposal: proposal(registration.baseline.source.digest, 'broken'),
    };
    const pending = store.reserveMethod(owner, input);
    assert.equal(pending.phase, 'preparing');
    store.failMethod(owner, pending.id, 'native method build failed');
    assert.equal(store.reserveMethod(owner, input).phase, 'failed');
    assert.throws(() => store.publishMethod(owner, pending.id, failed), /awaiting preparation/);
    const good = admit(store, 'good');
    assert.equal(good.ordinal, 2);
    assert.throws(
      () =>
        store.reserveMethod(owner, {
          source: method('extra').source,
          composition: 'plugins.yml',
          proposal: proposal(registration.baseline.source.digest, 'extra'),
        }),
      /budget exhausted/,
    );
    store.release(owner);
    reopened = new OptimizerStudyStore(file, registration);
    reopened.acquire('resumed', Date.now(), 60_000);
    assert.equal(reopened.method(pending.id).phase, 'failed');
    assert.equal(reopened.methods().length, 3);
  } finally {
    reopened?.close();
    store.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('job reservation, concurrency, frozen selection and full failed denominator are durable', async () => {
  const { root, file, registration, store } = await fixture();
  let reopened: OptimizerStudyStore | undefined;
  try {
    const baseline = studyMethodIdentity(registration.baseline);
    const first = reserve(store, baseline, 0),
      second = reserve(store, baseline, 1);
    const allocation = store.reservedAllocation();
    assert.deepEqual(reserve(store, baseline, 0), first);
    assert.deepEqual(store.reservedAllocation(), allocation);
    store.startJob(owner, first.id, hash('child'));
    assert.throws(() => store.startJob(owner, second.id, hash('second')), /concurrency/);
    assert.equal(store.job(second.id).phase, 'reserved');
    store.failJob(owner, first.id, 'upstream execution failed');
    complete(store, second, 0.8);
    const report = store.methodReport(baseline, 'development');
    assert.equal(report.complete, true);
    assert.equal(report.denominator, 2);
    assert.equal(report.failures, 1);
    assert.equal(report.mean, 0.4);
    assert.equal(store.job(first.id).phase, 'failed');
    assert.throws(() => store.startJob(owner, first.id, hash('child')), /cannot start/);
    store.release(owner);
    reopened = new OptimizerStudyStore(file, registration);
    reopened.acquire(owner, Date.now(), 60_000);
    assert.deepEqual(reopened.job(second.id).selectedHarness, {
      source: method('h1').source,
      artifact: method('h1').artifact,
    });
    assert.deepEqual(reopened.methodReport(baseline, 'development'), report);
  } finally {
    reopened?.close();
    store.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('selection compares exact equal-denominator decimal sums and seals validation membership', async () => {
  const { root, registration, store } = await fixture();
  try {
    const baseline = studyMethodIdentity(registration.baseline),
      changed = admit(store, 'g1').methodIdentity!;
    complete(store, reserve(store, baseline, 0), 0.1);
    complete(store, reserve(store, baseline, 1), 0.2);
    complete(store, reserve(store, changed, 0), 0.3);
    assert.throws(() => store.beginValidation(owner), /denominator is incomplete/);
    complete(store, reserve(store, changed, 1), 0);
    const state = store.beginValidation(owner);
    assert.equal(
      state.selectedMethod,
      baseline,
      '0.1 + 0.2 must not exceed or fall below an exactly equal 0.3',
    );
    assert.throws(() => reserve(store, changed, 0, 'validation'), /outside the frozen protocol/);
    assert.equal(reserve(store, baseline, 0, 'development').phase, 'complete');
    assert.throws(
      () => reserve(store, studyMethodIdentity(method('unregistered')), 0),
      /stage is not admitting jobs/,
    );
  } finally {
    store.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('strictly better development method is frozen before a complete independent validation', async () => {
  const { root, registration, store } = await fixture();
  try {
    const baseline = studyMethodIdentity(registration.baseline),
      changed = admit(store, 'g1').methodIdentity!;
    for (const repetition of [0, 1]) {
      complete(store, reserve(store, baseline, repetition), 0.4);
      complete(store, reserve(store, changed, repetition), 0.7);
    }
    assert.equal(store.beginValidation(owner).selectedMethod, changed);
    assert.throws(() => admit(store, 'g2'), /not accepting methods/);
    assert.throws(() => store.finish(owner, 'Not complete'), /denominator is incomplete/);
    for (const repetition of [0, 1]) {
      complete(store, reserve(store, baseline, repetition, 'validation'), 0.5);
      complete(store, reserve(store, changed, repetition, 'validation'), 0.3);
    }
    assert.equal(store.methodReport(changed, 'validation').mean, 0.3);
    assert.equal(
      store.state().selectedMethod,
      changed,
      'sealed results cannot select a different development winner',
    );
    assert.equal(
      store.finish(owner, 'Independent validation did not reproduce the development gain').phase,
      'complete',
    );
    assert.equal(store.jobs().length, 8);
  } finally {
    store.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('assessment completion rejects partial denominators and records fixed H identity once', async () => {
  const { root, registration, store } = await fixture();
  try {
    const job = reserve(store, studyMethodIdentity(registration.baseline), 0);
    store.startJob(owner, job.id, hash('child'));
    const harness = { source: method('h1').source, artifact: method('h1').artifact };
    store.startAssessment(owner, job.id, harness, hash('assessment'));
    assert.throws(
      () =>
        store.startAssessment(owner, job.id, { ...harness, source: method('h2').source }, hash('assessment')),
      /awaiting a frozen harness/,
    );
    const result = {
      score: 0.5,
      failures: 0,
      denominator: 1,
      constraintsSatisfied: true,
      reportDigest: hash('report'),
    };
    assert.throws(() => store.completeJob(owner, job.id, result), /denominator/);
    assert.equal(store.job(job.id).phase, 'assessing');
    result.denominator = 2;
    const completed = store.completeJob(owner, job.id, result);
    assert.deepEqual(store.completeJob(owner, job.id, result), completed);
    assert.throws(() => store.completeJob(owner, job.id, { ...result, score: 0.6 }), /awaiting assessment/);
  } finally {
    store.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('meta episode reservations are retained and do not mint time on resume or failure', async () => {
  const { root, store } = await fixture();
  try {
    const episode = store.reserveMetaEpisode(owner, 0, 90);
    assert.deepEqual(store.reserveMetaEpisode(owner, 0, 90), episode);
    assert.throws(() => store.reserveMetaEpisode(owner, 1, 1), /another episode/);
    store.startMetaEpisode(owner, 0);
    store.finishMetaEpisode(owner, 0, 'complete', 10, hash('receipt0'));
    assert.throws(() => store.reserveMetaEpisode(owner, 1, 81), /time allocation exhausted/);
    store.reserveMetaEpisode(owner, 1, 80);
    store.startMetaEpisode(owner, 1);
    store.finishMetaEpisode(owner, 1, 'failed', 1, hash('receipt1'));
    assert.throws(() => store.reserveMetaEpisode(owner, 2, 79), /another episode/);
    assert.equal(store.metaEpisodes().length, 2);
  } finally {
    store.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('unmeasurable meta failure records null duration and cannot reclaim its reservation', async () => {
  const { root, store } = await fixture();
  try {
    store.reserveMetaEpisode(owner, 0, 90);
    store.startMetaEpisode(owner, 0);
    assert.throws(
      () => store.finishMetaEpisode(owner, 0, 'complete', null, hash('invalid')),
      /Invalid measured/,
    );
    const failed = store.finishMetaEpisode(owner, 0, 'failed', null, hash('failed-before-timestamps'));
    assert.equal(failed.actualSeconds, null);
    assert.equal(failed.seconds, 90);
    assert.throws(() => store.reserveMetaEpisode(owner, 1, 90), /another episode/);
  } finally {
    store.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('parent cancellation persists before cleanup and cannot resume descendants', async () => {
  const { root, file, registration, store } = await fixture();
  let reopened: OptimizerStudyStore | undefined;
  try {
    const baseline = studyMethodIdentity(registration.baseline);
    const running = reserve(store, baseline, 0),
      waiting = reserve(store, baseline, 1);
    store.startJob(owner, running.id, hash('child'));
    const pending = store.reserveMethod(owner, {
      source: method('g1').source,
      composition: 'plugins.yml',
      proposal: proposal(registration.baseline.source.digest, 'g1'),
    });
    store.reserveMetaEpisode(owner, 0, 90);
    store.startMetaEpisode(owner, 0);
    store.cancel(owner, 'User cancelled the parent study');
    assert.equal(store.job(running.id).phase, 'cancelling');
    assert.equal(store.job(waiting.id).phase, 'cancelling');
    assert.throws(() => store.startJob(owner, running.id, hash('child')), /cannot start/);
    assert.throws(() => store.startMetaEpisode(owner, 0), /not reserved/);
    assert.throws(() => store.publishMethod(owner, pending.id, method('g1')), /awaiting preparation/);
    assert.throws(() => store.finishCancellation(owner, hash('cleanup-aggregate')), /unreclaimed/);
    store.release(owner);
    reopened = new OptimizerStudyStore(file, registration);
    reopened.acquire(owner, Date.now(), 60_000);
    assert.equal(reopened.state().phase, 'cancelling');
    reopened.cancelJob(owner, running.id, hash('running-cleanup'));
    reopened.cancelJob(owner, waiting.id, hash('reserved-cleanup'));
    reopened.cancelMethod(owner, pending.id, hash('method-cleanup'));
    assert.throws(() => reopened!.finishCancellation(owner, hash('cleanup-aggregate')), /unreclaimed/);
    reopened.cancelMetaEpisode(owner, 0, hash('meta-cleanup'));
    assert.throws(() => reopened!.finishCancellation(owner, hash('cleanup-aggregate')), /not registered/);
    reopened.recordCleanup(owner, { kind: 'study', id: 'all', digest: hash('cleanup-aggregate') });
    assert.equal(reopened.finishCancellation(owner, hash('cleanup-aggregate')).phase, 'cancelled');
    assert.equal(reopened.jobs().length, 2);
    assert.deepEqual(reopened.reservedAllocation(), store.reservedAllocation());
  } finally {
    reopened?.close();
    store.close();
    await rm(root, { recursive: true, force: true });
  }
});
