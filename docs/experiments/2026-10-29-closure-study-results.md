# Plugin Mutation Methods: Independent Validation and Original-Package Reuse

[Preregistered protocol](2026-10-29-closure-study-registration.md) · [Complete machine record and exact source patches](../evidence/closure-20261029/mutation-study/results.json) · [One-command startup acceptance](2026-10-29-official-closure-results.md)

The complete experiment ran on the official DeepSeek API from **06:17:45 to 06:39:53 UTC on 2026-10-29**. Six independent searches produced twelve autonomous mutations. One mutation failed native assembly QA; the remaining registered executions completed **124/124 task scorings with zero task execution failures**. Every search selection was exported unchanged, installed into fresh native DSH Profiles, and used on four new reuse instances. No task was retried or replaced.

This closes the engineering path from autonomous plugin modification through independent evaluation to installation and real reuse of the original package. **It does not establish that a larger mutation space improves accuracy.**

## Fixed Comparison

The same optimizer G, baseline H0, model configuration, public task families, feedback, seed-only ancestry and search budgets were used in all arms. Only permitted source scope differs:

| Arm | Permitted changes | Independent searches | Validation mean | Fresh installed reuse mean |
|---|---|---:|---:|---:|
| Prompt | `guidance.md` | 2 | 100% | 90.625% |
| Single plugin | `guidance.md`, `index.mjs`, `workbook.py` | 2 | 87.5% | 90.625% |
| Open plugins | Whole candidate Bundle, including composition and dependencies | 2 | 87.5% | 87.5% |

The separate H0 validation baseline completed eight tasks at **81.25%**. Five searches selected the unchanged H0. Consequently, several apparent differences compare executions of the exact same source and build. Prompt's higher mean cannot be attributed to a prompt improvement, and open-plugin benefits are not demonstrated. Two independent searches per arm are the experimental sample size; task-level observations are not additional independent evolutions.

## Every Search and Selection

Percentages below are observed means on four tasks. H1 and H2 are successive proposals, both derived from the frozen seed under the registered ancestry rule.

| Arm / repetition | Search H0 | H1 | H2 | Selected | Independent validation | Original-package reuse |
|---|---:|---:|---:|---|---:|---:|
| Prompt / 0 | 81.25% | 81.25% | 81.25% | H0 | 100% | 100% |
| Prompt / 1 | 100% | 75% | 100% | H0 | 100% | 81.25% |
| Single plugin / 0 | 81.25% | 81.25% | 81.25% | H0 | 75% | 81.25% |
| Single plugin / 1 | 56.25% | 81.25% | 100% | H2 | 100% | 100% |
| Open plugins / 0 | 100% | 100% | QA rejected | H0 | 75% | 75% |
| Open plugins / 1 | 75% | 75% | 75% | H0 | 100% | 100% |

Accounting: 68 search executions + 24 independent selection assessments + 8 separate H0 assessments + 24 installed reuse executions = **124**. The ceiling was 128; the four task slots associated with the QA-rejected candidate were never launched. That rejection remains in the candidate denominator and original report; it is not four upstream-service failures.

The rejected open candidate declares `parameters.edits.items.properties.fill` without an explicit `additionalProperties`. Native DSH schema validation rejected it before model task execution. No schema repair or repeat attempt was inserted into the experiment.

## Actual Autonomous Changes and Delivery

All twelve [source patches](../evidence/closure-20261029/mutation-study/patches/) were independently reapplied to their frozen H0 source, reproducing the recorded candidate tree digests exactly. Prompt proposals changed only guidance. The other arms changed tool implementation, interface and guidance; none of these twelve proposals changed the composition file or package dependencies. An open search space permits structural innovation, but this run does not demonstrate autonomous topology evolution.

The selected single-plugin H2 is source `9f7f6ce3f522055829d12867c923492be26df01871342014490d5f9eae2abd8f`. It adds richer workbook inspection, explicit recalculation and diagnostic receipts. Search traces actually called `workbook_inspect` five times, `workbook_write` twelve times and `workbook_recalc` once, alongside eleven shell calls. Tool invocation is verified; a specific mechanism's causal contribution is not isolated.

Its original archive SHA-256 is `8ad5f3da1ab5798942e536b1b81d27c4a280f25f4c139cde72674f495ae2a68c`. That exact archive was installed in four clean Profiles, executed four fresh tasks, and passed post-execution identity checks. All four independent validation tasks and all four installed reuse tasks scored 100%. No maintainer source fix or rebuild occurred between search and installation.

Independent native [counterexample evidence](../evidence/closure-20261029/selected-plugin-counterexample.json) also records false diagnostics from this selected artifact:

| Caller-supplied content | Observed behavior |
|---|---|
| Valid formula `="("` | Warns about unbalanced parentheses because it counts characters inside the quoted literal |
| Literal text `Version (Q1)` | Warns that text should have been a formula |

The workbook preserves both submitted values and their correct formula/string types. These are false diagnostics, not observed corruption of those two cells. The source also converts engine exceptions into unsuccessful recalculation receipts. The score-selected artifact remains an experimental output with known limitations; it is not recommended as a general-purpose spreadsheet Bundle.

## Fresh Reuse Scores, Including Regressions

Every row uses its own original installation and actual task execution. No search or validation score is copied into this table.

| Selection | Normalization | Weighted portfolio | Debt rollforward | Scenario valuation |
|---|---:|---:|---:|---:|
| Prompt / 0, H0 | 100% | 100% | 100% | 100% |
| Prompt / 1, H0 | 25% | 100% | 100% | 100% |
| Single / 0, H0 | 25% | 100% | 100% | 100% |
| Single / 1, H2 | 100% | 100% | 100% | 100% |
| Open / 0, H0 | 100% | 100% | 100% | 0% |
| Open / 1, H0 | 100% | 100% | 100% | 100% |

These variations include unchanged H0 installations. Reuse is a separate measurement on changed numeric instances of the same four public families. It is not hidden evaluation, unknown-family transfer, or a basis for selecting a different winner after seeing results.

## Separate Autonomous-Archive Check

A [separately registered check](../evidence/closure-20261029/autonomous-archive.json) installed the first open search's H1 after the main study finished. It adds **four executions outside the method comparison**, all scored 100%, with 18 adapter requests, 11,103 reported input tokens and 4,328 reported output tokens. This candidate remains rejected because it tied H0 in its original search.

The original archive `acdb4d57153e7f5593d449c269a3a70c4ef8ad06fffdccdd569e60f2c34720f4` was unchanged. Native [counterexamples](../evidence/closure-20261029/spreadsheet-counterexamples.json) reproduce coercion of explicit string `0012` to numeric `12`, conversion of a literal space to an empty cell, and classification of a legitimate formula text result as an error. Installation and task scores do not erase these defects. This artifact is retained for research, not released as a recommended capability.

## Cost, Reproducibility and Boundaries

The main comparison recorded **1,302 adapter requests started / 1,302 returned / 0 failed / 0 unfinished**, with **1,172,881 input tokens** and **368,970 output tokens** reported. No observed request lacks usage. Summed request time is 2,950.085 seconds; it includes concurrency and is not wall time. Monetary billing is unavailable and is not inferred from token counts. Adapter requests are the measured unit; provider-internal transport behavior is not separately instrumented.

The same official `deepseek-flash` configuration, DSH 0.2.1-rc.4, Cordis 4.0.5, immutable container image and 600-second task budget were used throughout. The server's model alias does not freeze upstream weights. The registration contains generator/evaluator/source/build hashes, full failure accounting, original installation identities and all per-task observations. The earlier study remains independently available; its scores are not pooled into this one.

The local raw root is `.evolution/mutation-closure-official-20261029`. The public record contains sanitized reports and exact source patches. The public examples establish a working native evolution and delivery system. Stable quality gains, complex assembly evolution and cross-family transfer remain research questions requiring further preregistered evidence.
