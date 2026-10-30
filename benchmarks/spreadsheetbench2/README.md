# SpreadsheetBench 2 · Capability Evolution

A compact community benchmark track for **Discover → Adapt / Author → Compose → Evaluate → Ship**.

## Fixed panel

| Category        | Development | Validation | Test | Total |
| --------------- | ----------: | ---------: | ---: | ----: |
| Debugging       |           6 |          4 |    6 |    16 |
| Financial_Model |           4 |          4 |    4 |    12 |
| Template        |           2 |          2 |    4 |     8 |
| Total           |          12 |         10 |   14 |    36 |

Visualization is excluded. The fixed four-task screen is part of development: two Debugging, one Financial_Model, one Template. It requires mean Modif at least equal to H0 on those same tasks. Survivors execute only the remaining eight tasks; full twelve-task means determine the search champion.

[mixed36.json](mixed36.json) was selected before inference. Golden **path identifiers** define workbook families; no answer contents or scores enter selection. A fixed SHA-256 ranking allocates whole families and then chooses task IDs. No family crosses splits. This panel is not curated for low H0 scores. If H0 saturates, report that result and preregister a new research question rather than choosing low-scoring tasks after observing results.

## H0 and mutation spaces

H0 is an existing, maintainer-corrected native Bundle with workbook inspection, explicit writes and LibreOffice recalculation. DSH shell, Python and native tools remain available. It is not deliberately disabled to manufacture improvement.

| Arm           | Permitted source changes                                       |
| ------------- | -------------------------------------------------------------- |
| Prompt        | `guidance.md`                                                  |
| Single plugin | `guidance.md`, `index.mjs`, `workbook.py`                      |
| Open plugins  | Bundle code, dependency closure, configuration and composition |

All arms share H0, G, model, tasks, four-candidate budget and screening rule. The official/community catalog is frozen once. Native resolution creates separate drafts; dependencies do not silently enter H0. G may inherit any authorized candidate, including a useful rejected branch. Recorded parent links establish actual inheritance; eligibility alone does not prove a multi-generation outcome.

Start the comparison with:

```bash
npm start -- --env-file /absolute/private/deepseek.env --study
```

See [Quick Start](../../docs/quick-start.md) for deployment preparation and the 212-task upper bound.

## Independent evaluation and delivery

The trusted adapter recalculates source and reference workbooks with the unchanged official UNO script, then separates public input from private grading material. Each delivery is recalculated and scored by the pinned official evaluator. Filename-dependent Color/Embedded rules retain their original task paths.

Primary selection uses official per-task **Modif**, with the complete registered denominator. **Acc.**, Regression, failures, latency and tokens remain separate observations. Missing task delivery contributes the registered failure value; grader faults remain faults. Raw grader diagnostics stay private because they may reveal reference coordinates and values. G receives authorized aggregate scores and its own execution evidence.

Search selects one package per arm. Validation compares those frozen packages and H0; strict improvement is required, H0 wins ties, then registered arm order. The winner freezes before test. H0 and the winner install their original `bundle.tgz` into fresh DSH Profiles and execute the 14 test tasks. Equal package identities execute once. No rebuild, output correction or test-driven reselection.

## Sources and limits

- [Official repository](https://github.com/RUCKBReasoning/SpreadsheetBench-2/tree/a7bdc2d358e052d35a94768e1f487c0d9e9c0011)
- [Pinned dataset](https://huggingface.co/datasets/KAKA22/SpreadsheetBench-v2/tree/5a2215ed4121945ab09d8723df2995602090b042)
- [Paper](https://arxiv.org/html/2606.29955)

The pinned metadata contains 100 Debugging tasks / 10 families, 100 Financial_Model tasks / 20 families, and 97 Template tasks / 97 reference paths. The paper states CC BY-SA 4.0 for data; the dataset card declares MIT. Until that discrepancy is clarified, this repository distributes acquisition and evaluation adapters, **not the upstream workbooks**. Preserve upstream attribution when using them.

This is a small, public, family-separated pilot, not an official Overall leaderboard result. Prior project exposure is disclosed. One search per arm cannot establish repeatable method superiority; future repetitions require their own frozen registration and budget.

The old synthetic examples are now regression fixtures under `tests/fixtures`; historical reports remain intact and are not the main quality evidence.
