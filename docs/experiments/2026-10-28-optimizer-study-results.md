# Real-Model Meta-Optimization Experiment: Final State and Mechanism Review

This real-model experiment completed the closed loop of "meta-optimizer modifies the optimizer plugin → two optimization methods each search the Harness → independent evaluation → method selection → final validation". The G0 and G1 development evaluations were both **1.0**, and G0 was retained on a tie; G0's final validation was **1.0**. This round did not demonstrate that the optimization method brings a quality improvement.

The experiment status is `complete`; the original acceptance driver subsequently hit a report-handling exception, and the original `acceptance.json` retained `passed: false`. The subsequent independent installation acceptance has been completed: the original tarballs of G1, G0, and H0 all installed successfully and passed the DSH native assembly check, `inferenceRequested: false`. The installation proof does not change the mechanism review conclusion for G1, nor does it mean the method is recommended or quality-certified.

Machine evidence: [2026-10-28-optimizer-study.json](../evidence/2026-10-28-optimizer-study.json). This report preserves the failure evidence, does not modify the frozen candidates, does not run new models, and does not read sealed task content or private scoring answers.

## What Actually Ran

```text
Real-model meta-optimizer (DSH native Agent)
  │ Reads approved development evidence, forks G0, writes and freezes G1 plugin code
  ├── G0: systemPrompt plugin
  │     └── Independent development search: H0 → H1 → tie, retain H0 → independent development evaluation 1.0
  └── G1: systemPrompt + tools/fs dependency + observer + data_self_check
        └── Independent development search: H0 → H1 → tie, retain H0 → independent development evaluation 1.0
                            │
                     Methods tied, select G0
                            │
                 Registered final validation search and independent evaluation
                            │
                    1.0 / study complete
                            │
                 Original driver report read exception, acceptance failed
                            │
                 Standalone installation acceptance passed, model experiment not rerun
```

The executing model was Venus `deepseek/deepseek-v4.1-flash-1017`, `reasoningEffort: off`, `maxTokens: 32768`. The runtime image was `sha256:919839c0bf86ad018af4305b6a04af60ccb692ee341d3e2e1fcb53d1e6b6badc`. This metric is the `structured_output_accuracy` of a synthetic structured-data task and cannot be extrapolated to commercial Excel official Modif, Spark adaptation gains, or cross-domain gains.

| Level | Method | Full denominator | Mean | Failures | Conclusion |
|---|---|---:|---:|---:|---|
| Development method evaluation | G0 | 1 search instance / 1 repetition | 1.0 | 0 | Retained |
| Development method evaluation | G1 | 1 search instance / 1 repetition | 1.0 | 0 | Tie, G0 not replaced |
| Final independent validation | G0 | 1 search instance / 1 repetition | 1.0 | 0 | Validation completed |
| Final independent validation | G1 | Not executed | — | — | No final validation conclusion |

Each of the two development searches froze and evaluated H0 and one new H candidate; the new candidates were both 1.0 and did not exceed H0. The G1 development search also submitted two author probes, both of which failed. The author probe statuses and independent task scores are preserved separately.

## Evidence of Autonomous Mutation and Its Boundaries

The meta-optimizer actually changed G0's 25-line `index.mjs` into G1's 359-line implementation, adding `defineTool`, `tools` / `fs` injection, the `tools/result` observer, and the `data_self_check` tool. The frozen source, build identity, and native model requests all correspond; this supports the conclusion that "the model autonomously modified the optimizer plugin implementation and it was actually loaded".

`plugins.yml` is still the same `evolution-research-method → ./index.mjs` assembly entry point. The added dependencies and tool surface are real implementation changes; this round did not demonstrate a change in plugin composition topology. Method identity, source digest, and build digest are detailed in the machine evidence.

The following paths are all relative to the experiment root `.evolution/optimizer-study-live-contract-corrected-20261028/`:

- G0 source: `study/inputs/bundles/g0/source/`.
- G1 source: `study/methods/sources/e7ce41101edafc1147623fad26a7eb84c269d8eace5acc5c0a31a5abc2743570/`, hereinafter referred to as **G1 source**.
- Meta-optimizer trace: `study/meta-optimizer/0/trace/notifications.jsonl`, hereinafter referred to as **meta trace**.
- G1 development optimizer trace: `study/children/acdc3e93d1731e5a44dd685dc9e6a56029b6576bec5fe73dd4c337bb2baec191/optimizer/0/trace/`, hereinafter referred to as **G1 trace**.

### Final-State Tool Usage

In the G1 trace's `requests.jsonl:1`, the first real model request contains the `data_self_check` schema, proving it was registered and visible to the model. In the complete `notifications.jsonl`, counting by native `tool/call` events, **`data_self_check` calls were 0**; the tool name appearing in source, prompts, and Bash-embedded text does not count as a native call. The G1 development optimizer called tools 77 times in total and completed the submission and termination flow.

Therefore, this round has no execution evidence that "the tool discovered or prevented an error in a real search". Nor can the fact that no score improvement occurred be used to deny that the code mutation actually happened.

## Mechanism Review Findings

| Finding | Verifiable evidence | Impact and boundaries |
|---|---|---|
| G1 loads the meta-research role instructions into the sub-optimizer | G1 source `index.mjs:348–356`; G1 trace `requests.jsonl:1` | The prompt requires `optimizer_study_*`, but the actual sub-optimizer only has tools such as `evolution_*`. The sub-optimizer still completed the search using genuinely available tools; no shutdown due to this mismatch was observed. |
| Observer scope does not match the proposal | G1 source `index.mjs:112–131` | `ctx.on('tools/result')` listens to the current G Agent tool results; H runs in a separate task process, and the code has no bridge to read the H trace. It cannot be claimed that it captured "the raw content actually read by the inner Harness". |
| Read/write identification and caching cannot support the "exact original text" promise | G1 source `index.mjs:39,106–131,303–318` | The read matching rules miss native `read` but match `data_write`; the cache takes the rendered `result.content`. `pendingWrite` does not drive cache invalidation or re-reads. These are static mechanism defects; this round had no real self-check calls, so it cannot be falsely claimed that the corresponding business errors were triggered. |
| The proposal misdescribes the G0 evidence | G1 source `index.mjs:10–14`; meta trace `:547`; G0 development task `e987faad…/trace/notifications.jsonl:19` | G0 actually wrote `/workspace/result.json` via Bash/Python. The absence of a specific `data_write` tool event cannot be used to infer that no file write occurred. |
| Local errors are swallowed, and semantic fallback is unproven | G1 source `index.mjs:79–98,129–131,220–228,337–341` | Registration exceptions are only logged and then execution continues; observation exceptions are swallowed; after JSON parsing fails it falls back to line-by-line parsing and discards bad lines, and the subsequent recomputation does not include `badLines` in the failure check. This does not conform to the project's guideline of explicitly surfacing errors. In this round the tool registration actually succeeded. |

The scope determination also cross-checked the DSH tool implementation installed this time: `node_modules/@deepseek-ai/dsh-tools/lib/index.js:3511–3516` uses `scopeTarget(this, exec.agent)` to dispatch results; the project source reviewed at runtime, `src/preset.ts:15–27` and `src/optimizer.ts:113–119`, installs the method in the optimizer scope. These line numbers correspond to the implementation used by the aforementioned `919839c0…` runtime image and the source at that time; they do not represent the subsequent working-tree state and are not an API guarantee for future versions.

G1's `writeTo` is explicitly provided by the caller; the code contains no path that automatically generates task answers or automatically repairs workbooks. The tool check results and explicit writes do not constitute a mandatory save gate. The proposal claims "skip registration if tools are missing", but the code declares `tools` as a required dependency; the proposal text cannot be taken as the actual Cordis lifecycle.

### Difference Between Native Acceptance and Local Mock

The local smoke test in meta trace `:331` constructed fake `ctx`, `fs`, and a registrar, and manually emitted the `data_read` event. It supports that the local function interface is callable; it cannot prove real G/H cross-process observation or native filesystem behavior. The candidate build and load passing, and the model request indeed containing the tool schema, likewise did not verify the cross-layer mechanism claimed by the observer.

### Fork Tool Receipt Gap

In the frozen run, `optimizer_study_branch` in meta trace `:215–216` successfully returned empty text. The old source corresponding to that run's build, `src/optimizer-study.ts:375–447`, returned `Promise<void>`; the API's serialization of `undefined` produced an empty response, and the tool presented the empty text as-is. It did not return the exact draft path, parent identity, or target run role. This description is constrained by the frozen trace and the old build; the current working tree is separately fixing the receipt, and the old line numbers must not be treated as the current interface.

The same trace `:229–230` subsequently read `/workspace/g1-self-check/index.mjs`, whose content is the correct G0 sub-optimizer source; the fork implementation also verifies the parent source digest before copying. **No evidence of copying the wrong parent version was found.** The meta-optimizer had previously read the meta-research source of `/method` and then wrote the role-mismatched instructions; both the empty receipt and the model's subsequent behavior should be recorded, and it cannot be claimed that the empty receipt is the sole cause. Going forward, the interface should be completed via structured fork receipts and real-scope acceptance, while keeping this round's frozen evidence unchanged.

## Model Calls and Cost

| Level | started / result | Input Tokens | Output Tokens | Sum of request durations ms |
|---|---:|---:|---:|---:|
| Meta-optimizer | 112 / 112 | 151,182 | 29,294 | 322,597 |
| Three sub-searches combined (including the final validation search) | 203 / 203 | 343,802 | 61,974 | 584,039 |
| Three independent evaluations combined | 10 / 10 | 10,252 | 1,995 | 19,252 |
| **Total** | **325 / 325** | **505,236** | **93,263** | **925,888** |

The counting unit is **DSH adapter stream attempts**; provider-internal HTTP retries are not visible. The 13 ledgers are complete in aggregate, and `failed / unfinished / missingUsage` are all 0; this describes accounting closure, not certification that the method is correct. Request duration is the sum of stream durations and cannot serve as wall-clock elapsed time; cost is unknown, and build, QA, and scorer resources are not counted as model Tokens.

The review independently recomputed the 7 public ledgers of the meta-optimizer and the two development searches: 275 started / 275 result, 430,199 input / 78,867 output Tokens, 793,563 ms, with start and end IDs aligned. The remaining 50 were cross-checked against the final validation search and independent evaluation summaries in the authoritative report, without opening the original task or request materials from the sealed stage.

## Acceptance Status and Next Work

The authoritative experiment report's final-state time is `2026-10-27T20:44:38.352Z`. The original driver recorded a failure at `2026-10-27T20:44:39.108Z`: `Cannot read properties of undefined (reading 'phase')`, at original driver `scripts/verify-optimizer-study.mjs:558:31`, and the driver SHA-256 recorded in its receipt is `f1ca54d30799cf626f8e7cc2f43ab3dc87f84130e3d252fa13ee8cddccd6bc7c`. The controller command record overrode the report value in the driver; this is an acceptance orchestration fault after the experiment completed, and the line numbers correspond to that old driver.

The subsequent standalone acceptance `.evolution/optimizer-study-completed-verification-20261028/acceptance.json` also recorded `passed: false`; the installation stage `installation/g1/execution/stderr.log:5` explicitly reported `no adapter registered for provider "venus"`. That driver selected `sdk-minimal` and did not reuse the registered runtime environment, so it cannot be concluded from this that the frozen plugin package itself is faulty. Both failure receipts are preserved.

The post-processing `.evolution/optimizer-study-completed-verification-profile-corrected-20261028/acceptance.json` that corrects the profile was completed at `2026-10-27T20:50:32.731Z`, `passed: true`, with SHA-256 `57348efdf48f6255b184bc7fe498a2e700580aaa03bd2e10b7663c2f7b5cd8b8`. All three items G1, G0, and H0 are `installed: true`, `nativeComposition: true`, `inferenceRequested: false`; each tarball digest matches the original frozen artifact. This acceptance did not redo model inference, verify the tool's business effect, or overturn the result that G1 was not selected.

All three installations used the originally registered `sdk` profile. The execution record shows `/environment` read-only mounts of the registered environments: G1/G0 from the development search environment, and H0 from the final evaluation runtime environment. The review only checked the runtime configuration and mount identities and did not read the final evaluation task content. The SHA-256 of the five preserved files match the original experiment, including the original failure receipt, the authoritative report, the registration, and the research database.

The framework support package required for installation is accounted for separately: it comes from the first post-processing `optimizer-study-completed-verification-20261028/framework/package.tgz`, and its actual SHA-256 is `f6663fab04188d4a6f270d75288c4b19857b8619d90d367ab197a1b7570ace89`. It is used for this independent installation acceptance and must not be conflated with the identity of the framework package inside the original experiment image. G1/G0/H0 still use their respective original frozen tarballs; the original experiment results and call ledgers were not rewritten by the installation post-processing.

The conclusion that currently holds is: the closed loop of real autonomous code mutation and method comparison did occur, and the independent selection did not accept the tied mutation; this round's G1 mechanism has specific defects and no evidence of quality gain was obtained. Future research requires registered tasks with discriminative power and repeated experiments, while verifying that the added capabilities are actually invoked, their scope, and their original-byte provenance.

## Evidence Identity

All complete identities and SHA-256 values are in the accompanying JSON. The authoritative report SHA-256 is `d4c3c094266f2c09260a28002666236efb63a1c76f18c4e249562e579a4f653b`; the original failure receipt is `7f97d6e2f8bfe68f51b1ffe8b3cccfbe13cd20a00df0bc0416815abbe3431d77`. The report extracts only public source, development traces, and approved aggregate results, and does not disclose keys, full model prompts, sealed inputs, or scoring answers.
