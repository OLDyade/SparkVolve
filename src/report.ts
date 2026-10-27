import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import type { Store } from './store.js';
import { digest } from './artifacts.js';
import { requestMetrics } from './metrics.js';

type Usage = Awaited<ReturnType<typeof requestMetrics>>;
const counters = [
  'started',
  'results',
  'failed',
  'unfinished',
  'inputTokensReported',
  'outputTokensReported',
  'missingUsage',
  'requestDurationMsSum',
] as const;

async function usageAt(trace: string): Promise<Usage | null> {
  try {
    return await requestMetrics(path.join(trace, 'requests.jsonl'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    return null;
  }
}

function sumUsage(rows: Array<Usage | null>) {
  const reported = rows.filter((row): row is Usage => row !== null);
  return {
    ledgers: rows.length,
    availableLedgers: reported.length,
    unavailableLedgers: rows.length - reported.length,
    reportedTotals: reported.length
      ? Object.fromEntries(counters.map((key) => [key, reported.reduce((sum, row) => sum + row[key], 0)]))
      : null,
    complete:
      reported.length === rows.length &&
      reported.every((row) => row.missingUsage === 0 && row.unfinished === 0),
  };
}

/** Read-only projection. Model-authored conclusions remain attributed statements, never inferred facts. */
export async function experimentReport(root: string, store: Store) {
  const candidates = store.candidates(),
    runs = store.runs(),
    events = store.events();
  const expected = new Set(
    store.spec.tasks.flatMap((task) =>
      Array.from({ length: store.spec.repetitions }, (_, repetition) => `${task.id}/${repetition}`),
    ),
  );
  const samples = await Promise.all(
    runs.map(async (run) => ({
      id: run.id,
      candidate: run.candidate,
      task: run.task,
      repetition: run.repetition,
      attempt: run.attempt,
      gradeAttempt: run.gradeAttempt,
      phase: run.phase,
      score:
        run.phase === 'scored'
          ? run.grade!.score
          : ['execution_failed', 'cancelled'].includes(run.phase)
            ? store.spec.metric.failure
            : null,
      auxiliary: run.grade?.metrics ?? null,
      error: run.error ?? null,
      deliveryDigest: run.deliveryDigest ?? null,
      startedAt: run.startedAt ?? null,
      completedAt: run.completedAt ?? null,
      executionElapsedMs:
        run.startedAt && run.completedAt ? Date.parse(run.completedAt) - Date.parse(run.startedAt) : null,
      usage: await usageAt(path.join(root, 'runs', run.id, 'trace')),
    })),
  );
  let episodes: string[];
  try {
    episodes = (await readdir(path.join(root, 'optimizer')))
      .filter((name) => /^\d+$/.test(name))
      .sort((a, b) => Number(a) - Number(b));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    episodes = [];
  }
  const optimizer = await Promise.all(
    episodes.map(async (episode) => ({
      episode: Number(episode),
      usage: await usageAt(path.join(root, 'optimizer', episode, 'trace')),
    })),
  );
  let optimizerAccounting: unknown = null;
  try {
    optimizerAccounting = JSON.parse(await readFile(path.join(root, 'optimizer/summary.json'), 'utf8'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  return {
    experimentId: store.getMeta('experimentId'),
    specificationDigest: digest(store.spec),
    purpose: store.spec.purpose,
    metric: store.spec.metric,
    taskOrder: store.spec.tasks.map((task) => task.id),
    repetitions: store.spec.repetitions,
    candidateBudget: store.spec.budget.candidates,
    candidatesConsumed: candidates.length,
    probes: {
      budget: store.spec.probes,
      consumed: store.probes().length,
      records: store.probes(),
      boundary:
        'Optimizer-authored behavioral experiments, not task scores or independent validation. Build and execution logs are retained under probes/<id>. No model credentials or network are supplied to probe execution.',
    },
    currentChampion: store.getMeta('champion') ?? null,
    candidates: candidates.map((candidate) => {
      const selected = samples.filter((run) => run.candidate === candidate.digest);
      const identities = selected.map((run) => `${run.task}/${run.repetition}`);
      const complete =
        selected.length === expected.size &&
        new Set(identities).size === expected.size &&
        identities.every((id) => expected.has(id)) &&
        selected.every((run) => run.score !== null);
      return {
        digest: candidate.digest,
        ordinal: candidate.ordinal,
        phase: candidate.phase,
        build: candidate.build ?? null,
        buildError: candidate.buildError ?? null,
        qaError: candidate.qaError ?? null,
        expectedRuns: expected.size,
        observedRuns: selected.length,
        scoredRuns: selected.filter((run) => run.phase === 'scored').length,
        failedRuns: selected.filter((run) => ['execution_failed', 'cancelled'].includes(run.phase)).length,
        complete,
        mean: complete ? selected.reduce((sum, run) => sum + run.score!, 0) / expected.size : null,
        decision: ['champion', 'rejected'].includes(candidate.phase)
          ? store.decision(candidate.digest)
          : null,
        executionElapsedMsReported: selected.reduce((sum, run) => sum + (run.executionElapsedMs ?? 0), 0),
        missingExecutionDurations: selected.filter((run) => run.executionElapsedMs === null).length,
        usage: sumUsage(selected.map((run) => run.usage)),
        samples: selected,
      };
    }),
    optimizer: {
      episodes: optimizer,
      accounting: optimizerAccounting,
      usage: sumUsage(optimizer.map((e) => e.usage)),
    },
    totalUsage: sumUsage([...samples.map((run) => run.usage), ...optimizer.map((e) => e.usage)]),
    monetaryCost: null,
    lastEvent: events.at(-1)?.sequence ?? 0,
    boundary:
      'Full-denominator descriptive results. QA/build failures consume candidate budget but have no task score. ' +
      'Usage is recomputed from durable DSH adapter stream ledgers; hidden provider retries and prices are unknown. ' +
      'Missing ledgers and missing usage are explicit; reported totals are partial when complete=false. ' +
      'Request durations sum streams and are not wall time. Execution elapsed excludes grading; build/QA time is not token cost. ' +
      'Search selection is not independent validation or causal attribution. No inferred accuracy from optimizer narrative.',
  };
}
