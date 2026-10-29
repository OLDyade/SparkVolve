# Independent Paired Re-validation of the Joint Mutation Candidate

All 24/24 tasks received independent scoring, with zero execution failures. The fixed baseline mean is **93.75%**, the pre-selected joint mutation candidate is **77.0833%**, a difference of **−16.6667 pp**; this round does not accept the candidate and does not resample.

[Pre-run registration](2026-10-28-joint-independent-validation.json) · [Per-sample scores, call ledger, and native counterexamples](../evidence/2026-10-28-joint-independent-validation.json)

## Fixed Comparison

The prior search had already selected `4a60fb2b…`: the optimizer autonomously added a recalculation plugin, modified the original tool, and changed the native patch. This round copies its frozen source code and built artifacts verbatim and compares them against the original baseline `686ad0b0…`; both groups use the same current runtime image, model configuration, and controlled egress. The candidate was not rebuilt, the optimizer was not run, and no old scores were mixed in.

Each group has a fixed set of four public synthetic tasks, three runs per task. This public validation split and task family have been used in development before; this round is an independent execution re-validation and **is not an unseen holdout set or the official SpreadsheetBench**. The baseline was run first, then the candidate; time-of-day and upstream model changes may still introduce confounding.

| Task | Baseline three scores | Candidate three scores | Mean difference |
|---|---|---|---:|
| normalization | 25%、100%、100% | 0%、0%、25% | −66.6667 pp |
| weighted-portfolio | 100%、100%、100% | 100%、100%、100% | 0 pp |
| debt-rollforward | 100%、100%、100% | 100%、100%、100% | 0 pp |
| scenario-valuation | 100%、100%、100% | 100%、100%、100% | 0 pp |

| Call accounting | Baseline | Candidate |
|---|---:|---:|
| started / result | 96 / 96 | 86 / 86 |
| failed / unfinished | 0 / 0 | 0 / 0 |
| Input / output tokens | 95,055 / 20,485 | 91,622 / 19,068 |
| Sum of request durations | 191.978 s | 176.503 s |

The ledger covers all 24 samples, with no missing usage. Counts are DSH adapter stream counts; provider-internal retries cannot be inferred from them; the sum of request durations is not wall-clock time. There is no reliable unit price, so cost is not estimated. Repeated samples share tasks; the paired standard deviation is a descriptive statistic and does not serve as a confidence interval.

## Actual Defects Beyond the Scores

A separate network-disabled, credential-free, native DSH acceptance test was performed on the same frozen artifact. Using brand-new synthetic workbooks, it actually invoked `workbook_inspect` and `workbook_recalculate`, the latter actually recalculating through LibreOffice:

| Independent counterexample | Actual observation | Verdict |
|---|---|---|
| `=SUM(A1:B1)` and right-shifted `=SUM(B1:C1)` | uniform=false | The implementation drops the range operand and misjudges the relative-reference pattern |
| Two adjacent cells both `=SUM($A$1:$B$1)` | uniform=false | The absolute range is likewise dropped, misjudging the identical pattern |
| `="#tag"` | Actually caches `#tag`, tool reports error | Plain text is misclassified as a formula error based on its first character |
| `=1/0` | Actually caches `#DIV/0!`, tool reports error | This item is correct |

The source files are kept verbatim; the final assertion failed, and the original logs, source code, actual observations, and hashes are all preserved. The original candidate was not modified, the report was not overwritten, and expectations were not adjusted. These counterexamples demonstrate tool semantic defects; **they do not prove that they caused all of this round's score decline**. The domain QA frozen in advance for this round covers the explicit write contract and does not cover the above newly added read-only tool semantics; a high score alone also cannot certify newly added capabilities.

Research conclusion: cross-plugin autonomous mutation has occurred, and this round's independent execution did not preserve the development gains. Subsequent searches should use this real negative feedback to propose new candidates and conduct observable mechanism experiments on newly introduced capabilities; this candidate must not be run repeatedly as-is until a high score appears.
