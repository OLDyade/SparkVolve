import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { atomicJSON, digest, fileDigest } from '../src/artifacts.js';
import {
  OptimizerStudy,
  studyMethodIdentity,
  type FrozenStudyMethodRef,
} from '../src/optimizer-study-contracts.js';
import { OptimizerStudyStore, type StudyJob } from '../src/optimizer-study-store.js';
import { optimizerStudyReport } from '../src/optimizer-study-report.js';
import { Store } from '../src/store.js';
import type { ExperimentSpec } from '../src/contracts.js';
import { candidate, runs, specification } from './fixtures.js';

const owner = 'usage-fixture';
function method(name: string): FrozenStudyMethodRef {
  return {
    source: { directory: `${name}/source`, digest: digest(`${name}-source`) },
    composition: 'plugins.yml',
    artifact: {
      directory: `${name}/artifact`,
      identity: {
        image: specification().runtime.image,
        artifactDigest: digest(`${name}-artifact`),
        bundleDigest: digest(`${name}-bundle`),
        tarballDigest: digest(`${name}-tar`),
        lockDigest: digest(`${name}-lock`),
      },
    },
  };
}
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'he-study-usage-'));
  const search = specification(),
    assessment: ExperimentSpec = {
      ...specification(),
      purpose: 'validation',
      budget: { candidates: 1, optimizerSeconds: 60 },
    };
  const task = (id: string) => ({
    id,
    seed: { source: method('h0').source, artifact: method('h0').artifact },
    search: { specification: search, dataset: { directory: `${id}/search`, digest: digest(`${id}-search`) } },
    assessment: {
      specification: assessment,
      dataset: { directory: `${id}/assessment`, digest: digest(`${id}-assessment`) },
    },
  });
  const spec = OptimizerStudy.parse({
    name: 'usage-study',
    objective: 'Test observed cost accounting',
    baseline: method('g0'),
    metaOptimizer: method('meta'),
    metaRuntime: {
      runtime: search.runtime,
      model: search.optimizer,
      isolation: search.isolation,
      egress: [],
    },
    methodBuild: search.candidate.build,
    methodQA: null,
    developmentCases: [task('development')],
    validationCases: [task('sealed')],
    repetitions: 2,
    budget: { methodCandidates: 2, metaOptimizerSeconds: 90, concurrentSearches: 1 },
    selection: { failureLimit: 1 },
  });
  const file = path.join(root, 'study.sqlite'),
    store = new OptimizerStudyStore(file, spec);
  store.acquire(owner, Date.now(), 60000);
  const job = (repetition = 0) =>
    store.reserveJob(owner, {
      comparisonArm: null,
      stage: 'development',
      method: studyMethodIdentity(spec.baseline),
      caseId: 'development',
      repetition,
    });
  const report = async () => {
    const read = new OptimizerStudyStore(file, spec, 'read');
    try {
      return await optimizerStudyReport(root, read);
    } finally {
      read.close();
    }
  };
  return { root, store, search, assessment, job, report };
}
type RequestRecord = {
  id: string;
  kind: string;
  durationMs?: number;
  usage?: { inputTokens: number; outputTokens: number } | null;
};
async function ledger(root: string, trace: string, records: RequestRecord[]) {
  const directory = path.join(root, trace);
  await mkdir(directory, { recursive: true });
  await writeFile(
    path.join(directory, 'requests.jsonl'),
    records.map((record) => JSON.stringify(record)).join('\n') + '\n',
  );
}
const settled = (id: string, input: number, output: number, duration: number): RequestRecord[] => [
  { id, kind: 'started' },
  { id, kind: 'result', durationMs: duration, usage: { inputTokens: input, outputTokens: output } },
];
async function child(root: string, directory: string, spec: ExperimentSpec, taskLedgers = 2) {
  const home = path.join(root, directory);
  await mkdir(home, { recursive: true });
  await atomicJSON(path.join(home, 'experiment.json'), spec);
  const store = new Store(path.join(home, 'experiment.sqlite'), spec);
  const c = { ...candidate(), phase: 'running' as const };
  store.addCandidate(c);
  const records = runs()
    .slice(0, taskLedgers)
    .map((run) => ({
      ...run,
      phase: 'scored' as const,
      grade: { score: 0.5, metrics: {}, feedback: 'host fixture' },
    }));
  store.addRuns(records);
  if (taskLedgers === 2) store.decide(c.digest);
  store.close();
  return records;
}
function finish(f: Awaited<ReturnType<typeof fixture>>, job: StudyJob) {
  f.store.completeJob(owner, job.id, {
    score: 0.5,
    failures: 0,
    denominator: 2,
    constraintsSatisfied: true,
    reportDigest: digest(job.id),
  });
}

test('study aggregates each meta, child search and independent assessment ledger exactly once with read-only replay', async () => {
  const f = await fixture();
  try {
    const job = f.job();
    f.store.startJob(owner, job.id, digest(f.search));
    const search = await child(f.root, job.childRoot, f.search);
    for (const run of search)
      await ledger(f.root, `${job.childRoot}/runs/${run.id}/trace`, settled(run.id, 10, 2, 100));
    await ledger(f.root, `${job.childRoot}/optimizer/0/trace`, settled('search-opt', 30, 4, 200));
    f.store.startAssessment(
      owner,
      job.id,
      { source: method('h0').source, artifact: method('h0').artifact },
      digest(f.assessment),
    );
    const assessment = await child(f.root, job.assessmentRoot, f.assessment);
    for (const run of assessment)
      await ledger(f.root, `${job.assessmentRoot}/runs/${run.id}/trace`, settled(run.id, 20, 3, 150));
    finish(f, job);
    f.store.reserveMetaEpisode(owner, 0, 90);
    f.store.startMetaEpisode(owner, 0);
    f.store.finishMetaEpisode(owner, 0, 'complete', 1.5, digest('meta receipt'));
    await ledger(f.root, 'meta-optimizer/0/trace', settled('meta', 100, 10, 500));
    const cursor = f.store.cursor(),
      changes = f.store.db.prepare('SELECT total_changes() AS n').get()!.n;
    const before = await fileDigest(path.join(f.root, job.childRoot, 'optimizer/0/trace/requests.jsonl'));
    const report = await f.report();
    assert.equal(report.accounting.metaUsage.reportedTotals!.inputTokensReported, 100);
    assert.equal(report.accounting.searchUsage.reportedTotals!.inputTokensReported, 50);
    assert.equal(report.accounting.assessmentUsage.reportedTotals!.inputTokensReported, 40);
    assert.equal(report.accounting.totalUsage.reportedTotals!.inputTokensReported, 190);
    assert.equal(report.accounting.totalUsage.reportedTotals!.outputTokensReported, 24);
    assert.equal(report.accounting.totalUsage.reportedTotals!.started, 6);
    assert.equal(report.accounting.totalUsage.reportedTotals!.requestDurationMsSum, 1200);
    assert.equal(report.accounting.totalUsage.complete, true);
    assert.deepEqual(report.accounting.metaElapsed, {
      applicable: true,
      reportedSeconds: 1.5,
      measuredEpisodes: 1,
      unmeasuredEpisodes: 0,
    });
    assert.equal(report.accounting.jobs[0]!.searchAccounting.availability, 'available');
    assert.equal(report.accounting.monetaryCost, null);
    assert.deepEqual(await f.report(), report);
    assert.deepEqual(f.store.cursor(), cursor);
    assert.equal(f.store.db.prepare('SELECT total_changes() AS n').get()!.n, changes);
    assert.equal(
      await fileDigest(path.join(f.root, job.childRoot, 'optimizer/0/trace/requests.jsonl')),
      before,
    );
    assert.ok(
      !(await readdir(f.root)).includes('study-report.json'),
      'Read-only report does not publish or run anything',
    );
  } finally {
    f.store.close();
  }
});

test('registered missing and unstarted children remain unavailable, never complete zero-cost work', async () => {
  const f = await fixture();
  try {
    const first = f.job();
    f.store.startJob(owner, first.id, digest(f.search));
    f.store.failJob(owner, first.id, 'failed before initialization');
    f.job(1);
    f.store.reserveMetaEpisode(owner, 0, 90);
    f.store.startMetaEpisode(owner, 0);
    f.store.finishMetaEpisode(owner, 0, 'failed', null, digest('failure'));
    const report = await f.report();
    assert.equal(report.accounting.jobs[0]!.searchAccounting.availability, 'experiment-missing');
    assert.equal(report.accounting.jobs[0]!.phase, 'failed');
    assert.equal(report.accounting.jobs[0]!.error, 'failed before initialization');
    assert.equal(report.accounting.jobs[1]!.searchAccounting.availability, 'not-registered');
    assert.equal(report.accounting.totalUsage.reportedTotals, null);
    assert.equal(report.accounting.totalUsage.complete, false);
    assert.equal(report.accounting.meta[0]!.actualSeconds, null);
    assert.equal(report.accounting.metaElapsed.reportedSeconds, null);
    await assert.rejects(readFile(path.join(f.root, first.childRoot, 'experiment.sqlite')), {
      code: 'ENOENT',
    });
  } finally {
    f.store.close();
  }
});

test('unfinished, failed-without-token-usage, absent runs and absent optimizer episodes stay explicit', async () => {
  const f = await fixture();
  try {
    const job = f.job();
    f.store.startJob(owner, job.id, digest(f.search));
    const partial = await child(f.root, job.childRoot, f.search, 1);
    await ledger(f.root, `${job.childRoot}/runs/${partial[0]!.id}/trace`, [
      { id: 'failed', kind: 'started' },
      { id: 'failed', kind: 'failed', durationMs: 70, usage: null },
      { id: 'unfinished', kind: 'started' },
      { id: 'unfinished', kind: 'closed_incomplete' },
    ]);
    const report = await f.report(),
      accounting = report.accounting.jobs[0]!.searchAccounting;
    assert.equal(accounting.reportedTotals!.failed, 1);
    assert.equal(accounting.reportedTotals!.unfinished, 1);
    assert.equal(accounting.reportedTotals!.inputTokensReported, null);
    assert.equal(accounting.reportedTotals!.outputTokensReported, null);
    assert.equal(accounting.unobservedTaskRuns, 1);
    assert.equal(accounting.unavailableSources, 1);
    assert.equal(accounting.activeSources, 1);
    assert.equal(accounting.complete, false);
    assert.equal(report.accounting.totalUsage.complete, false);
  } finally {
    f.store.close();
  }
});

test('empty initialized experiments and empty request files do not certify complete accounting', async () => {
  const f = await fixture();
  try {
    const job = f.job();
    f.store.startJob(owner, job.id, digest(f.search));
    const home = path.join(f.root, job.childRoot);
    await mkdir(home, { recursive: true });
    await atomicJSON(path.join(home, 'experiment.json'), f.search);
    const childStore = new Store(path.join(home, 'experiment.sqlite'), f.search);
    childStore.close();
    await ledger(f.root, `${job.childRoot}/optimizer/0/trace`, []);
    const report = await f.report();
    assert.equal(report.accounting.searchUsage.emptyLedgers, 1);
    assert.equal(report.accounting.searchUsage.reportedTotals!.inputTokensReported, null);
    assert.equal(report.accounting.searchUsage.complete, false);
  } finally {
    f.store.close();
  }
});

test('changed child contract and malformed ledgers fail loudly without overwriting retained evidence', async () => {
  const f = await fixture();
  try {
    const job = f.job();
    f.store.startJob(owner, job.id, digest(f.search));
    await child(f.root, job.childRoot, f.search);
    const file = path.join(f.root, job.childRoot, 'experiment.json');
    await atomicJSON(file, { ...f.search, objective: 'changed' });
    await assert.rejects(f.report(), /child specification changed/);
    await atomicJSON(file, f.search);
    await ledger(f.root, `${job.childRoot}/optimizer/0/trace`, [
      { id: 'duplicate', kind: 'started' },
      { id: 'duplicate', kind: 'started' },
    ]);
    const log = path.join(f.root, job.childRoot, 'optimizer/0/trace/requests.jsonl'),
      before = await readFile(log, 'utf8');
    await assert.rejects(f.report(), /Duplicate request start/);
    assert.equal(await readFile(log, 'utf8'), before);
  } finally {
    f.store.close();
  }
});
