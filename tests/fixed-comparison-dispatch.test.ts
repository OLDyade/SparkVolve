import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { digest } from '../src/artifacts.js';
import {
  FixedOptimizerComparison,
  studyArmIdentity,
  studyMethodIdentity,
  type FixedOptimizerComparisonSpec,
} from '../src/optimizer-study-contracts.js';
import { OptimizerStudyStore, type StudyJob } from '../src/optimizer-study-store.js';
import { OptimizerStudyCoordinator, type StudyTransport } from '../src/optimizer-study.js';
import { runFixedOptimizerComparison } from '../src/optimizer-study-runner.js';
import { specification } from './fixtures.js';
import type { ExperimentEvent } from '../src/events.js';

function events(store: OptimizerStudyStore): ExperimentEvent[] {
  const output: ExperimentEvent[] = [];
  let cursor = { ...store.cursor(), sequence: 0 };
  for (;;) {
    const page = store.page(cursor, 100);
    output.push(...page.events);
    if (!page.hasMore) return output;
    cursor = page.cursor;
  }
}

const transport = { host: '127.0.0.1', port: 0, endpoint: 'http://192.0.2.1:0' };
function registration(concurrentSearches: number): FixedOptimizerComparisonSpec {
  const search = specification();
  const method = {
    source: { directory: 'method/source', digest: digest('source') },
    artifact: {
      directory: 'method/artifact',
      identity: {
        image: search.runtime.image,
        artifactDigest: digest('artifact'),
        bundleDigest: digest('bundle'),
        tarballDigest: digest('tarball'),
        lockDigest: digest('lock'),
      },
    },
    composition: 'plugins.yml',
  };
  return FixedOptimizerComparison.parse({
    kind: 'fixed-comparison',
    name: 'paired-dispatch',
    objective: 'Verify host scheduling, not model quality',
    baseline: 'full',
    arms: ['full', 'mechanical'].map((feedback) => ({
      id: feedback,
      method,
      hostSearchProtocol: { ancestry: 'seed-only', feedback },
    })),
    cases: ['first', 'second'].map((id) => ({
      id,
      seed: { source: method.source, artifact: method.artifact },
      search: {
        specification: search,
        dataset: { directory: `${id}/search`, digest: digest(`${id}/search`) },
      },
      assessment: {
        specification: { ...search, purpose: 'validation', budget: { ...search.budget, candidates: 1 } },
        dataset: { directory: `${id}/assessment`, digest: digest(`${id}/assessment`) },
      },
    })),
    repetitions: 2,
    budget: { concurrentSearches },
  });
}

/** Exercise production coordinator dispatch and real SQLite transitions; only job execution is a fixture. */
class SchedulingFixture extends OptimizerStudyCoordinator {
  active = 0;
  peak = 0;
  starts: StudyJob[] = [];
  beforeComplete: (job: StudyJob) => Promise<void> = async () => {
    await new Promise((resolve) => setTimeout(resolve, 2));
  };
  override async start() {
    this.store.acquire(this.owner, Date.now(), 60_000);
  }
  override async report() {}
  protected override async runJob(job: StudyJob, _transport: StudyTransport, signal: AbortSignal) {
    assert.equal(this.store.jobs().length, 8, 'complete denominator reserved before the first job');
    assert.equal(events(this.store).filter((event) => event.type === 'study.dispatch_planned').length, 1);
    this.starts.push(job);
    this.store.startJob(this.owner, job.id, digest(['search', job.id]));
    this.peak = Math.max(this.peak, ++this.active);
    try {
      await this.beforeComplete(job);
      signal.throwIfAborted();
      const spec = this.spec as FixedOptimizerComparisonSpec;
      const item = spec.cases.find((item) => item.id === job.caseId)!;
      this.store.startAssessment(this.owner, job.id, item.seed, digest(['assessment', job.id]));
      this.store.completeJob(this.owner, job.id, {
        score: 0.5,
        failures: 0,
        denominator: 2,
        constraintsSatisfied: true,
        reportDigest: digest(['report', job.id]),
      });
    } finally {
      this.active--;
    }
  }
}
async function fixture(concurrency: number) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'he-paired-dispatch-'));
  const file = path.join(root, 'study.sqlite'),
    spec = registration(concurrency);
  const store = new OptimizerStudyStore(file, spec),
    coordinator = new SchedulingFixture(root, store);
  return {
    root,
    file,
    spec,
    store,
    coordinator,
    cleanup: async () => {
      store.close();
      await rm(root, { recursive: true, force: true });
    },
  };
}
function labels(spec: FixedOptimizerComparisonSpec, jobs: StudyJob[]) {
  return jobs.map(
    (job) =>
      `${job.caseId}/${job.repetition}/${spec.arms.find((arm) => studyArmIdentity(arm) === job.comparisonArm)!.id}`,
  );
}
function reserve(coordinator: SchedulingFixture) {
  const spec = coordinator.spec as FixedOptimizerComparisonSpec;
  for (const arm of spec.arms)
    for (const item of spec.cases)
      for (let repetition = 0; repetition < spec.repetitions; repetition++)
        coordinator.store.reserveJob(coordinator.owner, {
          stage: 'validation',
          comparisonArm: studyArmIdentity(arm),
          method: studyMethodIdentity(arm.method),
          caseId: item.id,
          repetition,
        });
}

test('fixed dispatch alternates AB/BA in paired blocks, reserves all slots, and terminal reentry performs no work', async () => {
  const f = await fixture(1);
  try {
    await runFixedOptimizerComparison(f.coordinator, { childTransport: transport });
    assert.deepEqual(labels(f.spec, f.coordinator.starts), [
      'first/0/full',
      'first/0/mechanical',
      'first/1/mechanical',
      'first/1/full',
      'second/0/full',
      'second/0/mechanical',
      'second/1/mechanical',
      'second/1/full',
    ]);
    assert.equal(f.coordinator.peak, 1);
    const recorded = events(f.store);
    assert.equal(recorded.filter((event) => event.type === 'job.searching').length, 8);
    assert.ok(
      recorded.findIndex((event) => event.type === 'study.dispatch_planned') <
        recorded.findIndex((event) => event.type === 'job.searching'),
    );
    const reopened = new OptimizerStudyStore(f.file, f.spec);
    try {
      const next = new SchedulingFixture(f.root, reopened);
      await runFixedOptimizerComparison(next, { childTransport: transport });
      assert.equal(next.starts.length, 0);
      assert.deepEqual(events(reopened), recorded);
    } finally {
      reopened.close();
    }
  } finally {
    await f.cleanup();
  }
});

test('paired block concurrency respects the registered ceiling and cannot cross an unfinished block', async () => {
  const f = await fixture(2),
    gate = Promise.withResolvers<void>(),
    started = Promise.withResolvers<void>();
  f.coordinator.beforeComplete = async (job) => {
    if (job.caseId === 'first' && job.repetition === 0) {
      if (f.coordinator.starts.length === 2) started.resolve();
      await gate.promise;
    }
  };
  const operation = runFixedOptimizerComparison(f.coordinator, { childTransport: transport });
  try {
    await started.promise;
    assert.equal(f.coordinator.starts.length, 2);
    assert.equal(f.coordinator.active, 2);
    assert.ok(
      f.store
        .jobs()
        .filter((job) => job.phase !== 'reserved')
        .every((job) => job.caseId === 'first' && job.repetition === 0),
    );
    gate.resolve();
    await operation;
    assert.equal(f.coordinator.peak, 2);
    assert.deepEqual(labels(f.spec, f.coordinator.starts).slice(0, 4), [
      'first/0/full',
      'first/0/mechanical',
      'first/1/mechanical',
      'first/1/full',
    ]);
  } finally {
    gate.resolve();
    await operation;
    await f.cleanup();
  }
});

test('recovery resumes an in-flight job before reserved work in its block and preserves the frozen plan', async () => {
  const f = await fixture(2);
  try {
    await f.coordinator.start();
    reserve(f.coordinator);
    const plan = f.store.freezeFixedDispatchPlan(f.coordinator.owner);
    const active = plan.blocks[0]!.jobs[1]!;
    f.store.startJob(f.coordinator.owner, active, digest(['search', active]));
    await f.coordinator.close();
    const reopened = new OptimizerStudyStore(f.file, f.spec);
    try {
      const next = new SchedulingFixture(f.root, reopened);
      await runFixedOptimizerComparison(next, { childTransport: transport });
      assert.equal(next.starts[0]!.id, active);
      assert.equal(next.starts[0]!.phase, 'searching');
      assert.equal(next.starts.length, 8);
      assert.equal(
        events(reopened).filter((event) => event.type === 'job.searching').length,
        8,
        'reattachment does not register another execution',
      );
      assert.deepEqual(events(reopened).find((event) => event.type === 'study.dispatch_planned')!.body, plan);
    } finally {
      reopened.close();
    }
  } finally {
    await f.cleanup();
  }
});

test('dispatch plans reject after-the-fact installation and persisted order changes', async () => {
  const f = await fixture(1);
  try {
    await f.coordinator.start();
    reserve(f.coordinator);
    const first = f.store.jobs()[0]!;
    f.store.startJob(f.coordinator.owner, first.id, digest('already started'));
    assert.throws(() => f.store.freezeFixedDispatchPlan(f.coordinator.owner), /after execution has started/);
  } finally {
    await f.coordinator.close();
    await f.cleanup();
  }
  const next = await fixture(1);
  try {
    await next.coordinator.start();
    reserve(next.coordinator);
    const plan = next.store.freezeFixedDispatchPlan(next.coordinator.owner);
    plan.blocks[0]!.jobs.reverse();
    next.store.db
      .prepare('UPDATE metadata SET value=? WHERE key=?')
      .run(JSON.stringify(plan), 'fixedDispatchPlan');
    assert.throws(() => next.store.freezeFixedDispatchPlan(next.coordinator.owner), /dispatch plan changed/);
  } finally {
    await next.coordinator.close();
    await next.cleanup();
  }
});
