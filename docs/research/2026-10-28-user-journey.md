# Cold Start and Read-Only Progress Observation of the Public Entry Point

## Findings and Changes

An independent checkout was created from `0a27c41e1df4916390a6e70eac83cce70973a6de`, and local Git objects were copied via `git clone --no-local`; the original workspace's `node_modules`, `dist`, and experiment directories were not carried over. This validates the dependency and build flow of a clean checkout, and does not claim to have tested GitHub network cloning or another person's account permissions.

The first `npm ci` succeeded, after which `npm run check` reported TS2307 at the native test type check: the `dist/*.js` referenced by the tests had not yet been built. The original workspace already had build artifacts, which masked this problem. The public `typecheck` now runs the actual build first, then checks test types; the independent checkout recheck passed.

File digests exist for the dependency installation, the corrected checks, and the Excel extension image build logs; the base image build succeeded in this terminal execution, but no complete log file was saved separately. The image identity has been registered, and the existing logs do not purport to be a complete archive of both image builds.

The read-only review additionally found that the parent directory of the first user's `.evolution` may not exist. The driver now only recursively creates the parent directory, and still uses a `mkdir` that must be brand new for the experiment root directory. A separate subprocess regression covers a missing parent directory, failure of the first external command, and refusal on a second run, with failure logs not being overwritten. This fix was not injected into an already-running experiment.

## Observation Does Not Require Taking Over the Experiment

`events` uses SQLite committed events and an experiment-specific cursor, and outputs NDJSON; `--follow` observes continuously, and `--cursor` resumes from the position already received. Like `status` and `report`, it uses the `readOnly` connection of `DatabaseSync`, does not create a database, does not modify metadata, and does not acquire an execution lease.

Per the `readOnly` semantics of the official Node 24 [`node:sqlite`](https://nodejs.org/docs/latest-v24.x/api/sqlite.html), a missing database raises an error; the project tests also actually verify that writes are rejected by SQLite. The native CLI tests cover 205 cross-page events, exact cursor replay, another process committing events, the experiment remaining usable after the observer exits, and rejection of a wrong experiment cursor.

In-process commits can directly wake waiters; an independent CLI connection re-reads after a wait of at most about 30 seconds. This is not disguised as cross-process instant push, nor is no-event or timeout treated as proof of health. The event summary obtained from reading the real experiment is retained in the machine evidence.

## One Real Public User Journey

The independent checkout uses the corrected check order and acceptance driver, and still runs the frozen original controller, original optimizer method, and original model contract. After the build completes, the driver only calls the public entry points: image precheck, generating public samples, contract generation, initialization, autonomous search, reporting, frozen artifact re-verification, and research archiving. It does not generate mutation code, does not intervene in model problem solving, and does not retry failed commands.

The selection rule registered before execution is: among distinct mutations with complete scores, take the one with the highest full-denominator mean, and for ties take the earliest sequence number; negative results may still enter independent research re-verification. If there is no qualifying terminal mutation, the negative branch is recorded as ended. The default three tasks are an engineering experience, and the full-score baseline has no room for main-metric improvement; no method benefit can be claimed on this basis.

The four-task re-verification comes from a synthetic validation family that has been publicly used before, with each group running each task once. This validates the independent protocol and the flow of the same frozen build, and cannot be treated as an unseen test set or a stable gain. After archiving, source and capability semantic review is still required before trusted Bundle installation; the driver does not automatically distribute unreviewed code.

The real journey completed 13 public commands, all with exit code 0. Both autonomous mutations tied the three-task full-score baseline and were rejected from promotion under the strict selection rule; the optimizer ended the search on its own. The pre-registered rule selected the earliest tied mutation to enter the four-task independent re-verification, 8/8 tasks completed, and both sides averaged 81.25%. The normalized task improved by 75 percentage points, the scenario valuation dropped by 75 percentage points, and the other two tasks tied; there was no overall quality gain.

| Stage | Model calls / complete returns | Input / output tokens | Sum of request durations |
|---|---:|---:|---:|
| Search, including the optimizer and nine tasks | 201 / 201 | 380,122 / 75,792 | 689,701 ms |
| Re-verification baseline four tasks | 32 / 32 | 30,066 / 6,286 | 60,563 ms |
| Re-verification candidate four tasks | 33 / 33 | 36,904 / 7,877 | 70,608 ms |

The unit is DSH adapter stream attempt; gateway-internal HTTP retries may not be visible; the sum of durations includes concurrent overlap and cannot be treated as wall-clock time, and cost was not obtained. The optimizer itself used 128 calls and 580.972 seconds of container budget time. All statistics retain the original reports and summaries.

The independent native review of the selected candidate also found: explicit replacement of an existing formula was rejected, a newly added worksheet leaked out of the diff report, and saving to the same path modifies the source file although the description promises to preserve the original input. Therefore only the research archive is retained, and trusted capability installation is not approved; review is not skipped to complete a positive demonstration, nor is the same-path save issue appended as a rejection obligation that does not exist in the old contract. The new-formula coverage fixture passes on the original frozen baseline and fails on this candidate, and existing experiments do not retroactively change their results.

[Machine evidence, source identity, and original receipts](../evidence/2026-10-28-user-journey.json) include the independent checkout registration, original package re-verification, pre-installation review, and the original failures from twice mistakenly mounting the artifact parent directory; after correcting the acceptance command, its real `bundle/` subdirectory was used to complete the positive and negative comparison. For operational entry points, see [Complete User Journey](../user-journey.md).

## Relationship to Complete Delivery

Cold start, observation, and traceable commands improve user operability; autonomous complex plugin refactoring, same-budget method comparison, stable quality gains, hard disk boundaries, and the cloud matrix are still accepted under independent completion conditions. The promotional positioning and the original text of `11.md` remain unchanged.
