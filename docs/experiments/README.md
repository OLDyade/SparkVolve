# Experiments and Evidence

[Back to Home](../../README.md) · [Experiment Protocol](../research-protocol.md) · [Implementation Status](../completion.md)

Current quality research uses community benchmark tasks. Original failures and negative results remain part of the evidence.

## Community Benchmark Track

[SpreadsheetBench 2 mixed36 pilot](2026-10-30-community-pilot.md): a fixed 12 / 10 / 14 family-separated panel, three mutation-space arms, autonomous ancestry and original-package delivery. The first real study stopped during H0 on provider balance faults; no method superiority or completed multi-generation result is claimed.

## Historical Engineering Acceptance

The records below use synthetic fixtures now stored under `tests/fixtures`. They establish integration behavior and preserve prior conclusions; they are not the main quality benchmark.

| Experiment | Observations and Boundaries |
|---|---|
| [Capability Discovery, Resolution and Composition](2026-10-30-capability-evolution.md) | Real community package acquisition and clean installation; actual cross-plugin service binding; 15 official-model task scorings, tied H0 retained; no autonomous market adoption or quality gain claimed |
| [One-Command Complete Native Closure](2026-10-29-official-closure-results.md) | 15 real task scorings across search, independent validation and original-package reuse; selected H0 retained, rejected mutation and counterexamples preserved |
| [Mutation Methods with Original-Package Reuse](2026-10-29-closure-study-results.md) | Six searches, twelve mutations, 124 task scorings, six unchanged installed selections; autonomous H2 validates and reuses at 100%, method superiority unproven; separate four-task archive check retained |
| [Official DeepSeek Simplified Entry](2026-10-29-official-startup-results.md) | A single command completes real autonomous modification, six task scorings, and export of the original package; H0/H1 both 100%, ties retain H0 |
| [Plugin Mutation Space Comparison](2026-10-29-mutation-space-results.md) | Three groups, six independent searches, 100 executions; five selected the original H0, the only selected mutation has a semantic counterexample, open-space advantage not proven; [pre-registration](2026-10-29-mutation-space-registration.md) retained |
| [Official DeepSeek Native Closed Loop](2026-10-28-official-deepseek-results.md) | Autonomous modification, independent validation, installation of the original archive, and reuse across four task types; also retains the business regression of the manually repaired derived package |
| [Joint Plugin Development](../acceptance-joint-development.md) | 65.625% → 81.25%; the candidate contains an unaccepted heuristic recovery and was not distributed as an accepted capability |
| [Joint Candidate Independent Re-validation](2026-10-28-joint-independent-results.md) | Baseline 93.75%, candidate 77.08%; 24/24 scorings, promotion rejected |
| [Same-G Feedback Comparison](2026-10-28-paired-feedback-results.md) | 4 independent searches, 8 mutations, 60 task scorings; the mean difference cannot be attributed to mutation |
| [Continuous Search and Resumption](../acceptance-continuous.md) | Three real mutations, session resumption, failures and negative results |
| [Structured Data Domain](../acceptance-structured-data.md) | The same controller completes second-domain mutation, scoring, regression rejection, and installation invocation |
| [Optimizer Self-Evolution](2026-10-28-optimizer-study-results.md) | G/H versioned separately, equal-budget comparison, and closed validation |
| [Native Behavior Experiments](2026-10-28-native-probe-spreadsheet-results.md) | Real invocations of tool mechanisms, counterexamples, and explicit failures |
| [Public CI and Distribution](2026-10-28-public-ci-and-delivery.md) | Cloud checks, runtime matrix, and installation from the same tarball |

## Continuous Search Records

![Complete results of continuous search and independent re-validation](../assets/experiment-results.svg)

The chart comes from [machine records](../evidence/2026-10-27-continuous-acceptance.json). Re-validation included one transmission failure and two cancellations, with the full denominator retained; the highest development-set score is not used as a substitute for a stable-gain conclusion.

## Verification and Reproduction

- [Original End-to-End Acceptance](../acceptance.md)
- [Clean-Checkout User Journey](../research/2026-10-28-user-journey.md)
- [Native Implementation Verification](../research/2026-10-27-native-implementation.md)
- [Candidate Original-Byte Evidence](../evidence-access.md)
- [Capability Cards and Usage](../capability-cards.md)
- [Release and Registration Failure Recovery](../research/2026-10-28-publication-recovery.md)
- [Research Asset Reuse](../research-assets.md)
- [Ecosystem and Design In-Depth Review](../research/2026-10-27-harness-evolution-design-review.md)
- [Review Implementation Ledger](../review-ledger.md)
- [Historical Materials and Synchronization Sources](../research/archive/README.md)

Export your own experiment report: `node dist/cli.js report --root <experiment directory> --output <new file.json>`. This command reads existing artifacts and does not rerun tasks.
