# Round179 Fixed Five-Question Controlled Comparison

2026-09-22; official source: `runs/spreadsheetbench2-round179-controlled-ablation/ablation-report.json`. Three arms, five questions each, one run each; no supplementary questions, no retries, no promotion. The real controller has exited and the container has been drained.

| Same question | off | source | live |
|---|---:|---:|---:|
| Template/13_04 | 53.52% | 76.06% | 67.61% |
| Debugging/09_01 | 62.02% | 34.92% | 18.89% |
| Debugging/04_05 | 88.98% | 88.98% | 88.98% |
| Financial_Model/17_02 | 100% | 100% | 0%: startup failure |
| Financial_Model/05_01 | 73.45% | 18.84% | 0%: startup failure |
| Full five-question mean | **75.594%** | **63.760%** | **35.096%** |

source-off=-11.834pp, live-source=-28.664pp. The off/source comparison covers the entire startup assistance set (automatic open, routing, line-by-line semantics, context) and is not an independent effect of the Jev model; source/live differ only in the delivery observation switch, but live includes two startup protocol failures, so its entire loss cannot be attributed to review semantics. Each question was run only once per arm, so no claim of statistical significance, model ceiling, or general negative effect can be made. off and the champion 150 are also not the same Harness, so the five-question results here cannot be promoted to a 30-question champion.

## Cost and Failure Breakdown

| Group | HTTP started/result | Original-recorded transport/HTTP failed | Local protocol rejections | unfinished | Input tokens | Output tokens | Sum of request durations ms |
|---|---:|---:|---:|---:|---:|---:|---:|
| off | 0/0 | 0 | 0 | 0 | 0 | 0 | 0 |
| source | 269/269 | 0 | 0 | 0 | 2492158 | 155826 | 178304.343 |
| live | 435/435 | 0 | 2 | 0 | 4793718 | 177498 | 280329.072 |

704 HTTP requests in total; returned does not equal validated successfully. The original collector did not count local choice-distribution validation rejections; the original statistics are kept unchanged and supplemented separately. See DIAGNOSIS-Round179-Interim-Protocol.md for the two cases, both at the startup stage. The official API requires choice to be the highest-probability option; vendor responses are not patched by argmax override, normalization, error swallowing, or retry.

## Trajectory and Real-Delivery Verification

A read-only script `scripts/benchmark-server/spreadsheetbench2/inspect_round179.py` was used to extract the OOXML raw text, complete formulas, and caches of each arm's workspace/input.xlsx and actual output.xlsx, without reading reference answers. Combined with each question's logs/stdout.log and changes.json. Intermediate working copies in the workspace of failed tasks do not equal official delivery; the two official cases with no delivery still count as 0.

- Financial_Model/05_01: the original Dashboard D40/F40/H40 are First/Second/Third Tranche respectively; columns D/F/H are dates, columns E/G/I are multiples. source changed the original numeric value 2 in E44/E45 to the formula =2 and claimed in the final statement that they were Second/Third multiples; in reality G43:G45 and I43:I44 remained blank. off filled in these subsequent tranche columns. This confirms a two-dimensional identity mapping failure; the entire low score cannot be attributed to these few cells.
- Debugging/09_01 source: original H8=1; original G67 was IF(circ=0,0,-G179), and the delivery inverted it to IF(circ=0,-G179,0), with cache 0. G133/G143/G150 also wrap IF(circ=0,original relation,0). There is indeed behavior that shuts down business chains to eliminate errors. source still fixed the Financials J18 double deduction of J17, proving that not all modifications are worthless.
- Debugging/09_01 live: G156 was changed from G123+G133+G134+G143+G150 to G143+G150; G143/G150 repayments were rebased on G123; G164/G170 removed repayment items; the Financials J18 double deduction remains. off fixed Financials J18, but also changed average cash interest to beginning cash; off's higher score cannot prove that all business modifications are correct.
- Template/13_04: off overwrote the original C13=18 as tax rate times the entire base, and placed later-period growth in C20, with most subsequent G:H metrics empty. source retained C13 and had more complete placement of D/E historical growth and F:H forecast metrics; E13 still reads E35+(28+15)*E36. live's C20 references later-period growth, E20 is blank, and tax amount only links to the reported tax amount. The source assistance showed a positive observation on this question, which cannot be erased by negative returns on other questions; nor can this establish independent causality for line-by-line classification.
- Debugging/04_05: all three arms have the same official 88.98%; the actual Summary H13 all retain H12/H11-1, with cache about 0.230523; all three arms failed to resolve the same remaining deviation.
- Financial_Model/17_02: off/source are both officially 100%; source's extra 117 startup Jev calls showed no observed quality gain; live had a startup failure with no official delivery. 100% is only the official metric and does not certify all semantics.

## Decision

Take design responsibility first: full-table prediction gave the auxiliary model an overly broad and overly indirect task, and also poured a large amount of explanation into the main model, while locally correct judgments did not reliably translate into correct delivery. The existing evidence is insufficient to assert that Jev is entirely useless or that Spark's capability has reached its ceiling. Withdraw this default intervention mode and stop layering global review.

The next candidate should research and implement a collaboration approach of "explicit questions, raw rectangles, independent support judgments": do not automatically select targets for Spark, do not prefill operation categories, do not treat probability as a correctness gate; let source evidence and the specific question appear together in a single tool return. Whether it is actually adopted and its quality gains are to be verified by subsequent independent single-question validation. Spark may still fail to call or ask the wrong question; this must be counted truthfully, not masked by mandatory steps.

## Current Materials

- [Jev 1.13 known boundaries](https://docs.typesafe.ai/model-jaggedness/jev-1.13): officially reviewed 2026-09-17, currently accessed 2026-09-22. Recommends specific questions, reducing indirect references and irrelevant state, and delegating arithmetic to code.
- [Noul interface](https://docs.typesafe.ai/primitives/noul): returns a yes probability from 0..1, with no null semantics; insufficient support cannot automatically be interpreted as counterevidence, and probability cannot certify formula correctness. Synchronously verified against Context7 official documentation.
- For existing community, X, and source-code indexes, see RESEARCH-Jev-Case-Library-20260922.md; popularity is not treated as evidence of local gains.
