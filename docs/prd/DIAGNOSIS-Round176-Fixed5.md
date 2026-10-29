# 176 fixed 5 questions: refuse to expand to 30

The official mean of 60.16% is lower than the fixed same-question historical 70.412%; 5 completed, 0 terminated failures; PASS1/5 is reported only. The original directory runs/spreadsheetbench2-round176-jev-tool-surface-fixed5 is fully preserved, not re-sampled. Total task time 3468.465 seconds versus historical 4050.011 seconds; history had 30 concurrency, this round 5 concurrency, so no same-environment speed causality is drawn.

|Question|Historical Modif|This-round Modif|Jev physical requests|
|---|---:|---:|---:|
|Debugging/04_05|88.74%|89.05%|44|
|Debugging/09_01|12.79%|26.91%|29|
|Financial_Model/05_01|74.47%|39.77%|148|
|Financial_Model/17_02|100%|100%|117|
|Template/13_04|76.06%|45.07%|10|

348 started/348 result, no unreturned/recorded request errors; per-question token and latency see jev-cohort-report.json. More calls do not mean benefit: 117 calls correspond to 100%, 148 calls correspond to 39.77%; causality cannot be established from this.

Template real trajectory: initial source text read → original table read → independent Python arithmetic → 47-item formula file → submit → self-made F7/F8 mutual references → correction and resubmit → read-only main table and declare full-period completion. The original metric rows such as row 21 were blank, not entering its observation rectangle; internal computation was treated as delivery coverage. No-error was not treated as independent correctness evidence. The single-question 98.59% and this 45.07% under the same version result show insufficient stability.

The original task of Financial_Model/05_01 requires the Exit Multiple of the second/third tranche of all deals to be 2x; the original Dashboard H16/H17 are both 10, G16/G17 are Second/Third Tranche, the actual exit area row 42 is Exit Months/Month/Numbers, and from row 43 each deal is the quantity in columns E/G/I. After reading the original table multiple times, the model still changed H16/H17 to 2, and the final summary explicitly stated this change, without completing the exit multiples of all deals. The original input and delivery, task and trajectory mutually corroborate the target identity mismatch; the official regression hint is only corroborating evidence. All low scores cannot be attributed to this one point.

The 176 single question also had a hidden schema causing the changes string parameter to fail twice, correct after expansion. This supports revoking tool hiding, but does not prove that restoring all tools can improve accuracy. 177 overall adds optional plan correspondence review, retains the original form and explicitly shows identity/coverage uncertainty; no automatic repair, no additional save gate, no change to original input due to official differences.
