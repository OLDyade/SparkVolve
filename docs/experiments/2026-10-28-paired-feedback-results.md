# Feedback comparison for the same optimizer: full results and mechanism counterexamples

**The real-model closed loop is complete; these results are insufficient to show that task feedback improved evolution quality.** Both groups completed autonomous code mutation, frozen builds, native assembly QA, independent evaluation, and full accounting. Candidate review found clear algorithmic defects and heuristic positioning; all scores and original packages are retained, and the search champion is not directly released as a general capability.

This page corresponds to the [pre-registration](2026-10-28-feedback-study-registration.md), run commit `cf32125f4dcffbaf652bd97b51db246970e6107a`. The study ran from 2026-10-27 21:33:49 to 21:47:09 UTC (Beijing time October 28, 05:33:49 to 05:47:09). The [raw receipt index](../evidence/paired-feedback-20261028/index.json) stores the per-file original-byte SHA-256; task inputs, private scoring materials, model prompts, and keys do not enter the public record.

## Design and actual execution

Same G, H0, model, tools, and budget; only the feedback the host exposes to G changes: Full can see authorized execution evidence and scores; Mechanical can see public inputs, source code, build, and native assembly results. Each group has two independent searches, each starting from H0 with at most two new candidates, all forked from H0. The two blocks are queued in AB/BA order, with concurrency within a block; the optimizer autonomously chooses the actual changes.

| Item | Actual result |
| --- | --- |
| Model | G/H both Venus `deepseek/deepseek-v4.1-flash-1017`, thinking off |
| Task | The four already-public synthetic Excel families; development search, validation independent evaluation |
| Search | All 4 completed; 8 autonomous mutations, 3 native QA failures |
| Actual task scoring | 36 search runs, 16 independent evaluations of selected H, 8 common H0 evaluations, 60 total, 0 execution failures |
| Pre-registered task cap | 72 runs; the 3 candidates that failed QA did not execute their 12 tasks, with no reruns and no rewriting as scored |
| Raw records | Failed candidates, tie rejections, original deliveries, and the full call ledger are retained; no resampling or mixed versions |

The statistical unit is one complete search, and each group has only **2**. The 8 evaluation items per group cannot be treated as 8 independent evolutions. The four task families were used previously; independent evaluation changes the numbers and does not represent unknown templates or cross-domain transfer.

## Independent results

| Feedback / search | Search H0 mean | Search selected mean | Selected version | Independent evaluation mean |
| --- | ---: | ---: | --- | ---: |
| Full / 0 | 56.25% | 56.25% | H0 `686ad0b0…` | 100% |
| Mechanical / 0 | 81.25% | 81.25% | Same H0 `686ad0b0…` | 81.25% |
| Full / 1 | 56.25% | 81.25% | `c159a72a…` | 81.25% |
| Mechanical / 1 | 75% | 100% | `9635872e…` | 81.25% |

Full's two searches average **90.625%**, Mechanical **81.25%**, a descriptive difference of **+9.375 percentage points**. But that difference comes entirely from the first paired block: both groups selected the same H0 source code and build artifact, yet obtained different scores in independent execution. The two new candidates in the second block have identical independent scores. Therefore, the between-group difference cannot be interpreted as a gain from plugin mutation or the feedback mechanism.

After the study, the 8 independent evaluations of the common H0 average **56.25%**. This also differs markedly from the two earlier evaluations of the same H0. All original scores are retained, with no selection of a favorable baseline; the [per-item paired record](../evidence/paired-feedback-20261028/comparison.json) gives the full correspondence. The current sample cannot separate model execution variance, time-of-day, and shared-resource effects, so no significance or stable-gain claims are made.

## What mutations actually occurred

| Path | Autonomous implementation | Actual calls and counterexamples |
| --- | --- | --- |
| Full / 0 | Added a LibreOffice-based recalculation observation tool | Both candidates failed to enter tasks because the DSH author Schema was invalid; the second fixed the wrong node, and the [native contract verification](../research/2026-10-28-native-tool-schema-findings.md) retains the error |
| Mechanical / 0 | Added a recalculation tool, extended read expressions | The first candidate wrote an optional field as `required:false`, rejected by QA; the second candidate, after fixing, tied on development score, and H0 was retained |
| Full / 1 | Row-number presentation, label/year addressing, explicit writes, recalculation; successors added model checks and tax-rate probing | The selected candidate's development set had recalc 5 times, write 2 times, inspect 4 times; label targets and show both 0 times. The improvement must not be attributed to label addressing that was never called |
| Mechanical / 1 | Rectangular formula translation and independent recalculation; successors extended multi-block build and finish | The selected candidate's development set had verify 3 times, build 0 times; a successor's perfect development score tie was rejected. The perfect score must not be attributed to a builder that was never called |

In this round these candidates' `cordis.patch.yml` all match H0, still assembling only `./index.mjs` and depending on the `tools` service. They demonstrate autonomous addition of tools and modification of implementations, **with no new evidence of cross-plugin composition topology changes**. Historical joint-mutation evidence is retained separately and cannot be transferred to this round.

After independent subagent review, the read-only source verification, development-trajectory statistics, and pure-function counterexamples are saved as the [diagnostic record](../evidence/paired-feedback-20261028/mechanism-diagnostic.json):

- `c159a72a…`'s label addressing takes the first item when there are multiple matches, and in some paths checks for ambiguity only after truncation; when there is no match below the anchor it falls back to above. This behavior is inconsistent with the "no guessing" claim.
- `9635872e…`'s self-written translator, when shifted one column right, changes `=A1!B2` to `=B1!C2` and `=SUM(A1_name)` to `=SUM(B1_name)`; lowercase `=a1` is not shifted, and `=XFD1` out of bounds produces `=XFE1`.
- The rejected `05787c51…` skips source-value comparison for delivered formulas. A pure-function counterexample replaces the source `A1=17` with `=1` and still returns success for preserving the original value; another path calls an undefined function. The tax-rate tool also introduces a business guess matching numeric ranges and ratios, which was never actually called.

The counterexamples were executed via limited pure functions extracted from the host AST, without importing the candidates' complete modules, and cannot stand in for native tools or container end-to-end acceptance. Source-code digests match before and after reading; the diagnostics did not touch validation private scoring materials and did not rewrite the original candidates.

Formula-related capabilities should first clarify the applicable syntax, then adopt verified parsing and computation implementations. The [current official openpyxl documentation](https://openpyxl.readthedocs.io/en/stable/formula.html) explicitly states that its Translator supports only A1 references and not defined names; the Tokenizer is also only limited parsing. Switching to some existing function cannot be treated directly as having solved full Excel semantics. This round only records facts and does not patch old candidates and then retroactively endorse their original scores.

## Cost, engineering issues, and delivery

| Stage | Requests started / result | Reported input tokens | Reported output tokens | Sum of request durations |
| --- | ---: | ---: | ---: | ---: |
| Four searches, including G and task H | 501 / 501 | 651,970 | 141,713 | 1,253.431 seconds |
| Independent evaluation of four selected H | 126 / 126 | 123,092 | 26,611 | 254.773 seconds |
| Independent evaluation of common H0 | 65 / 65 | 54,998 | 13,260 | 129.544 seconds |
| Total | **692 / 692** | **830,060** | **181,584** | **1,637.748 seconds** |

Failures, incomplete requests, and missing usage are all 0. The four G sessions made 40, 101, 39, and 47 calls respectively, 227 total, already included in the search row. The request unit is the DSH adapter stream attempt; provider-internal HTTP retries may be invisible; the sum of request durations is not wall-clock time. The original ledger has no reliable price information, so cost remains unknown.

The real trajectory also exposed a host wiring gap: a normal `evolution_finish` was confirmed by the host, yet still entered one model generation; the existing end tests cover only `optimizer_study_finish`. Full's second search therefore incurred an extra summary of 5.528 seconds and 617 output tokens. That cost is retained; the native `concludeTurn()` wiring of the normal end tool was fixed afterward, without retroactively modifying this round's report.

Installation acceptance for frozen G, H0, and the two selected H used the original tarballs, original Profiles, original environment patches, and their respective build identities; no candidates were rebuilt and no model generation was requested. During the initial G installation, the host entered sleep at 1% battery; after waking, the container exited with 137, `OOMKilled=false`; the other four installation contexts passed. The [interruption record](../evidence/paired-feedback-20261028/host-interruption.json) and [original failure receipt](../evidence/paired-feedback-20261028/artifact-installation-interrupted.json) are retained. The second installation exposed a separate command-lifecycle issue: after killing the direct process at 180 seconds, the pnpm child process continued until 226.2 seconds before ending; the [original timeout receipt](../evidence/paired-feedback-20261028/artifact-installation-timeout.json) is retained.

The fix uses an independent POSIX process group and lets installation and native assembly share a 480-second deadline; the acceptance program and the new process-management module are separately hashed and mounted read-only, and the original experiment image and packages are unchanged. The [final receipt](../evidence/paired-feedback-20261028/artifact-installation.json) shows **all 5 installation contexts passed**, with the original control records and frozen identities consistent. Installation passing only shows assemblability; it does not cover the algorithmic counterexamples above and does not authorize public release.

This round completed a real research closed loop and pinpointed the case of "scores improved but the mechanism claim lacks evidence" to specific source code and calls. Next steps should continue research on autonomous mechanism experiments, native API usage, and complex joint plugin mutation; increasing repetitions of the same failed approach or replacing autonomous artifacts with manually fixed candidates cannot close these gaps.
