import type { Candidate, ExperimentSpec } from './contracts.js';
import type { experimentReport } from './report.js';

type Report = Awaited<ReturnType<typeof experimentReport>>;

/** A literal code block keeps model-authored text from becoming Markdown instructions or HTML. */
function literal(value: unknown): string {
  const body = JSON.stringify(value, null, 2);
  const longest = Math.max(0, ...[...body.matchAll(/`+/g)].map((match) => match[0].length));
  const fence = '`'.repeat(Math.max(3, longest + 1));
  return `${fence}json\n${body}\n${fence}`;
}

/** Human-readable projection of the same exported evidence; it does not modify the Bundle. */
export function capabilityCard(input: {
  archiveId: string;
  specification: ExperimentSpec;
  candidate: Candidate;
  report: Report;
  researchRecordSha256: string;
  experimentReportSha256: string;
}): string {
  const { specification: spec, candidate, report } = input;
  const result = report.candidates.find((item) => item.digest === candidate.digest);
  if (!result) throw new Error('Exported candidate is absent from the experiment report');
  const hasBundle = candidate.build !== undefined;
  const errors = result.samples
    .filter((sample) => sample.error !== null)
    .map(({ task, repetition, phase, error }) => ({ task, repetition, phase, error }));
  return `# Capability card

Generated from an export-time snapshot of the experiment ledger. This card describes one frozen candidate; it is not an installation approval, a quality certification, or a new model-authored summary. Other candidates or optimizer episodes may still be running, so the attached experiment report is not necessarily the final search ledger.

## Identity and files

${literal({
  archiveId: input.archiveId,
  experimentId: report.experimentId,
  specificationDigest: report.specificationDigest,
  lastCommittedEvent: report.lastEvent,
  sourceDigest: candidate.digest,
  build: candidate.build ?? null,
  researchRecordSha256: input.researchRecordSha256,
  experimentReportSha256: input.experimentReportSha256,
})}

- [Research record](research-record.json): source lineage, original proposal, specification, decisions and evidence inventories.
- [Experiment report](experiment-report.json): full task denominator, per-task outcomes and durable request-ledger accounting for this experiment.
- [Frozen source manifest](source/package.json) and [source dependency lock](source/package-lock.json): original package declarations and dependency resolution.
${hasBundle ? '- [Exact Bundle](bundle.tgz) and [built package manifest](artifact/bundle/package.json): unchanged bytes from the registered build. The build identity above binds the archive, unpacked Bundle, lock and build image.' : '- No Bundle was produced. This export is a source/research archive and cannot be installed as an accepted capability.'}

## Declared intent

Researcher objective (a declaration, not an observed capability):

${literal(spec.objective)}

Candidate proposal (optimizer-authored; not independent evidence):

${literal({
  hypothesis: candidate.proposal.hypothesis,
  expectedChange: candidate.proposal.expectedChange,
  actions: candidate.proposal.actions,
  parents: candidate.proposal.parents,
})}

## Recorded evaluation

| Item | Recorded value |
|---|---|
| Experiment purpose | ${spec.purpose} |
| Candidate state | ${candidate.phase} |
| Expected task executions | ${result.expectedRuns} |
| Observed task executions | ${result.observedRuns} |
| Scored executions | ${result.scoredRuns} |
| Failed or cancelled executions | ${result.failedRuns} |
| Complete denominator | ${result.complete} |
| Mean under the registered metric | ${result.mean === null ? 'unknown (not scored completely)' : result.mean} |

${literal({ metric: report.metric, constraints: spec.constraints, decision: result.decision })}

Build/QA errors and task failures:

${literal({ buildError: result.buildError, qaError: result.qaError, taskErrors: errors })}

${spec.purpose === 'search' ? 'These are search results, including the data used for candidate selection. No independent replication or transfer result is attached by this export.' : 'These are results from the registered validation contract. This card does not establish that the tasks were previously unseen, that the comparison is causal, or that gains transfer to other tasks or models.'}

## Usage and cost

Candidate execution requests only:

${literal(result.usage)}

Optimizer usage for the **whole experiment**, shared across its candidates; it is not allocated to this candidate:

${literal(report.optimizer.usage)}

Monetary cost: **unknown** (the report stores null). Missing ledgers and missing usage stay explicit; reported totals are partial when complete=false. A null reportedTotals value means usage was not observed, including when an empty ledger set has complete=true; it does not mean zero cost. Request duration sums are not wall time. Build/QA and evaluation overhead are not represented as model-token costs.

## Registered execution environment

${literal({
  runtime: { image: spec.runtime.image, dshVersion: spec.runtime.dshVersion, profile: spec.runtime.profile },
  executor: {
    provider: spec.executor.provider,
    model: spec.executor.model,
    reasoningEffort: spec.executor.reasoningEffort,
    maxTokens: spec.executor.maxTokens,
  },
  candidatePatch: spec.candidate.patch,
  isolation: spec.isolation,
  executorEgress: spec.egress.executor.map(({ id, method, path, upstream }) => ({
    id,
    method,
    path,
    upstream,
  })),
})}

These are the original experiment's declared operating conditions, not permissions enforced by the Bundle after installation. Review the exact built manifest, code and dependency lock before granting permissions in another environment. The card does not infer capabilities from package names or the proposal.

## Reuse

${hasBundle ? 'The archive contains the original Bundle for inspection and native DSH installation. A rejected or QA-failed candidate remains a research artifact even when its build produced a tarball. Follow the project [capability installation guide](https://github.com/OLDyade/SparkVolve/blob/main/docs/use-capability.md) with the declared Profile and your own model configuration; installation and behavior in the target environment require their own verification.' : 'Inspect the source and failure record. Resolve the recorded build failure in a new candidate before attempting capability installation; this export contains no substitute package.'}

This card does not read or copy raw input, private-evaluation or trace files. Displayed declarations and diagnostics may quote task data or log fragments and require review before redistribution. Other task families, models, dependency versions and deployment permissions are not certified by these results.
`;
}
