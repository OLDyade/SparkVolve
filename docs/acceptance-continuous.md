# Continuous Evolution and Product Closed-Loop Acceptance

2026-10-27, the real model used Venus `deepseek/deepseek-v4.1-flash-1017`, thinking off; DSH `0.2.1-rc.4`. All runs used independent directories and fixed contracts, failures were not overwritten, and model weights, judges, and task lists did not change with mutations.

Machine records: [candidate lineage, per-task scores, call usage, re-validation, and package hashes](evidence/2026-10-27-continuous-acceptance.json).

## What Was Actually Verified

```text
One evolve command
  └─ native DSH optimizer → plugin code / tool Schema / prompt contribution mutation
       └─ freeze → native QA → real tasks → independent recomputed scoring
            └─ original result feedback → next mutation → strict selection / retain negative results

Frozen baseline + frozen candidate
  └─ new task protocol registration → two groups × four tasks × two repetitions → full-denominator paired report

Final-state candidate
  └─ npm package + research archive → local retrieval → new experiment draft (no prior scores)

Separately listed lifecycle acceptance
  └─ real session 0 ends → automatic session 1 → read previous receipt → evolution_finish
```

The search did modify the plugin implementation, tool Schema, and native prompt contribution. `cordis.patch` did not change in these mutations, so this round is not used to prove that combinatorial topology search is effective. The model did not follow the product acceptance goal's cadence of "only one candidate submitted per session"; multiple mutations occurred in the same session. The framework supports cross-session continuation, which was tested separately with a real two-session lifecycle experiment; the two experiments are not combined into a single quality result.

| Version | Actual mechanism change | Three-task mean | Verdict |
|---|---|---:|---|
| Baseline `090461bf…` | Original read/write capability | 100% | Champion retained |
| `8c6ad260…` | Added validation tool and corresponding prompt contribution | 100% | Rejected on tie |
| `b326c779…` | Derived from previous mutation, merged form-filling and validation tools | 90.4762% | Rejected as regression |
| `8918fdbe…` | Forked from `8c6ad260…`, incorporated `b326c779…` failure evidence to fix form-filling implementation | 100% | Rejected on tie |

All four versions scored successfully 3/3 each, with no execution failures. The optimizer terminated on its own; cumulative container time was 925.547 seconds; all 121 adapter streams returned, and the provider reported 311,631 input and 36,517 output tokens. Provider-internal HTTP retries and unknown costs are not extrapolated as zero. The final archive was exported after completion; no regressed candidate was published.

## Independent Re-validation: Negative Results Are Equally Fully Retained

Among completed mutations, the one with the highest search score was selected, with the earliest version chosen on ties; the selected mutation had reached the metric ceiling, so subsequent candidates could not replace it under this rule. The comparison protocol was registered before starting, using four new synthetic business tasks, each run twice, with both baseline and candidate re-executed. The optimizer received no re-validation feedback.

| Group | Successful scores | Execution failures | Cancellations | Full-denominator mean |
|---|---:|---:|---:|---:|
| Baseline | 8 | 0 | 0 | 78.125% |
| Candidate `8c6ad260…` | 5 | 1 | 2 | 53.125% |

The candidate encountered an upstream `TRANSPORT: Connection error.` during the second debt-schedule task; the pre-registered failure budget was 0, so the remaining two tasks were cancelled and counted as failing scores. The mean difference is −25 percentage points, `strictImprovement=false`. This gap includes the effects of both business performance and infrastructure failure and cannot be attributed entirely to plugin quality. The original report is retained; no retries, no supplementary tasks, and no change to the denominator.

This task set covers adjustments and tax basis, weighted profit margin and units, debt amortization, and scenario valuation, all of which are synthetic materials for this project. It tests the re-validation protocol and performance on new tasks and does not represent an official SpreadsheetBench score or statistical significance.

## Lifecycle, Installation, and Reuse

- **Real two-session**: Session 0 called status and then ended normally; session 1 read `/previous/receipt.json`, then read status, and called `evolution_finish`. Both completed, with cumulative optimizer container time of 17.685 seconds. This is a pure lifecycle test and does not involve mutation gains.
- **Real distribution installation**: The current repository was packaged, and the native `plugin add` was executed in a clean DSH Home; six evolution tools entered actual SDK requests, and the status tool executed successfully. The Provider was an explicitly marked deterministic protocol fixture and is not counted as a model quality score. For evidence that a real model completed XLSX after installation earlier, see [original acceptance](acceptance.md).
- **Research assets**: A real non-advancing candidate was exported and stored in the research library, then queried and imported into a new experiment; the imported bytes were exactly identical to the frozen candidate digest, the source was recorded, and no scores were inherited. The new experiment did not start any tasks and is not treated as additional sampling.
- **Interruption recovery**: In a real container integration test, the controller was forcibly terminated, then restarted to collect the original container; the original container ID remained unchanged, and independent scoring and archiving were completed.
- **Engineering verification**: 17 unit tests, 5 native tests, 1 distribution installation test, and 1 real container integration test passed; type and format checks passed; dependency audit found 0 vulnerabilities.

## Actual Failures and Boundaries

The first continuous search encountered an upstream connection failure, and the optimizer submitted no candidate. A telemetry accounting defect was also found: errors returned via the native finish event had been recorded as successful returns; after the fix, this was covered by a real SDK test. The original failure report was not rewritten; its 14 starts should be interpreted as 13 returns and 1 failure.

The distribution test first exposed a change in npm 12 JSON output, then exposed that the target Profile lacked native dependency build authorization. Both were corrected according to the verified new format and the exact dependency configuration respectively, and the native installation acceptance ultimately passed, with no source mount substituting for installation.

The generated non-advancing mutation contains mandatory verify-ready process wording; it is an experimental artifact pending testing and is not recommended as a default framework strategy. Current evidence does not prove stable score improvement; although the optimizer method can be independently replaced as a Bundle, the benefit of automatically optimizing the optimizer itself remains to be studied.

At the time of this historical acceptance, GitHub Actions did not start any steps due to account payment/spending quota limits, and the repository remained private; these old records remain unchanged. For cloud results after it was made public on 2026-10-28 per user instruction, see [new records](experiments/2026-10-28-public-ci-and-delivery.md). Apache-2.0 is adopted, and no npm package has been published; the core sentence of `11.md` is unmodified.
