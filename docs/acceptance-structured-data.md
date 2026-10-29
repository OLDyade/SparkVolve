# Second-Domain Real Acceptance: Structured Events and Logs

Before startup, the [registration record](experiments/2026-10-28-structured-data.json) was frozen at [`b15be37`](https://github.com/OLDyade/SparkVolve/commit/b15be37). The experiment reused the existing Controller, DSH optimizer, build, native QA, scoring, and export; no core code was modified and no Excel dependency was installed. The fixed model was `deepseek/deepseek-v4.1-flash-1017`, DSH `0.2.1-rc.4`, one run per each of the three tasks, with a budget of two candidates including the baseline.

## Actual Results

| Version | Native QA | Scored / Full denominator | Mean | Verdict |
|---|---|---:|---:|---|
| Baseline `564c1e7c` | Pass | 3 / 3 | 100% | Retained |
| Variant `52bd300f` | Pass | 2 / 3; 1 execution failure | 66.67% | Rejected |

The variant's version-event and dependency-association tasks both scored 100%; the log task reached the **300-second execution limit** when the second adapter request did not return. The container exited 137, `OOMKilled=false`. The failure was counted in the full denominator per the contract, with no replacement tasks, re-sampling, or evaluation changes; this cannot prove that the candidate reduced business accuracy by 33.33 percentage points, nor can it determine the upstream reason the model request did not finish.

| Call ledger | started / result / unfinished | Reported input / output tokens |
|---|---:|---:|
| Baseline executor | 11 / 11 / 0 | 13,160 / 1,884 |
| Variant executor | 9 / 8 / 1 | 11,331 / 1,412 |
| Optimizer | 49 / 49 / 0 | 124,000 / 13,576 |
| Total | 69 / 68 / 1 | 148,491 / 16,872 |

Usage comes from the persistent adapter stream ledger; the final usage of the unfinished request is unknown, the totals are the reported portion, and the actual billed cost is unknown. The optimizer used 537.097 seconds in one session and terminated voluntarily; the baseline and variant task execution times totaled 24.524 and 316.819 seconds respectively. Time and cost are reported only, with no separate promotion threshold. Complete per-task data, original model conclusions, container state, and installation identity are in the [machine evidence](evidence/2026-10-28-structured-data.json).

## Mutation and Independent Review

The optimizer autonomously added `data_group_aggregate`, `data_dedup`, and the internal `aggregate.mjs`, and modified the build and packaging file lists. The two `cordis.patch.yml` hashes are completely identical, and only `index.mjs` is still loaded: this is an added tool and implementation mutation, and **no Cordis plugin topology mutation occurred**.

An independent subagent and the main thread each directly invoked the frozen tools to reproduce three issues; the original candidate was not modified, and these counterexamples were not mixed into the official scores:

| Tool claim | Counterexample | Actual behavior |
|---|---|---|
| Select max order_by by identity | Same id, revisions 1, 2 in sequence | Deduplicates by identity first, incorrectly retaining 1 |
| Two-digit half-up rounding | `-10.125`, `10.075` | Outputs `-10.12`, `10.07`; should be `-10.13`, `10.08` |
| digits can be omitted | Do not pass `options.digits` | Throws before the default value takes effect |

In the original sample the maximum revision happened to appear first, and the log mean required no decimal rounding, so these boundaries could not be exposed; the completed variant tasks also computed via native bash/Python and did not call the newly added deduplication tool. Correct delivery cannot be credited to the new algorithm, nor can the two passed tasks be treated as proof of general algorithm correctness.

The optimizer's original conclusion speculated that "the extra tool triggered more exploration, causing the timeout," but the failure trajectory contains only one completed request and one unfinished request, lacking evidence to support sustained exploration. The original conclusion is preserved in full, with corrections appended by the independent review. The new candidate remains retained as a negative result and is not distributed as a reliable capability.

## Independent Capability Use After Export

The actually retained **baseline Bundle** was selected and installed via native `dsh plugin add` in two fresh, non-root containers with read-only root filesystems:

1. An ordinary new task was delivered correctly, but the model invoked native bash/Python. This record proves installation and task execution, not that the plugin tools were invoked.
2. A separate integration test with an explicit tool protocol used different data and required `data_read → data_write`. The real DeepSeek did invoke these two installed tools, output `queue=8、web=5、total_seconds=13`, the original input was preserved, the container exited 0, and the native final state was `completed`.

Neither task started the optimizer or scorer, and neither enters the research scores. The four installed files are hash-for-hash equal to the original frozen build artifacts; only the required capability/venus configuration directories were mounted, with no private evaluation materials or Docker socket. Execution entry points are in the [structured data guide](structured-data.md) and the [general capability installation procedure](use-capability.md).

This item completed the second domain's real integration, autonomous mutation, native QA, full-denominator adjudication, and installation invocation. The baseline on the public synthetic sample was already at full score, and this acceptance does not undertake to prove stable score improvement, unseen-domain transfer, or joint topology search; these remain separate research goals.

A final read-only subagent reviewed the original trajectory, frozen implementation, delivery, machine records, and the above document, and found no remaining must-fix items. `npm run check` passed; the original scores and model conclusions were not rewritten.
