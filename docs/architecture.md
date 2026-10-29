# Native Plugin Self-Evolution Architecture

**Evolve the Harness, Not the Model.** The core idea and the complete research overview are preserved in [`11.md`](../11.md). This document defines the responsibility boundaries of the code, the runtime protocol, and the validation method.

```text
Researcher: task goals / fixed model and environment / full task set / independent scoring / budget
                            │ ExperimentSpec + content hash
                            ▼
┌────────────────────── Protected experiment controller ───────────────────────┐
│ SQLite WAL · single-writer lease · candidate lineage · full denominator · strict selection · event log │
│                                                               │
│  Local HTTP capability API                                     │
│       ▲ status / evidence      │ branch / submit               │
│       │                        ▼                              │
│  ┌────┴──── Native DSH optimizer ───────────┐                        │
│  │ Native Agent Loop, model, coding tools     │                        │
│  │ Attribution → verification → mechanism selection → modify Bundle│                        │
│  │ Configuration × plugin implementation × assembly structure         │                        │
│  └──────────────┬─────────────────────┘                        │
│                 ▼                                             │
│  Draft → source freeze → build artifact freeze → QA → full tasks × repetitions  │
│                                  │                            │
│                    ┌─────────────┼────────────┐               │
│                    ▼             ▼            ▼               │
│              DSH container 1     DSH container 2   … DSH container N          │
│              Frozen candidate + respective inputs / workspace / Session / call ledger  │
│                    └─────────────┬────────────┘               │
│                                  ▼                            │
│                Freeze actual delivery → independent network-disabled scoring container                 │
│                                  │                            │
│               Complete results → strict improvement promotes / no improvement retains negative result        │
│                                  └──────────→ new evidence sent back to optimizer │
└───────────────────────────────────────────────────────────────┘
                            │ Explicitly select frozen candidate
                            ▼
Independent validation experiment (no optimizer API) → research verdict → Bundle + research archive
```

## Interfaces and Immutable Identity

| Content | Authoritative implementation | Constraints |
|---|---|---|
| Experiment contract | `contracts.ts` | Strict schema; unknown fields raise errors; goals, model, image, tasks, hashes, failure scores and budget explicitly defined |
| Candidate | `artifacts.ts` / `controller.ts` | SHA-256 composed of source file contents, relative paths and executable bits; symlinks forbidden; read-only mount after freezing |
| Build | `build.ts` / `runtime/build.ts` | lock, build image, original container and package identity traceable; QA, execution, re-verification and export reuse the same artifact |
| Run | `store.ts` | experiment + spec + candidate + task + repetition + attempt; one task does not mix multiple attempts |
| Control service | `api.ts` / `plugin.ts` | Native tools provide status, branching, submission and authorization evidence; scoring-private content is not exposed via API |
| Runtime foundation | `runtime/worker.ts` | Directly uses the official SDK / Agent Loop; environment overrides, candidate overrides and observation plugins assembled in order |
| Selection | `store.ts` | Verdict only when all tasks are terminal; failures counted per spec; ties rejected; champion update and event in the same transaction |
| Delivery | `export.ts` | Copies the tested tarball, independent source and artifact snapshots, and the complete local research archive; no automatic public release |

The framework does not write mutation, recomputation or answer logic per task ID. The six categories of mutation actions are a description space; the concrete implementation is decided by the optimizer in combination with feedback. Candidate submissions must carry the parent version, evidence, hypothesis and expected changes; these declarations are not treated as proof of correctness.

## State and Recovery

```text
candidate: frozen → Build → QA → running → champion / rejected
                      │     └→ qa_failed
                      └→ build_failed

run: queued → executing → delivered → scoring → scored
       │          └→ execution_failed    └→ scoring_failed
       └→ cancelled                            │
                                     explicit rescore, same frozen delivery
```

- The controller writes the execution intent and then creates a uniquely named container. On recovery it verifies created/running/exited; a lost container fails explicitly and is not implicitly re-executed.
- Controller exit is not mistaken for task exit; restart continues collecting the original container. Completed tasks are not re-run.
- After the failure budget is exceeded, tasks not yet started are not launched, and started tasks are collected to a terminal state; cancelled tasks count toward the full denominator. This implementation has no automatic whole-round retry.
- Scoring exceptions preserve the original delivery and scoring report. `rescore` only adds a gradeAttempt and does not change the execution attempt.
- The champion decision is stored in SQLite before the JSON report is generated; reports after an interruption can be rebuilt from events.
- Each optimizer session has a persistent launch intent and a unique container identity. Restart first collects the original session; when it completes normally and the budget is not exhausted, the next session is opened, receiving the previous session's read-only trajectory, persistent drafts and latest experiment results. Service failures are surfaced directly; failed sessions are not implicitly retried.
- `evolve` manages the control API, candidate scheduling and the optimizer together; `evolution_finish` records the search conclusion after candidate collection completes. The total time budget accumulates across sessions. An interrupted host command preserves the original container for recovery collection.
- The control service's first bind address is persisted, and recovery uses the original port; configuration changes or port occupation are surfaced directly. To explicitly end an experiment use `cancel`; for parent-level method studies use `study-cancel` to reclaim all descendants registered in the ledger. The cancel command must acquire the lease and cannot take over in parallel with an active host.
- SIGINT/SIGTERM on the paired `validate` only interrupts the observer; the signal is passed to the current arm, and subsequent arms are not started; the original task is preserved for recovery. When deciding to end, wait for the observer to exit, then execute `cancel-validation --root <study-directory>` to reclaim arm by arm per the frozen registration; the cancel ledger closes subsequent admission, and `validation-cancellation.json` preserves the full denominator and unstarted arms.
- Reservations and unrecorded snapshots left by an interrupted freeze require investigation and explicit handling; they are not guessed-deleted or skipped past integrity checks.

## Experiments and Research Conclusions

`search` provides approved development feedback to the optimizer. Each `validation` experiment accepts only one frozen candidate, does not start the optimizer, and does not expose the feedback API. `validate` registers all comparison groups before execution, creating independent experiments with the same contract, tasks and repetition count; it aggregates the complete paired results. Independent re-verification uses a new directory and pre-registered tasks; validation results must not be copied back into the search and then still called unseen data.

The repetition count is fixed before starting. The report preserves per-task scores, failures, paired differences against the initial baseline, calls and elapsed time. Strict improvement only produces a **search champion**; statistical stability, transfer and novelty still require pre-registered independent research validation. This repository does not package an improvement on a single synthetic task as a commercial Excel benchmark conclusion.

## Observation and Cost

The observation plugin records the complete requests, tool schemas, UUIDs, end states and usage of the native `llm/stream`; Session notifications and deliveries are archived separately. The optimizer and executor are accounted separately. Missing usage, incomplete calls and unknown costs are presented explicitly.

The same native context provider updates the elapsed execution time and contract budget with model requests, without prescribing optimization strategy or adding review steps. After the container exits, the host aggregates the call ledger from persistent events; even if a forced termination prevents the worker's `finally` from executing, recorded calls are not dropped or written as zero.

The unit is the DSH adapter stream attempt; HTTP retries internal to the vendor SDK or gateway may be invisible. There is no fabricated exact HTTP count here. If an external tool service needs independent costs, its domain plugin should provide a verifiable ledger; the general framework does not write unknown costs as zero.

## Domain Integration and Current Validation Scope

The input directory and scoring image form the task adaptation protocol: `/input` and `/delivery` are read-only, `/evaluation` is visible only to the scorer, and `/workspace/result.json` outputs a unified Grade. The scoring program may reuse a legitimately approved official Evaluator and cannot be modified by the optimizer.

`examples/spreadsheet` provides real XLSX, native read/write tools, independent LibreOffice recomputation and public synthetic business acceptance. It is used for installation and closed-loop testing; it has not migrated in historical private task sets, official answers, Jev code or the old controller.

## The Optimizer and Artifacts Are Also Managed as Plugins

`optimizerHarness` explicitly distinguishes `source` from `artifact`: the former freezes source and then performs a locked build, while the latter imports verified source and the actual build artifact; both uniformly form `PreparedOptimizer`, and the run only loads the `composition` native plugin manifest inside the frozen artifact. The Evolution Preset assembles the evolution tools and this manifest into the session scope; the optimizer uses the native SDK coding foundation and Agent Loop, and on recovery reads the Preset recorded in the Session. For complete installation and mechanism see [Evolution Preset](presets.md).

[Optimizer Study](optimizer-studies.md) has integrated independent G/H versions, same-start same-budget-cap search, development method selection and closed final validation. The meta-optimizer autonomously submits G through native DSH tools; the host coordinator reuses the existing build, Controller and fixed-artifact validation protocol. The full chain with real models is under acceptance, and a single H improvement cannot prove that G's own evolution is effective. [Research basis](research/2026-10-28-optimizer-self-evolution.md) records the ecosystem sources and experimental boundaries.

The `probes` contract authorizes independent behavior experiments: the optimizer writes tests, freezes the draft and tests, and after native assembly actually calls the services and tools. Execution is network-disabled, has no model credentials, and mounts no tasks or evaluation materials; results are returned as raw evidence and produce no scores, automatic fixes or submission gates. Preparation intents, snapshots and the original container are recoverable; for the complete protocol see [Behavior Experiment Bench](behavioral-probes.md). New experiments must explicitly declare this field; old frozen contracts and historical data are not rewritten.

State snapshots carry a persistent event cursor; `evolution_wait` returns when a submission event arrives, and the native tool loop wakes the model. The controller and host connector wait on the same log when idle, and on recovery re-read events and collect the original container without creating a new attempt. [Event and Recovery Protocol](events.md) specifies pagination, cancellation, reconnection and deployment addresses.

`evolution_materialize` publishes authorized files byte-for-byte to the optimizer's read-only `/evidence`, with source references, byte counts and digests, sparing the model from transcribing base64. Shared descriptor reads cover evidence, directory listings and frozen copies; temporary files before publication do not enter the mount. [Evidence Reading and Permissions](evidence-access.md) explains authorization types, directory mapping and acceptance boundaries.

The exported archive contains the installable npm package, frozen source, complete ancestor lineage, research contract, per-task results, events, optimizer ledger and evidence file hashes. The archive reflects the evidence archived at export time; when an in-progress optimizer session has no end receipt or aggregated usage yet, null is retained, and final research distribution should be exported after the search completes. Raw model requests, data and scoring-private materials do not automatically enter the distribution package. Check model-written hypotheses and plugin source before public distribution.

`researchLibrary` freezes a readable asset catalog and digests into the contract. Three native library tools respectively search, view and import, and the API accepts only archive IDs and restricted source paths. Import uses a persistent intent and private staging, and can resume after interruption; the source is retained as the new candidate's `origin`, and historical scores are not copied to the current candidate or champion. [Research Asset Protocol](research-assets.md)

`remember` saves terminal candidates to the local research library, `library` searches by explicit text conditions, and `import` imports the selected version into the current experiment draft. Archive identity is determined jointly by experiment, contract and candidate; the results of the same code in different experiments are stored separately. Import preserves the source, does not import scores, and does not bypass the new experiment's QA and scoring.

Cross-task transfer and stable gains must be supported by independent experiments. Integrating untrusted malicious plugins and multi-tenant deployment require independent engineering work; for the exact boundaries see [SECURITY.md](../SECURITY.md).
