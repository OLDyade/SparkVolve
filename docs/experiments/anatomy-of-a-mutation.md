# Anatomy of an Autonomous Plugin Mutation

[Interactive case](https://oldyade.github.io/SparkVolve/#experiment) · [Full experiment](2026-10-28-official-deepseek-results.md) · [All experiments](README.md)

This case follows actual source changes from the official DeepSeek run of 28 October 2026. The model configuration and independent grading rules stayed fixed. The optimizer changed a native DSH plugin and then refined its interface. The six source files below preserve the original bytes; their SHA-256 hashes match the previously published [mutation record](../evidence/official-deepseek-20261028/autonomous.json).

```text
H0: inspect + write        H1: add engine-backed calculation       H2: refine tool descriptions
        56.25%     ───────────────── 81.25% ────────────────────────── 100%
                                 Search scores: 4 executions per version
                                                                         │ freeze
                                    Independent execution: H0 81.25% → H2 100%
                                                                         │ original archive
                                    Install in 4 clean Profiles → 4/4 reuse tasks pass
```

## The actual change

| Version | Source change | Inspect the exact bytes |
| --- | --- | --- |
| H0 | `workbook_inspect` returns occupied cells, formula text and comments. `workbook_write` writes explicit edits; it does not calculate formulas. | [Tool registration](../evidence/official-deepseek-20261028/source/h0/index.mjs), [worker](../evidence/official-deepseek-20261028/source/h0/workbook.py) |
| H1 | Adds `workbook_recalculate` and a Python operation that launches the installed LibreOffice engine in a temporary profile. It reports formula text and observed engine values/errors. Tool output changes from a string to structured JSON. | [H0 → H1 patch](../evidence/official-deepseek-20261028/source/h0-to-h1.patch), [registration](../evidence/official-deepseek-20261028/source/h1/index.mjs), [worker](../evidence/official-deepseek-20261028/source/h1/workbook.py) |
| H2 | Keeps H1's worker byte-for-byte. Clarifies the significance of comments, intentionally blank cells and raw numeric units in tool descriptions. | [H1 → H2 patch](../evidence/official-deepseek-20261028/source/h1-to-h2.patch), [registration](../evidence/official-deepseek-20261028/source/h2/index.mjs), [worker](../evidence/official-deepseek-20261028/source/h2/workbook.py) |

The optimizer actually loaded native authoring guidance, queried the Cordis inspector and exercised behavioral probes. Two failed probes and the succeeding probe are retained in the [authoring record](../evidence/official-deepseek-20261028/autonomous.json). Source changes are autonomous experiment outputs. This case changes implementation and tool-interface text; it does not demonstrate an autonomous topology change or isolate the causal contribution of each edit.

## Independent execution and original-package reuse

Search, validation and installation have separate executions and accounting. Validation contributes no new source edits or candidate selection. Four public synthetic task families cover normalization, weighted portfolios, debt rollforwards and scenario valuation. They are engineering acceptance cases, not an unseen-domain evaluation.

The installed H2 archive has SHA-256:

```text
ac305a51e28c9f0d68c7f80df6b7e3c6eb9fc3fa3cacd25458a2ff2fdb3b12c7
```

Its [installation record](../evidence/official-deepseek-20261028/autonomous-installed.json) ties every fresh Profile to this archive and records file inventories before and after task execution. The historical package scope remains `@harness-evolution/spreadsheet`; renaming those bytes would invalidate the evidence. Current project packages use `@sparkvolve/*`.

## Keep the counterexamples attached

The original candidate still contained two defects in optional paths: saving a workbook loaded with `data_only=True` could remove formulas, and checking every `#` prefix could misclassify literal text as an engine error. [The counterexample report](../evidence/official-deepseek-20261028/original-delivery-counterexample.json) preserves both. A separately reviewed repair is identified separately in the full experiment; its quality result must not be credited to this autonomous archive.

The later [three-arm method comparison](2026-10-29-closure-study-results.md) covers six independent searches and retains regressions. Five searches selected H0. An advantage for unrestricted plugin mutation remains unproven.

## Reproduce the presentation

`npm run site:build` verifies all six source hashes against the published record, reconstructs both exact patches, checks the 24 task scores and denominators, and matches the installed archive/file identities. It builds `.site/` entirely from public repository files; it never reads credentials or private trajectories. Serve that directory with a static HTTP server to explore it locally. Running a new model experiment is a separate action through the [startup guide](../quick-start.md).
