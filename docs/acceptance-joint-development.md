# Native Autonomous Mutation: Development-Set Experiment and Independent Review

The preregistration [`a486ce5`](https://github.com/OLDyade/SparkVolve/commit/a486ce5606144ecf8f928d66f143fe20e24328cf) froze the [contract](experiments/2026-10-27-joint-plugin-development.json) before launch. Actual implementation `fcf76f2`, DSH `0.2.1-rc.4`; both optimizer and executor are `deepseek/deepseek-v4.1-flash-1017`, thinking off. This round used four public synthetic development tasks, two runs per task, a budget of four candidates including the baseline; the complete record is in [machine evidence](evidence/2026-10-28-joint-development.json).

## Results and Full Budget

| Candidate | Mean | Scored / Planned runs | Executor calls | Input / Output tokens | Total execution time |
|---|---:|---:|---:|---:|---:|
| Baseline `686ad0b0` | 65.625% | 8 / 8 | 73 | 78,663 / 17,320 | 166.437 seconds |
| Mutation 1 `1e0c73b6` | 68.750% | 8 / 8 | 66 | 68,907 / 14,081 | 159.377 seconds |
| Mutation 2 `744edd17` | No task score | 0 / 8; native QA failure | Not run | Not applicable | Not run |
| Mutation 3 `7b2857bf` | 81.250% | 8 / 8 | 80 | 86,537 / 16,421 | 185.357 seconds |

The optimizer additionally used **107 calls, 308,204 input / 45,722 output tokens**, with run budget accounting of **480.696 seconds**. The full experiment totaled **326 adapter calls, 542,311 input / 93,544 output tokens**, all returned, with no missing usage reported. Execution time is summed per task, includes concurrent overlap, and does not equal experiment wall-clock time; vendor-internal retries and actual billed amounts are unknown.

The QA failure consumed candidate budget; the original report is preserved in full: `parameters.values.additionalProperties must be explicitly true or false`. The native audit was not modified, no tasks were added, and no resampling was done; submissions were explicitly rejected after the budget was exhausted.

| Task | Baseline two runs | Mutation 1 two runs | Mutation 3 two runs |
|---|---|---|---|
| normalization | 0%、25% | 25%、25% | 25%、25% |
| weighted-portfolio | 100%、100% | 100%、100% | 100%、100% |
| debt-rollforward | 100%、100% | 100%、100% | 100%、100% |
| scenario-valuation | 0%、100% | 100%、0% | 100%、100% |

## Attribution Review

1. **There is single-plugin implementation mutation; joint topology mutation has not been observed.** The four frozen assembly patches are identical, always loading only `index.mjs`. The optimizer added computation, recomputation, and inspection tools and modified the implementation; configuration and composition topology did not change together. The experiment name expresses the research question and does not mean the question has been answered affirmatively.
2. **The optimizer's cache attribution does not hold.** The scorer independently recomputes with LibreOffice; the baseline normalization actual values `B10=171、B11=35.6` are all non-empty and wrong; scenario's `B9/B10` was never written. Seeing an empty cache when reading the deliverable cannot explain the scores after independent recomputation.
3. **The remaining errors need to be explained according to the actual formulas.** The final candidate's normalization `B10=B3+B4-B5` corrected the direction; `B11=B6-B4*B7+B5*B8` uses the tax rate of each adjustment item, but the reversal direction is wrong. The optimizer's conclusion narrative of "using the overall tax rate" does not match the deliverable.
4. **The automatic-scoring champion does not go directly into capability release.** The final candidate uses `YEAR_HEADERS` and a "first four rows" rule to automatically restore original values, which may overwrite explicit caller edits. No specific task ID or answer branch was found, but this heuristic auto-repair violates project guidelines. The scores, source code, and original conclusions are retained, with an independent correction attached; it is not distributed as an accepted capability Bundle for now.

A read-only subagent checked the actual inputs, frozen implementation, deliverables, and recomputation artifacts; the contract matches the preregistration, the scoring script was unchanged, and the run artifacts match the frozen source. The private `expected.json` was not read. The model's original conclusions are retained in the original `completion.json`, and the failure evidence was not rewritten.

This time **+15.625 percentage points** was observed on the fixed development set. These task families and related numeric variants were used during development, and there was no independent replication, so this cannot be used to claim stable gains, module causality, or cross-scenario transfer. The next study should address evidence misattribution and capability semantic overreach, while maintaining independent scoring and true failure records.

## Reusable Report Entry Point

```bash
node dist/cli.js report --root /path/to/experiment --output /path/to/new-report.json
```

This command only projects existing state and directly recomputes the persistent request ledger; it does not start models, rerun tasks, or modify the original evaluation. The report includes the full denominator for each candidate, per-task auxiliary metrics, failures, per-run usage, and optimizer cost information; a missing ledger is explicitly marked unknown, unknown prices retain `null`, and unscored candidates are not recorded as zero. If the output file already exists, it fails explicitly to avoid overwriting an old report.
