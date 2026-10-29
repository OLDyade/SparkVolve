# Plugin Mutation Space Comparison · Actual Results

[Pre-registration protocol](2026-10-29-mutation-space-registration.md) · [Per-task records and raw summaries](../evidence/mutation-space-20261029/results.json) · [Counterexamples](../evidence/mutation-space-20261029/helper-counterexamples.json)

**Three groups and six independent searches have been completed. The current results do not demonstrate that open plugin mutation is superior to restricted mutation.** The only selected new candidate scored 100% in both development and independent validation, but source review and deterministic counterexamples simultaneously found semantic inference and fallback paths that do not meet general delivery requirements; it is retained as a research artifact and is not released as a recommended capability.

## Actual Run

2026-10-29 02:16:55–02:35:01 UTC, official `deepseek-flash`, G/H used the same model configuration and the same DSH runtime image, 600 seconds per task. Execution implementation locked to commit [`6590b97`](https://github.com/OLDyade/spark-harness-evolution/commit/6590b97ac3b025c8650e7f3f68f9c0c86c12b20b). G, H0, tasks, scoring and budget summaries were all frozen before the first model call; the raw directory is `.evolution/mutation-space-official-20261029`.

```text
Same G + same H0 + same development tasks and budget
                 │
       ┌─────────┼───────────┐
       ▼         ▼           ▼
    Prompt      Single plugin       Open plugin
    2 searches  2 searches     2 searches
       └─────────┼───────────┘
                 ▼
     17 candidate instances (including six H0)
     68 development executions → freeze each H*
                 ▼
     24 independent validations + 8 shared H0 validations
                 ▼
     Raw scores + actual mutations + tool calls + counterexamples
```

A total of 100 real task executions: 95 scored, 5 execution failures, denominator retained. Upper limit 104; the second single-plugin search ended on its own after submitting one new candidate, and the remaining four-task budget was not run to fill the gap. All six searches completed, with no task retries, concatenated attempts, or manual candidate modifications.

## Complete Results

Development scores determine the H* selected for each search, and only then is independent validation performed on it. The two validation means for the shared H0 were both 81.25%, across eight task instances in total.

| Mutation scope / search | Development H0 | Development H1 | Development H2 | Selected version | H* independent validation | Corresponding H0 validation | Difference |
|---|---:|---:|---:|---|---:|---:|---:|
| Prompt / 1 | 81.25% | 75% | 75% | Original H0 | 75% | 81.25% | −6.25 pp |
| Prompt / 2 | 100% | 81.25% | 81.25% | Original H0 | 100% | 81.25% | +18.75 pp |
| Single plugin / 1 | 81.25% | 0% (four tasks failed to execute) | 81.25% | Original H0 | 81.25% | 81.25% | 0 pp |
| Single plugin / 2 | 81.25% | 100% | Budget unused | New H1 | 100% | 81.25% | +18.75 pp |
| Open plugin / 1 | 100% | 75% | 75% | Original H0 | 100% | 81.25% | +18.75 pp |
| Open plugin / 2 | 100% | 75% (one task failed to execute) | 75% | Original H0 | 81.25% | 81.25% | 0 pp |

Group means: Prompt **87.5%**, Single plugin **90.625%**, Open plugin **90.625%**. The experimental unit for each group is two independent searches; the eight validation tasks cannot be treated as eight independent evolutions. The source code, build and raw package selected by five searches were all the same H0; the score differences between these repeated executions do not come from plugin modifications. A 3.125 pp difference between groups is also insufficient to support conclusions about the superiority of either method.

## What the Model Actually Changed

- The four new candidates in the Prompt group only modified `guidance.md`, without exceeding the source scope contract.
- The three new candidates in the Single plugin group modified `guidance.md`, `index.mjs` and `workbook.py`. The only selected candidate `01a983e0…` added native tools `workbook_recalc`, `workbook_review`, `workbook_diff`, and each of the three tools was actually called four times during development executions. [Raw source diff](../evidence/mutation-space-20261029/patches/single-plugin-1-h1.patch) retains the model-generated content.
- The four new candidates in the Open group likewise only modified these three files; no plugins were added, and no dependencies or assembly structure were modified. Therefore this round tested **autonomous choice under open permissions**, and did not form a controlled comparison of the effects of joint topology mutation, so it cannot be used to refute or prove joint evolution.

The file lists, patches, call counts and scores of all 11 mutations are recorded in the machine records. The public patches were applied one by one to independent copies of the original H0, and the source digests of all 11 results match the original frozen candidates; see [patch review](../evidence/mutation-space-20261029/patch-verification.json). New numerical validation on a fixed public task family may still retain task-type adaptation and does not cover unfamiliar domains.

## Native Interface Failures and Reusability Counterexamples

The H1 from the first single-plugin search used `{{C}}` and `{{R}}` examples in the prompt. The original seed interpolated the prompt according to DSH default rules, the complete variable group format was invalid, and four tasks failed before the model was requested. The subsequent H2 was adjusted by the optimizer itself and does not override the H1 failure. In the second search of the Open group, another task received invalid tool-argument JSON, was scored zero as a failure, and was not retried.

For the selected `01a983e0…`, directly calling the original Python helper in the frozen image reproduced four counterexamples:

| Explicit input | Actual candidate observation | Problem |
|---|---|---|
| Three columns are side-by-side exit scenarios, all with valid valuations | Suggests leaving the first two columns blank | Interprets the columns uniformly as consecutive years |
| Label explicitly states percentage points, value is 25 | Suggests changing to a ratio | Guesses the unit from magnitude and format, ignoring the explicit unit |
| Formula returns the ordinary string `#N/A`, cached type is string | Reports a formula error | Uses a text prefix in place of the cell error type |
| Alignment indent is 2 | Returns indent 0 | Reads a nonexistent attribute of the font object and swallows the exception |

[Counterexample source](../evidence/mutation-space-20261029/helper-counterexamples.py) and the original results are both public. They are deterministic helper behavior checks, with no new model calls, not added to the original evaluator, and they do not retroactively change scores. The candidate additionally contains a path that falls back to reading the old cache after a recalculation failure; this is inconsistent with the project's explicit-failure principle. The full development and validation scores did not cover these paths, so the mutation package was not recommended, installed, or released.

After the experiment concluded, per the [DSH official interface](https://github.com/deepseek-ai/deepseek-harness/blob/f3803c96974ad4a94195fb97e5c637e9c2a3afe3/packages/core/system-prompt/README.md), the free-text slot of the future research seed was set to `interpolate: false`, and it was actually verified that native rendering preserves original text such as `{{C}}` and that the registration is removed after uninstallation. The original H0, image, failures and results of this round are fully preserved; the corrected seed did not rerun this round or obtain new model scores. When reviewing this round, the frozen commit, source digests and protocol are authoritative.

## Usage and Engineering Acceptance

| Scope (including G, development and H* validation) | Requests started | Returned / failed / unfinished | Reported input tokens | Reported output tokens | Sum of G runtime seconds |
|---|---:|---|---:|---:|---:|
| Prompt | 304 | 304 / 0 / 0 | 305,826 | 72,777 | 311.984 |
| Single plugin | 301 | 301 / 0 / 0 | 330,226 | 92,385 | 486.042 |
| Open plugin | 409 | 408 / 1 / 0 | 379,548 | 103,688 | 525.084 |
| Shared H0 validation | 54 | 54 / 0 / 0 | 28,540 | 12,281 | Not applicable |
| Total | **1,068** | **1,067 / 1 / 0** | **1,044,140** | **281,131** | **1,323.110** |

The request basis is the DSH adapter stream call records. Failed requests lack usage, and the token totals include only usage reported by the service and cannot be regarded as a complete bill; costs were not reported and cannot be filled in as zero. Per-task durations, failures and auxiliary metrics are in the JSON; speed does not affect selection. The Study's `passed: true` indicates that protocol execution and report finalization are complete, and cannot be taken as method benefit or as passing candidate semantic acceptance.

The implementation commit's [GitHub four-way CI](https://github.com/OLDyade/spark-harness-evolution/actions/runs/40805867567) all passed, 24 items each for runc/gVisor. After the finalization fixes, `npm run check` all passed, including formatting, documentation, types, 266 unit tests and 28 native tests.

Follow-up research should first address native contract misuse and semantic inference not proven by inputs, and expand independent tasks that can distinguish these behaviors. Continue to preserve the full evolution space of plugin implementations, configurations and composition structures; plugin count, lines of code and the highest single-batch score are not criteria for evolutionary success.
