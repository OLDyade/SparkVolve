import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { confined, digest } from './artifacts.js';
import { Experiment } from './contracts.js';
import { Store } from './store.js';
import { experimentReport, sumUsage, usageAt } from './report.js';
import { OptimizerStudyCoordinator } from './optimizer-study.js';
import type { OptimizerStudyStore } from './optimizer-study-store.js';
import { isFixedComparison } from './optimizer-study-contracts.js';

type Usage = Awaited<ReturnType<typeof usageAt>>;
type ChildReport = Awaited<ReturnType<typeof experimentReport>>;
interface Coverage {
  unavailableSources: number;
  unobservedTaskRuns: number;
  activeSources: number;
}

function total(rows: Usage[], coverage: Coverage) {
  const measured = sumUsage(rows);
  const emptyLedgers = rows.filter((row) => row !== null && row.started === 0).length;
  const tokenReports = rows.reduce(
    (sum, row) => sum + (row ? row.results + row.failed - row.missingUsage : 0),
    0,
  );
  const reportedTotals: Record<string, number | null> | null =
    measured.reportedTotals === null
      ? null
      : {
          ...measured.reportedTotals,
          inputTokensReported: tokenReports ? measured.reportedTotals.inputTokensReported! : null,
          outputTokensReported: tokenReports ? measured.reportedTotals.outputTokensReported! : null,
        };
  return {
    ...measured,
    ...coverage,
    emptyLedgers,
    reportedTotals,
    complete:
      measured.complete &&
      rows.length > 0 &&
      emptyLedgers === 0 &&
      coverage.unavailableSources === 0 &&
      coverage.unobservedTaskRuns === 0 &&
      coverage.activeSources === 0,
  };
}

function childUsage(report: ChildReport | null, active: boolean) {
  const rows =
    report === null
      ? []
      : [
          ...report.candidates.flatMap((candidate) => candidate.samples.map((sample) => sample.usage)),
          ...report.optimizer.episodes.map((episode) => episode.usage),
        ];
  const coverage = {
    unavailableSources:
      report === null ? 1 : report.purpose === 'search' && report.optimizer.episodes.length === 0 ? 1 : 0,
    unobservedTaskRuns:
      report === null
        ? 0
        : report.candidates.reduce(
            (sum, candidate) =>
              sum +
              (['build_failed', 'qa_failed'].includes(candidate.phase)
                ? 0
                : Math.max(0, candidate.expectedRuns - candidate.observedRuns)),
            0,
          ),
    activeSources: active ? 1 : 0,
  };
  return { rows, coverage, summary: total(rows, coverage) };
}

function combined(groups: Array<{ rows: Usage[]; coverage: Coverage }>) {
  return total(
    groups.flatMap((group) => group.rows),
    {
      unavailableSources: groups.reduce((sum, group) => sum + group.coverage.unavailableSources, 0),
      unobservedTaskRuns: groups.reduce((sum, group) => sum + group.coverage.unobservedTaskRuns, 0),
      activeSources: groups.reduce((sum, group) => sum + group.coverage.activeSources, 0),
    },
  );
}

/** Host-only, read-only accounting; never supplied to the active meta optimizer after development. */
export async function optimizerStudyReport(root: string, store: OptimizerStudyStore) {
  const snapshot = new OptimizerStudyCoordinator(root, store).reportSnapshot();
  const fixed = isFixedComparison(store.spec);
  const childReport = async (directory: string, expected: string | undefined) => {
    const home = confined(root, directory);
    if (!expected) return { report: null, availability: 'not-registered' as const };
    try {
      await stat(path.join(home, 'experiment.sqlite'));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT')
        return { report: null, availability: 'experiment-missing' as const };
      throw error;
    }
    const spec = Experiment.parse(JSON.parse(await readFile(path.join(home, 'experiment.json'), 'utf8')));
    if (digest(spec) !== expected) throw new Error('Study cost ledger child specification changed');
    const child = new Store(path.join(home, 'experiment.sqlite'), spec, 'read');
    try {
      return { report: await experimentReport(home, child), availability: 'available' as const };
    } finally {
      child.close();
    }
  };
  const jobs = await Promise.all(
    snapshot.jobs.map(async (job) => {
      const search = await childReport(job.childRoot, job.childSpecDigest);
      const assessment = await childReport(job.assessmentRoot, job.assessmentSpecDigest);
      return {
        ...job,
        search: search.report,
        assessment: assessment.report,
        searchAccounting: {
          availability: search.availability,
          ...childUsage(search.report, ['reserved', 'searching', 'cancelling'].includes(job.phase)).summary,
        },
        assessmentAccounting: {
          availability: assessment.availability,
          ...childUsage(
            assessment.report,
            ['reserved', 'searching', 'assessing', 'cancelling'].includes(job.phase),
          ).summary,
        },
      };
    }),
  );
  const meta = await Promise.all(
    snapshot.metaEpisodes.map(async (episode) => ({
      ...episode,
      actualSeconds: episode.actualSeconds ?? null,
      usage: await usageAt(path.join(root, 'meta-optimizer', String(episode.ordinal), 'trace')),
    })),
  );
  const search = jobs.map((job) =>
    childUsage(job.search, ['reserved', 'searching', 'cancelling'].includes(job.phase)),
  );
  const assessment = jobs.map((job) =>
    childUsage(job.assessment, ['reserved', 'searching', 'assessing', 'cancelling'].includes(job.phase)),
  );
  const metaUsage = {
    rows: meta.map((episode) => episode.usage),
    coverage: {
      unavailableSources: !fixed && meta.length === 0 ? 1 : 0,
      unobservedTaskRuns: 0,
      activeSources: meta.filter((episode) => ['reserved', 'running'].includes(episode.phase)).length,
    },
  };
  const measuredMeta = meta.filter((episode) => episode.actualSeconds !== null);
  const unreservedSearchInstances = fixed
    ? snapshot.validation.reduce(
        (sum, report) => sum + report.samples.filter((sample) => sample.job === null).length,
        0,
      )
    : 0;
  const unreserved = {
    rows: [] as Usage[],
    coverage: { unavailableSources: unreservedSearchInstances, unobservedTaskRuns: 0, activeSources: 0 },
  };
  return {
    ...snapshot,
    accounting: {
      meta,
      jobs,
      metaElapsed: {
        applicable: !fixed,
        reportedSeconds: fixed
          ? 0
          : measuredMeta.length
            ? measuredMeta.reduce((sum, episode) => sum + episode.actualSeconds!, 0)
            : null,
        measuredEpisodes: measuredMeta.length,
        unmeasuredEpisodes: meta.length - measuredMeta.length,
      },
      metaUsage: {
        ...combined([metaUsage]),
        applicable: !fixed,
        ...(fixed
          ? { complete: true, status: 'not-applicable' as const }
          : { status: 'applicable' as const }),
      },
      unreservedSearchInstances,
      searchUsage: combined([...search, unreserved]),
      assessmentUsage: combined([...assessment, unreserved]),
      totalUsage: combined([...(fixed ? [] : [metaUsage]), ...search, ...assessment, unreserved, unreserved]),
      monetaryCost: null,
      boundary:
        'Measured DSH request ledgers only. Complete means closed accounting coverage, not successful execution or quality. Missing child experiments, unobserved task slots, absent optimizer episodes and unavailable token usage remain explicit; aggregated token totals are null when no provider usage was reported. Raw child/meta counters retain explicit missingUsage. Empty ledgers do not certify zero-cost success. Meta research, child search and independent assessment costs are separated. Stream durations are sums, not elapsed wall time; provider-internal retries and prices are unknown. Registered allocation is an upper bound, not measured consumption. Build, QA and evaluator resources are not model-token costs.',
    },
  };
}
