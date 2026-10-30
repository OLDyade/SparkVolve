# SpreadsheetBench 2 · Mixed36 Pilot

[Protocol and fixed roster](../../benchmarks/spreadsheetbench2/README.md) · [Latest attempt evidence](../evidence/2026-10-30-community-pilot-study5-interruption.json) · [Earlier attempt evidence](../evidence/2026-10-30-community-pilot-interruption.json) · [Experiment index](README.md)

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

## Latest attempt: study5

Source commit: [d187a8f](https://github.com/OLDyade/SparkVolve/commit/d187a8f13aec0e83756900e3b62c61f20cb6e035). The same frozen panel and official model contract ran in a new directory after the account was replenished. No prior task results were imported.

| Arm | Scored | Execution failures | Cancelled | Registered H0 denominator | Mutations |
|---|---:|---:|---:|---:|---:|
| Prompt | 3 | 6 | 3 | 12 | 0 |
| Single plugin | 5 | 6 | 1 | 12 | 0 |
| Open plugins | 5 | 5 | 2 | 12 | 0 |

The seventeen task failures comprise seven HTTP 429 responses, nine HTTP 402 responses and one HTTP 502 response. All three G episodes then failed on their first request with HTTP 402. There are **zero mutations, zero independent assessments and zero installed test executions**. The thirteen task scores are partial H0 observations, with no basis for ranking mutation methods.

The durable request ledger contains **1,305 starts / 1,285 results / 20 failures / 0 unfinished attempts**. Reconstructing accounting from those original events gives:

| Reported token category | Tokens |
|---|---:|
| Uncached input | 2,506,809 |
| Cache read | 159,393,920 |
| Cache write | 0 |
| Output | 562,945 |
| Total | 162,463,674 |

All 1,285 successful requests reported these categories; twenty failures did not report usage. These are partial provider-reported tokens, not a monetary invoice. The run's original report omitted cache categories; the new evidence file identifies the reconstruction source hashes and preserves the original report hash. No original results were rewritten.

Two intervening attempts also remain preserved: study3 failed during a package download before inference; study4 lost its controller lease during macOS clamshell sleep. The download now uses a 600-second timeout, and interrupted startup reclaims its descendants. Neither attempt contributes task results to study5. All study5 containers were removed after termination.

## Earlier attempt: study2

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

## Corrections after study5

- **Stored formula support.** H0 inspection raised `Unsupported workbook value type: ArrayFormula` on an original development workbook. The seed now represents openpyxl's array and data-table formula objects explicitly: stored text, range, input references and flags. Native QA verifies exact inspection, preservation through unrelated edits, and recalculated array results. A read-only regression over the affected original input serialized all fourteen sheets, including 1,932 scalar formulas and one array anchor, without changing its bytes. This is a manually corrected H0 capability, not an autonomous evolution result. [openpyxl formula definitions](https://openpyxl.readthedocs.io/en/stable/_modules/openpyxl/worksheet/formula.html)
- **Complete usage categories.** DSH `0.2.1-rc.4` defines `inputTokens` as uncached input and reports cache reads/writes separately in `dsh-llm/lib/types/types.d.ts`. Accounting now preserves each optional field and its reporting coverage; missing data remains unknown. Native telemetry tests exercise the adapter-event-to-report path.
- **Truthful terminal status.** A settled study may contain only failed searches. The coordinator now reports actual assessment completions, failed jobs and cancellations instead of claiming independent validation completed. Recovery tests verify that terminal jobs are not relaunched. The historical study5 state remains unchanged; its old completion wording must not be interpreted as successful assessment.

The official provider documents [HTTP 402 as insufficient balance](https://api-docs.deepseek.com/quick_start/error_codes/) and exposes account availability through its [balance endpoint](https://api-docs.deepseek.com/api/get-user-balance/). Account quota remains the current real-run blocker.

## Completion boundary

The account needs usable quota before another real study can start. This interrupted attempt remains immutable. A subsequent run must use a new registered directory, retain the same score-blind panel, and never import these partial task results.

Independent validation, multi-generation inheritance, autonomous community-plugin adoption and original-package reuse on this panel remain unverified. Historical synthetic closures remain engineering regression evidence and are archived separately.
