# DSH Native Plugin Development: Real Closed-Loop Results

**Overall acceptance failed.** The native authoring tools, official Skill, autonomous implementation mutation, independent task scoring, and original package installation all have real execution evidence; 1 of the 20 tasks had a model request hang during the connection phase, triggering the 300-second task limit. The original failure is preserved; no tasks were added, rerun, or scores modified.

This round also did not demonstrate a score improvement: both mutations and H0 had a development mean of **81.25%**, and strict selection retained H0. The specific counterexamples for the new evaluator have been reproduced by an independent subagent; the candidates are kept as research artifacts and are not released as reliable general-purpose computation capability.

## Fixed Identity and Run Results

| Item | Record |
|---|---|
| Implementation commit | `d8b11ec` |
| Run image | `sha256:3e941da1abf0493a67aa2de615b91e2a8045d0a9e1b1a7537f22f80f1482de37` |
| Model | Venus `deepseek/deepseek-v4.1-flash-1017`; G/H use the same registered contract |
| Run time | 2026-10-28 01:48:15—02:01:42 UTC |
| Tasks | 12 development executions + 8 independent re-validations; 19 completed scoring, 1 execution timeout |
| Request ledger | 233 started, 232 result, 0 recorded failed, 1 unfinished; all 21 ledgers exist |
| Reported usage | 314,023 input tokens, 77,185 output tokens; final usage of the unfinished request is unknown |
| Original package installation | Installation of the final champion H0's original tarball and native assembly passed; no model was invoked during installation |
| Raw evidence | [Index](../evidence/native-authoring-20261028/index.json), [acceptance receipt](../evidence/native-authoring-20261028/acceptance.json), [pre-registration](../evidence/native-authoring-20261028/registration.json) |

Before the run, all runtime modules of the host and image were checked, and the authoring data sources, inputs, methods, and evaluation contract were frozen. For the design see the [pre-run plan](2026-10-28-native-authoring-registration.md); for issues found during wiring and real installation see the [implementation record](../research/2026-10-28-native-authoring-integration.md).

## What Was Actually Completed

```text
Real DSH optimizer
  ├─ inspect_list ×1, inspect_query ×2: successfully obtained the native contract
  ├─ official plugin development Skill ×1: body matches the registered installation package verbatim
  └─ autonomously added tools and Python implementation, submitted two frozen candidates
            │
            ▼
Native QA → full 4-question scoring per candidate → tie rejected, H0 retained
            │
            ▼
Independent re-validation of original H0/selected H0 → 7 questions scored + 1 timeout
            │
            ▼
Final original package export and native installation passed → overall acceptance remains failed
```

Of the 7 pre-registered checks, 5 passed: actual queries, actual Skill loading, implementation mutation entering native validation and task evaluation, search final state, and original package installation. Two failed: all independent re-validation scoring and complete termination of model requests. The model submitted 4 requests, and only 2 new candidates entered registration; out-of-budget submissions added no new tasks. The optional `evolution_probe` was not invoked, so local script runs cannot be written up as native behavior experiments.

## Candidates, Algorithm Counterexamples, and Usage Boundaries

| Version | Changes and actual usage | Development mean and decision |
|---|---|---|
| H0 `686ad0b…218b` | Original table-capability Bundle | 81.25%, retained |
| H1 `423b383…853b` | Added calculate, verify, cells; the first two were actually invoked in normalization/weighted tasks | 81.25%, rejected |
| H2 `d4e566a…0c6d` | Added profile, original cache comparison, and single-cell handling; profile/verify/calculate were actually invoked in debt/scenario | 81.25%, rejected |

The assembly patches of both candidates were unchanged, and `cells` was not invoked by any task. This round demonstrated that plugin implementations and tool capabilities can mutate autonomously; it did not demonstrate compositional topology mutation or that all newly added tools are effective.

The independent review executed pure in-memory counterexamples against the frozen code, with no model calls and no candidate modifications:

| Formula or input | Actual result | Correct semantics |
|---|---|---|
| `SUMPRODUCT([2,3],[5,7])` | 17 | 2×5 + 3×7 = 31 |
| `IF(1=1,5,1/0)` | DIV/0 | Condition holds, should return 5 |
| `Data!A1`, original value 9 | None, read `Dat!A1` | Should read 9 |
| In H2, `B2` has a comment in an all-empty-value row | Returns only `blank_row` | The comment is still original content; cannot claim all were preserved |

H2 retained the same evaluator as H1. When H1's verify returned zero differences, the independent normalization score was still only 25%; calculator agreement cannot prove business formulas are correct. No hardcoded task answers or automatic business fixes were found, which does not offset the confirmed algorithm errors. For complete sources, file digests, and the call table see the [independent mechanism review](../evidence/native-authoring-20261028/independent-mechanism-review.json).

## Timeout and Independent Re-validation

In the first re-validation arm, normalization issued the 8th model request after the last local tool succeeded. The controlled egress record stopped at `connect`, with no upstream HTTP status; it was terminated by the task's overall time limit after about 283.9 seconds. This phase covers TCP, TLS, and waiting for response headers; the available evidence cannot further distinguish link from provider causes. No OOM occurred in the container; the unfinished request was not falsified as a failure response with existing usage. The original worker, broker, and network have all been cleaned up; see the [transport diagnosis](../evidence/native-authoring-20261028/transport-diagnosis.json) for details.

Both re-validation arms used **exactly the same H0 source, build, and tarball**: the first arm included the timeout and another business zero, giving a full-denominator mean of 50%; the second arm was 100%. This is a difference between two executions of the same artifact and cannot be attributed to mutation, native authoring capability, or quality improvement; the comparison report also did not label it as a strict improvement.

This round retains the overall acceptance failure and does not replace the failure conclusion with successful sub-checks, the second arm's high score, or installation passing. What is currently deliverable is the implemented and validated native development integration and experimental framework; stable gains, autonomous mutation of complex compositions, and failure-free real acceptance still require independent evidence.
