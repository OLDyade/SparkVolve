import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { digest } from '../src/artifacts.js';
import {
  FixedOptimizerComparison,
  OptimizerStudy,
  RegisteredOptimizerStudy,
  studyAllocationCeiling,
  studyMethodIdentity,
  studyArmIdentity,
  type FixedOptimizerComparisonSpec,
  type FrozenStudyMethodRef,
} from '../src/optimizer-study-contracts.js';
import { OptimizerStudyStore, type StudyJob } from '../src/optimizer-study-store.js';
import { OptimizerStudyCoordinator } from '../src/optimizer-study.js';
import { optimizerStudyReport } from '../src/optimizer-study-report.js';
import { specification } from './fixtures.js';

const owner = 'fixed-comparison-test';
function method(name: string): FrozenStudyMethodRef {
  return {
    source: { directory: `methods/${name}/source`, digest: digest(`${name}-source`) },
    artifact: {
      directory: `methods/${name}/artifact`,
      identity: {
        image: specification().runtime.image,
        artifactDigest: digest(`${name}-artifact`),
        bundleDigest: digest(`${name}-bundle`),
        tarballDigest: digest(`${name}-tarball`),
        lockDigest: digest(`${name}-lock`),
      },
    },
    composition: 'plugins.yml',
  };
}
function registration(): FixedOptimizerComparisonSpec {
  const search = specification();
  return FixedOptimizerComparison.parse({
    kind: 'fixed-comparison',
    name: 'fixed-methods',
    objective: 'Compare frozen native optimizer methods independently',
    baseline: 'reference',
    arms: ['reference', 'alternative', 'failed'].map((id) => ({
      id,
      method: method(id),
      hostSearchProtocol: search.hostSearchProtocol,
    })),
    cases: ['first', 'second'].map((id) => ({
      id,
      seed: { source: method('h0').source, artifact: method('h0').artifact },
      search: {
        specification: search,
        dataset: { directory: `${id}/search`, digest: digest(`${id}-search`) },
      },
      assessment: {
        specification: {
          ...search,
          purpose: 'validation',
          budget: { ...search.budget, candidates: 1 },
          probes: null,
        },
        dataset: { directory: `${id}/assessment`, digest: digest(`${id}-assessment`) },
      },
    })),
    repetitions: 2,
    budget: { concurrentSearches: 1 },
  });
}
async function fixture(spec = registration()) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'he-fixed-comparison-'));
  const file = path.join(root, 'study.sqlite');
  const store = new OptimizerStudyStore(file, spec);
  store.acquire(owner, Date.now(), 60_000);
  return {
    root,
    file,
    spec,
    store,
    cleanup: async () => {
      store.close();
      await rm(root, { recursive: true });
    },
  };
}
function feedbackRegistration(): FixedOptimizerComparisonSpec {
  const spec = registration();
  const frozen = method('shared-g');
  spec.arms = [
    { id: 'reference', method: frozen, hostSearchProtocol: { ancestry: 'seed-only', feedback: 'full' } },
    {
      id: 'mechanical',
      method: frozen,
      hostSearchProtocol: { ancestry: 'seed-only', feedback: 'mechanical' },
    },
  ];
  for (const item of spec.cases) {
    item.search.specification.probes = null;
    item.search.specification.researchLibrary = null;
    item.search.specification.candidate.qa = null;
  }
  return FixedOptimizerComparison.parse(spec);
}
function jobs(f: Awaited<ReturnType<typeof fixture>>) {
  return f.spec.arms.flatMap((arm) =>
    f.spec.cases.flatMap((item) =>
      Array.from({ length: f.spec.repetitions }, (_, repetition) =>
        f.store.reserveJob(owner, {
          stage: 'validation',
          method: studyMethodIdentity(arm.method),
          comparisonArm: studyArmIdentity(arm),
          caseId: item.id,
          repetition,
        }),
      ),
    ),
  );
}
function complete(f: Awaited<ReturnType<typeof fixture>>, job: StudyJob, score: number) {
  const item = f.spec.cases.find((item) => item.id === job.caseId)!;
  f.store.startJob(owner, job.id, digest(`search-${job.id}`));
  f.store.startAssessment(owner, job.id, item.seed, digest(`assessment-${job.id}`));
  f.store.completeJob(owner, job.id, {
    score,
    failures: 0,
    constraintsSatisfied: true,
    denominator: item.assessment.specification.tasks.length * item.assessment.specification.repetitions,
    reportDigest: digest(`report-${job.id}`),
  });
}

test('fixed comparison strictly freezes unique methods, baseline, sealed data roles and exact allocation', () => {
  const spec = registration();
  assert.deepEqual(RegisteredOptimizerStudy.parse(spec), spec);
  assert.equal(studyAllocationCeiling(spec).assessmentTasks, 24);
  assert.throws(
    () => FixedOptimizerComparison.parse({ ...spec, metaOptimizer: method('meta') }),
    /Unrecognized/,
  );
  assert.throws(() => FixedOptimizerComparison.parse({ ...spec, baseline: 'absent' }), /baseline/);
  assert.throws(
    () => FixedOptimizerComparison.parse({ ...spec, arms: [spec.arms[0], spec.arms[0]] }),
    /unique/,
  );
  assert.throws(
    () => FixedOptimizerComparison.parse({ ...spec, arms: [spec.arms[0], { ...spec.arms[0], id: 'clone' }] }),
    /use repetitions/,
  );
  for (const source of ['first', 'first/search', 'first/assessment/nested']) {
    const changed = structuredClone(spec);
    changed.arms[0]!.method.source.directory = source;
    assert.throws(() => FixedOptimizerComparison.parse(changed), /Public comparison bundles/);
  }
  const crossed = structuredClone(spec);
  crossed.cases[1]!.search.dataset.directory = 'first/assessment/subdir';
  assert.throws(() => FixedOptimizerComparison.parse(crossed), /across every case/);
  const metric = structuredClone(spec);
  metric.cases[1]!.assessment.specification.metric.failure = 0.2;
  assert.throws(() => FixedOptimizerComparison.parse(metric), /same metric/);
});

test('development registrations retain their original identity and do not become fixed comparisons', () => {
  const fixed = registration(),
    child = specification();
  const raw = {
    name: 'development-study',
    objective: 'Evolve the optimizer',
    baseline: method('baseline'),
    metaOptimizer: method('meta'),
    metaRuntime: { runtime: child.runtime, model: child.optimizer, isolation: child.isolation, egress: [] },
    methodBuild: child.candidate.build,
    methodQA: null,
    developmentCases: [fixed.cases[0]],
    validationCases: [fixed.cases[1]],
    repetitions: 2,
    budget: { methodCandidates: 3, metaOptimizerSeconds: 60, concurrentSearches: 1 },
    selection: { failureLimit: 1 },
  };
  const original = OptimizerStudy.parse(raw);
  assert.deepEqual(RegisteredOptimizerStudy.parse(raw), original);
  assert.equal(digest(RegisteredOptimizerStudy.parse(raw)), digest(original));
  assert.throws(() => RegisteredOptimizerStudy.parse({ ...raw, kind: 'fixed-comparison' }));
});

test('same frozen G admits different host protocols and rejects duplicate arms, inconsistent G builds and invalid child policies before execution', () => {
  const spec = feedbackRegistration();
  assert.equal(studyMethodIdentity(spec.arms[0]!.method), studyMethodIdentity(spec.arms[1]!.method));
  assert.notEqual(studyArmIdentity(spec.arms[0]!), studyArmIdentity(spec.arms[1]!));
  const renamed = { ...spec.arms[0]!, id: 'renamed' };
  assert.equal(studyArmIdentity(renamed), studyArmIdentity(spec.arms[0]!));
  assert.throws(
    () => FixedOptimizerComparison.parse({ ...spec, arms: [spec.arms[0], renamed] }),
    /use repetitions/,
  );
  const changed = structuredClone(spec);
  changed.arms[1]!.method.artifact.identity.bundleDigest = digest('different build');
  assert.throws(() => FixedOptimizerComparison.parse(changed), /different frozen builds/);
  const invalid = structuredClone(spec);
  invalid.cases[0]!.search.specification.probes = { limit: 1, timeoutSeconds: 10 };
  assert.throws(
    () => FixedOptimizerComparison.parse(invalid),
    /Arm reference case first search protocol is invalid/,
  );
  const missing = structuredClone(spec) as unknown as { arms: Array<Record<string, unknown>> };
  delete missing.arms[0]!.hostSearchProtocol;
  assert.throws(() => FixedOptimizerComparison.parse(missing), /hostSearchProtocol/);
});

test('same G arms own separate immutable jobs, reports and paired failure denominators without duplicating a method candidate', async () => {
  const f = await fixture(feedbackRegistration());
  try {
    assert.equal(f.store.methods().length, 1);
    assert.equal(f.store.validationMethods().length, 1);
    assert.equal(f.store.validationTargets().length, 2);
    const reserved = jobs(f);
    assert.equal(reserved.length, 8);
    assert.equal(new Set(reserved.map((job) => job.method)).size, 1);
    assert.equal(new Set(reserved.map((job) => job.id)).size, 8);
    assert.equal(new Set(reserved.map((job) => job.childRoot)).size, 8);
    assert.equal(new Set(reserved.map((job) => job.assessmentRoot)).size, 8);
    assert.throws(() => f.store.methodReport(reserved[0]!.method, 'validation'), /arm identity/);
    assert.throws(
      () => f.store.reserveJob(owner, { ...reserved[0]!, comparisonArm: null }),
      /comparison arm/,
    );
    assert.throws(
      () => f.store.reserveJob(owner, { ...reserved[0]!, method: digest('foreign G') }),
      /comparison arm/,
    );
    for (const job of reserved) {
      if (job.comparisonArm === studyArmIdentity(f.spec.arms[0]!)) complete(f, job, 0.7);
      else if (job.repetition === 0) complete(f, job, 0.4);
      else f.store.failJob(owner, job.id, 'Original independent blind-arm failure');
    }
    f.store.finish(owner, 'Both feedback protocols completed');
    const report = new OptimizerStudyCoordinator(f.root, f.store).reportSnapshot();
    assert.equal(report.methods.length, 1);
    assert.equal(report.validation.length, 2);
    const arms = report.comparison!.arms;
    assert.deepEqual(
      arms.map((arm) => [arm.id, arm.mean, arm.denominator, arm.failures]),
      [
        ['reference', 0.7, 4, 0],
        ['mechanical', 0.2, 4, 2],
      ],
    );
    assert.ok(Math.abs(arms[1]!.pairedMeanDelta! + 0.5) < 1e-12);
    assert.equal(arms[0]!.method, arms[1]!.method);
    assert.notEqual(arms[0]!.armDigest, arms[1]!.armDigest);
    assert.equal(arms[1]!.hostSearchProtocol.feedback, 'mechanical');
    assert.deepEqual(
      jobs(f),
      reserved.map((job) => f.store.job(job.id)),
    );
    const reopened = new OptimizerStudyStore(f.file, f.spec, 'read');
    try {
      assert.deepEqual(new OptimizerStudyCoordinator(f.root, reopened).reportSnapshot(), report);
    } finally {
      reopened.close();
    }
    const modified = structuredClone(f.spec);
    modified.arms[1]!.hostSearchProtocol = { ancestry: 'unrestricted', feedback: 'full' };
    assert.throws(() => new OptimizerStudyStore(f.file, modified), /registration changed/);
  } finally {
    await f.cleanup();
  }
});

test('all frozen arms survive losing and failed outcomes; paired instances and full denominator survive readonly recovery', async () => {
  const f = await fixture();
  try {
    assert.equal(f.store.state().phase, 'validating');
    assert.equal(f.store.methods().length, 3);
    assert.throws(() => f.store.beginValidation(owner), /does not admit/);
    assert.throws(() => f.store.reserveMetaEpisode(owner, 0, 10), /does not admit/);
    const expected = jobs(f);
    assert.equal(expected.length, 12);
    assert.deepEqual(f.store.reservedAllocation(), studyAllocationCeiling(f.spec));
    assert.equal(f.store.armReport(expected[0]!.comparisonArm!).samples[0]!.score, null);
    assert.throws(() => f.store.finish(owner, 'Too early'), /denominator is incomplete/);
    for (const job of expected) {
      if (job.method === studyMethodIdentity(f.spec.arms[2]!.method))
        f.store.failJob(owner, job.id, 'Native search failed');
      else complete(f, job, job.method === studyMethodIdentity(f.spec.arms[0]!.method) ? 0.8 : 0.3);
    }
    f.store.finish(owner, 'All registered methods evaluated, no winner selected');
    const report = new OptimizerStudyCoordinator(f.root, f.store).reportSnapshot();
    assert.equal(report.state.selectedMethod, undefined);
    assert.equal(report.validation.length, 3);
    assert.deepEqual(report.development, []);
    const arms = report.comparison!.arms;
    assert.deepEqual(
      arms.map((arm) => [arm.id, arm.denominator, arm.failures, arm.pending, arm.mean]),
      [
        ['reference', 4, 0, 0, 0.8],
        ['alternative', 4, 0, 0, 0.3],
        ['failed', 4, 4, 0, 0],
      ],
    );
    assert.equal(arms[1]!.pairedMeanDelta, -0.5);
    assert.equal(arms[2]!.pairedMeanDelta, -0.8);
    assert.deepEqual(
      arms[1]!.pairs.map((pair) => [pair.caseId, pair.repetition]),
      [
        ['first', 0],
        ['first', 1],
        ['second', 0],
        ['second', 1],
      ],
    );
    assert.equal(jobs(f).length, 12);
    assert.equal(f.store.jobs().length, 12);
    const cursor = f.store.cursor(),
      reopened = new OptimizerStudyStore(f.file, f.spec, 'read');
    try {
      assert.deepEqual(new OptimizerStudyCoordinator(f.root, reopened).reportSnapshot(), report);
      assert.deepEqual(reopened.cursor(), cursor);
    } finally {
      reopened.close();
    }
    const altered = structuredClone(f.spec);
    altered.arms.reverse();
    assert.throws(() => new OptimizerStudyStore(f.file, altered), /registration changed/);
  } finally {
    await f.cleanup();
  }
});

test('pending comparison pairs remain unknown; cancellation preserves all registered slots even before admission', async () => {
  const f = await fixture();
  try {
    const report = f.store.comparisonReport()!;
    assert.ok(
      report.arms.every((arm) => arm.mean === null && arm.pairedMeanDelta === null && arm.pending === 4),
    );
    assert.ok(
      report.arms.every((arm) =>
        arm.pairs.every((pair) => pair.scoreDelta === null && pair.arm.score === null),
      ),
    );
    f.store.cancel(owner, 'User stopped the registered comparison');
    assert.ok(f.store.comparisonReport()!.arms.every((arm) => arm.mean === null));
    const cleanup = digest('No descendants created');
    f.store.recordCleanup(owner, { kind: 'study', id: 'all', digest: cleanup });
    f.store.finishCancellation(owner, cleanup);
    const cancelled = f.store.comparisonReport()!;
    assert.equal(cancelled.arms.length, 3);
    assert.ok(
      cancelled.arms.every(
        (arm) => arm.denominator === 4 && arm.failures === 4 && arm.pending === 0 && arm.mean === 0,
      ),
    );
    assert.ok(
      cancelled.arms.every((arm) =>
        arm.samples.every((sample) => sample.phase === 'cancelled' && sample.job === null),
      ),
    );
    assert.throws(() => jobs(f), /not admitting/);
  } finally {
    await f.cleanup();
  }
});

test('fixed comparison cost ledger declares absent meta optimizer inapplicable without hiding unstarted searches', async () => {
  const f = await fixture();
  try {
    const report = await optimizerStudyReport(f.root, f.store);
    assert.deepEqual(report.accounting.meta, []);
    assert.equal(report.accounting.metaElapsed.applicable, false);
    assert.equal(report.accounting.metaElapsed.reportedSeconds, 0);
    assert.equal(report.accounting.metaUsage.status, 'not-applicable');
    assert.equal(report.accounting.metaUsage.unavailableSources, 0);
    assert.equal(report.accounting.metaUsage.complete, true);
    assert.equal(report.accounting.unreservedSearchInstances, 12);
    assert.equal(report.accounting.searchUsage.unavailableSources, 12);
    assert.equal(report.accounting.assessmentUsage.unavailableSources, 12);
    assert.equal(report.accounting.totalUsage.unavailableSources, 24);
    assert.equal(report.accounting.totalUsage.complete, false);
    assert.equal(report.accounting.totalUsage.reportedTotals, null);
    assert.equal(report.accounting.monetaryCost, null);
  } finally {
    await f.cleanup();
  }
});

test('cancelling a partially executed comparison retains successful, failed and unstarted arm instances exactly once', async () => {
  const f = await fixture();
  try {
    const expected = jobs(f);
    complete(f, expected[0]!, 0.8);
    f.store.failJob(owner, expected[1]!.id, 'Original method failure');
    const reference = f.store.comparisonReport()!.arms[0]!;
    assert.equal(reference.mean, null);
    assert.equal(reference.pending, 2);
    assert.equal(reference.failures, 1);
    f.store.cancel(owner, 'Stop after partial work');
    for (const job of f.store.jobs())
      if (job.phase === 'cancelling') f.store.cancelJob(owner, job.id, digest(`cleanup-${job.id}`));
    const cleanup = digest('All registered jobs reclaimed');
    f.store.recordCleanup(owner, { kind: 'study', id: 'all', digest: cleanup });
    f.store.finishCancellation(owner, cleanup);
    const result = f.store.comparisonReport()!;
    assert.equal(result.arms[0]!.mean, 0.2);
    assert.equal(result.arms[0]!.failures, 3);
    assert.equal(result.arms[1]!.pairedMeanDelta, -0.2);
    assert.equal(result.arms[2]!.pairedMeanDelta, -0.2);
    assert.equal(f.store.jobs().length, 12);
    assert.equal(f.store.job(expected[0]!.id).phase, 'complete');
    assert.equal(f.store.job(expected[1]!.id).phase, 'failed');
    assert.equal(f.store.metaEpisodes().length, 0);
    assert.throws(() => f.store.startJob(owner, expected[2]!.id, digest('new attempt')), /cannot start/);
  } finally {
    await f.cleanup();
  }
});
