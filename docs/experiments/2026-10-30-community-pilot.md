# SpreadsheetBench 2 · Mixed36 Pilot

[Protocol and fixed roster](../../benchmarks/spreadsheetbench2/README.md) · [Machine evidence](../evidence/2026-10-30-community-pilot-interruption.json) · [Experiment index](README.md)

**Status: the real three-arm run reached H0 evaluation, then stopped on provider quota faults. No method comparison or multi-generation quality claim is available.**

## Registered experiment

| Split | Debugging | Financial_Model | Template | Total |
|---|---:|---:|---:|---:|
| Development | 6 | 4 | 2 | 12 |
| Validation | 4 | 4 | 2 | 10 |
| Test | 6 | 4 | 4 | 14 |

Visualization is excluded. Whole workbook families stay in one partition; task IDs and input hashes were frozen before inference. A four-task screen is contained in development. H0 runs all twelve tasks, while later candidates below H0 on the fixed screen stop without scoring the remaining eight.

Prompt, single-plugin and open-plugin searches share the same H0, G, official DeepSeek model, inputs and four-candidate budget. Parent selection is unrestricted within each authorized lineage. Discovery, reuse, adaptation, authoring and composition remain choices for G. No action quota or scripted mutation sequence is imposed.

Validation chooses among each frozen selection and H0. The selected original archive and H0 then install into clean native Profiles for the fourteen test tasks. Test outcomes never reselect a package. This delivery stage has not run for the interrupted pilot.

## Actual run

Source commit: [e1d6c70](https://github.com/OLDyade/SparkVolve/commit/e1d6c703285b90e0c15a4fa85171c95bec29f889). Model: official DeepSeek `deepseek-flash`, thinking off, 32,768 output tokens, **600 seconds per task**. DSH: `0.2.1-rc.4`.

| Arm | Scored | Execution failures | Cancelled by failure budget | Registered H0 denominator | Mutations |
|---|---:|---:|---:|---:|---:|
| Prompt | 1 | 6 | 5 | 12 | 0 |
| Single plugin | 2 | 5 | 5 | 12 | 0 |
| Open plugins | 1 | 6 | 5 | 12 | 0 |

Of the seventeen execution faults, twelve were HTTP 429 messages explicitly tying the concurrency limit to remaining account balance, four were HTTP 402 `Insufficient Balance`, and one was a transport failure. All three subsequent optimizer episodes failed on their first request with HTTP 402.

The four completed tasks retain their official scores in the machine record. They do not form a complete H0 baseline. The original failure-inclusive denominators and rejected decisions remain; their differences cannot rank mutation methods.

DSH adapter accounting: **477 started / 457 results / 20 failed / 0 unfinished**, with 1,420,172 reported input tokens and 196,514 reported output tokens. Twenty failed requests have missing token usage. Reported totals are partial; provider-internal HTTP attempts and monetary charges are not inferred.

## Engineering verification

Before inference, the following checks passed:

- Official dataset/archive and evaluator hashes; family separation and exact task registration.
- Unchanged official evaluation on delivered workbooks from all three included categories, plus an explicit missing-delivery case.
- Native H0 read, write, recalculation, source preservation and invalid-edit behavior.
- Runtime image byte identity and non-root configuration access.

A previous preparation failed before any inference because Docker copied owner-only package configuration. The image now assigns explicit read permissions and the launcher verifies access as its actual execution user.

The cloud runc check also exposed an IPAM race: an address reservation can exist before Docker publishes the winning network. The allocator now treats the daemon's explicit overlap response as authoritative and excludes that subnet for the current bounded allocation. The original error is not retried as a model task. Regression coverage includes an unpublished-reservation simulation, eight independent real allocators contending for one pool, and exact finite-pool exhaustion. Upstream source confirms that [IPAM allocation precedes network publication](https://github.com/moby/moby/blob/f37bdcea9a9e4c0120190f95ecd4fc281695b0f3/daemon/libnetwork/controller.go#L617-L699).

Startup result collection now matches the frozen arm identity instead of a display label. Screened-out tasks retain null scores and are excluded from expected usage ledgers because they were never launched.

## Completion boundary

The account needs usable quota before another real study can start. This interrupted attempt remains immutable. A subsequent run must use a new registered directory, retain the same score-blind panel, and never import these partial task results.

Independent validation, multi-generation inheritance, autonomous community-plugin adoption and original-package reuse on this panel remain unverified. Historical synthetic closures remain engineering regression evidence and are archived separately.
