# From Mechanism Narrative to Native Executable Experiments

## Problem Evidence

The two most recent real searches were able to add tools, but lacked counterexample experiments for the newly added algorithms. The structured-data candidate left three actual errors: maximum-revision deduplication order, decimal rounding, and default parameters; the original optimizer also offered an explanation for an unconfirmed timeout cause. The original source code, scores, and attribution corrections are all preserved in [Second-Domain Acceptance](../acceptance-structured-data.md). This supports the capability to add experiments, but does not yet prove that adding them will necessarily improve scores.

## Current First-Hand Implementation

| Source and pinned version | Verified mechanism | Scope adopted in this repository |
|---|---|---|
| [VERSE probes.py](https://github.com/wzekai/VERSE/blob/d8ff0adab0cf82e13d7878f84ff84f823cb2f6c9/verse/evolution/probes.py) | Provides replay, ablate, substitute, fix_probe; experiments have count and time budgets, evidence is bound to specific modifications; reproducing a trajectory is not itself proof of cause | Borrows executable experiments, independent budgets, and content identity. This time did not copy task replay, scorer access, or its refutation gate |
| [AutoSaddler causal diagnosis](https://github.com/microsoft/AutoSaddler/blob/e841543ce6cf6bdf690e65134b12a829ec9f66d1/src/autosaddler/v2/prompting/methodology/skills/causal-diagnosis/SKILL.md) | Locates causes from visible inputs, the first divergence, and the implementation path, and explains how to test interventions before evaluation | Connects mechanism hypotheses with actual tool/service observations, preserving attribution uncertainty; does not pre-write successful mutations or fix on modifying only one plugin |
| [DSH tools current documentation](https://github.com/deepseek-ai/deepseek-harness/blob/22ddee3792402c3e70ec5f86a63c3e3e895a2f60/packages/core/tools/README.md) | The current interface supports complete raw call batches; programmatic calls without model-step logs can still have Agent scope | **The installed version is `0.2.1-rc.4`**, and the actual declaration uses a single `ToolExecutionInput`. Pass `callId/name/arguments/agent/signal` according to the installed implementation, and do not copy the latest batch interface |

Context7 was queried on 2026-10-28 for `/deepseek-ai/deepseek-harness`, followed by verification of the installed package `@deepseek-ai/dsh-tools`, the Cordis 4.0.5 declaration, and the code. Cordis dynamic service reads use `ctx.get(name)`; property access without inject actually errored in native acceptance, and the test usage has been corrected.

The X search covered 2026-09-01 to 2026-10-28, with keywords AutoSaddler, Verified Self-Evolving, and wzekai/VERSE. [Python Hub's AutoSaddler introduction](https://x.com/PythonHub/status/2097931902594265474) had about 90 likes, 12 reposts, and 10,000 views at search time, indicating community attention; [Sungho Park's follow-up direction](https://x.com/sunghopark20124/status/2107493614364631136) proposes adjusting improvement goals as capabilities change. Both serve only as practical leads; popularity is not used as evidence of mechanism effectiveness or of this repository's gains; the current task set continues to follow the pre-registered contract.

## Implementation Choices

Independent native behavioral experiments connect "diagnosis → mutation": the optimizer writes JS tests itself, actually loads the draft build package, native Profile, and environment, and observes services and the real tool pipeline. Experiment control reuses the existing single-write lease, build, Docker isolation, persistent events, and continuation in the original container, without adding a second Agent Loop. The experiment API does not provide task rerun or scorer entry points.

Division of labor with native assembly QA: QA verifies whether a frozen candidate can be assembled, while behavioral probes test specific mechanism hypotheses actively proposed by the optimizer. No automatic modifications, exception swallowing, or score gates were added to improve test pass rates.

## Acceptance Records

- Unit tests cover snapshot identity, budgets, duplicate rejection, continuation in the original container, interruption between preparing the snapshot and database registration, and failures not affecting candidates/scores.
- Native SDK checks cover actual service reads, tool error results, and assertion failures; real containers check service→tool composition, parameter validation, wrong-algorithm counterexamples, missing services, mounts, and credential boundaries.
- The first container command mistakenly used the Docker config digest, and the daemon explicitly reported that the image did not exist; evidence for the corresponding system temporary directory in `/tmp/he-native-probes-gK5WBZ` was preserved, and the run was retried using the image ID actually returned by `docker image inspect`. This error did not start a model task.
- The first round of real-model acceptance is preserved in `he-live-probes-2iMUFS`: the model proposed distance symmetry on its own and observed `3/-3` through native calls; the test mistakenly used the author-side directory, and the file-write ENOENT occurred before the assertion, so acceptance failed. The original optimizer conclusion states this limitation and does not describe the assertion as having been executed.
- Therefore the generic interface was updated: clarify the author/execution directory mapping and pass the actual `workspace` to the test. After the modification, a separate run identity verification was established, without overwriting the original failure record or merging it into the research score.

The modified real-model acceptance `he-live-probes-hUD8Bp` passed: the model independently derived distance non-negativity, observed `d(3,2)=-1` through native tools, triggered the assertion with the expected `1`, and read the raw evidence. The Probe was correctly recorded as failed, and the protocol integration acceptance passed; there was no candidate submission, task execution, or research score. Both raw runs have been archived locally in `.evolution/behavioral-probes-20261028`.

| Acceptance | Result and usage |
|---|---|
| First real model / path error | Failed; 10 started / 10 result; input 20,477, output 2,416 tokens |
| Real model after interface improvement | Passed; 11 started / 11 result; input 21,839, output 2,497 tokens; native assertion counterexample fully preserved |
| Final regression | 36 unit tests, 8 native tests, 7 runc container tests, and one clean distribution install test all passed |
| Independent review | The sub-agent identified an interruption window between snapshot completion and database registration; added persist-intent-first and snapshot identity recovery, 3 targeted tests passed, and the final review had no must-fix items |

The unit of invocation is the DSH adapter stream attempt; HTTP retries inside the gateway are not observable. Neither run had unfinished/missing usage; cost is unknown. Machine evidence is in [2026-10-28-behavioral-probes.json](../evidence/2026-10-28-behavioral-probes.json). The full project's independent gains, joint topology mutations, and remaining isolation goals remain in [completion.md](../completion.md).
