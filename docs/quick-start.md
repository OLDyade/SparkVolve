# Launch a Real Evolution Run

[README](../README.md#quick-start) · [Benchmark protocol](../benchmarks/spreadsheetbench2/README.md) · [Add a domain](domain-adapters.md)

## Preparation

Use Node.js 24.16+, npm, Python 3.11+, Docker and an official DeepSeek API key. Store `DEEPSEEK_API_KEY` in a private environment file outside the repository, with permissions `0600`.

Set `SPARKVOLVE_EGRESS_POOL` to a reserved private IPv4 CIDR outside your host, LAN and VPN networks. Four executor slots plus G require ten /29 leases; three concurrent study arms share a larger pool. Use at least /24 for the comparison. See [isolation](isolation.md).

```bash
npm ci
npm start -- --env-file /absolute/private/deepseek.env
```

The default launches one open-plugin evolution chain on the registered **SpreadsheetBench 2 mixed36** panel. Add `--study` for the three mutation-space comparison. Both use the official DeepSeek Provider and 600 seconds per task. Model, image, task IDs, private grader identities, capability catalog and selection rules freeze before inference.

## What runs

```text
Pinned community data + official evaluator + competent H0
                          |
                Development: 12 tasks
                          |
        G chooses a parent and a capability change
           Discover -> Reuse / Adapt / Author -> Compose
                          |
                 Build + native assembly QA
                          |
                   Fixed 4-task screen
                 /                     \
          below H0                    at least H0
         retain evidence           run remaining 8 once
                                         |
                           select by full 12-task score
                                         |
                      independent 10-task validation
                                         |
                             freeze validation winner
                                         |
                  original archives -> clean DSH Profiles
                                         |
                       H0 vs winner on 14 test tasks
                                         |
                        Bundle + Lineage + Evidence
```

H0 runs all 12 development tasks. Three subsequent candidates are available per search. G chooses ancestry and mutation size; there is no required action checklist. An early stop must include a reason. A failed screen leaves eight tasks explicitly unobserved and cannot compete on a full-panel mean.

| Mode | Search | Validation | Original-package test | Maximum task executions |
|---|---:|---:|---:|---:|
| Default | 4 candidates × 12 | H0 + selection × 10 | H0 + winner × 14 | 96 |
| `--study` | 3 arms × 4 × 12 | H0 + 3 selections × 10 | H0 + winner × 14 | 212 |

Screening and identical-package reuse reduce actual execution. Build, native QA, optimizer inference and optional behavioral probes are additional resources. Time and tokens are reported. The maximum is not a promise to spend every slot.

The first launch builds an image with LibreOffice and downloads the pinned upstream archive. Workbooks and private scoring materials remain under the ignored run directory. No dataset files are committed or bundled. Model calls use your account quota. `--prepare-only` performs acquisition and registration without model inference.

## Follow the evidence

Each run has a new `.evolution/<benchmark>-<time>/` directory:

| Path | Evidence |
|---|---|
| `registration.json` | Frozen sources, models, split identities, budget and selection rule |
| `startup.json` | Current phase, original faults and delivery results |
| `search/` or `study/children/` | Native G/H traces, candidate sources, actual ancestry and scores |
| `study-report.json` | Three-arm results, failures and measured model usage |
| `validation-selection.json` | Independent validation outcomes and the pre-test decision |
| `delivery/<arm>/capability/` | Unchanged archive, source, lineage and capability card |
| `delivery/<arm>/installed/acceptance.json` | Original-package installation and independently scored test |
| `command-logs/` | Exact stage outcomes; failed attempts remain intact |

Candidates are selected on full-development Modif. Validation chooses the final frozen package; H0 wins ties, followed by the registered arm order. Test scores never change that selection. Identical packages are tested once. No automatic task retry or score-driven replacement occurs.

Family-separated splits prevent workbook variants crossing partitions in this study. This public benchmark has historical project exposure; pristine unseen-data claims are not made. One search per arm gives a pilot comparison, not a statistical superiority claim.

## Replace the benchmark

Pass `--benchmark path/to/adapter.mjs`. The module exports a `benchmark` descriptor and `prepare(context)`, returning frozen development, validation and test contracts. The shared launcher has no spreadsheet-specific execution branch. See [the adapter contract](domain-adapters.md).

Other options: `--root` selects a new evidence directory, `--image sha256:...` uses an exact matching runtime image, `--provider` changes the explicit Provider configuration, `--task-seconds` changes the task deadline, and `--runtime` / `--dns` configure your deployment. Model configuration never silently changes.
