# Plugin Mutation Space Comparison · Preregistration

Registration time: 2026-10-29, before model calls. Core question: under the same optimizer, starting point, and budget, does an open plugin implementation and assembly structure more readily produce effective improvements than modifying only the prompt?

This study compares three **mutable scopes**; it is not labeled as a GEPA reproduction, nor does it mix in a manually corrected version. The model still reads evidence, writes code, and submits candidates through DSH native plugin capabilities.

| Fixed item | Registration |
|---|---|
| Model | Official DeepSeek; both G/H use `deepseek-flash`, off, maxTokens 32768; the server-side alias cannot guarantee that weights never change |
| Runtime base | DSH 0.2.1-rc.4 / Cordis 4.0.5; image content ID and digests of all runtime files are frozen in the run directory |
| G | The same evidence-driven Bundle, the same source code and build artifacts |
| H0 | The same spreadsheet plugin, plus the native systemPrompt text slot `guidance.md` shared by all groups |
| Feedback and ancestry | full; all candidates fork from H0, avoiding mixing ancestor-chain differences into the method comparison |
| Data | Four public synthetic business families; development and validation use different numeric values, and validation artifacts do not enter search feedback |
| Replication | Two independent searches per group, six in total; each search has H0 + at most two new candidates |
| Task budget | 600 seconds per task; four tasks concurrent per search, at most two searches in parallel; equal optimizer budget across groups |
| Selection | Strict improvement in the development-set primary metric; retention and invocation cost are reported. Independent validation does not retroactively select G or H |

## Three group treatments

| Group | Mutable content | Content that must not change |
|---|---|---|
| prompt | `guidance.md` free text | Plugin implementation, dependencies, and assembly |
| single-plugin | `guidance.md`, `index.mjs`, `workbook.py` | Dependencies, assembly, and extra files; internal tools and implementation of the same plugin may be changed |
| open-plugins | The entire candidate Bundle | Fixed model, evaluation, task, and permission contracts |

The first two groups precisely constrain source files through the generic contract `hostSearchProtocol.editableFiles`. The controller compares the complete file list, contents, and executable bits of H0 and the candidate; adding, deleting, or modifying files outside the scope raises an error directly before acceptance. The open group still uses the normal candidate build, native assembly, and scoring pipeline. Specific mutations are chosen by the model; no new tools or formulas are specified in advance.

This constraint controls the **candidate source scope** and does not disable the executor's existing Shell or file tools. A single-plugin implementation can also add internal capabilities, so the three groups must not be understood as strictly increasing intelligence levels.

## Denominator, analysis, and execution

The upper bound is 104 task executions: development search 3 groups × 2 searches × 3 candidates × 4 tasks = 72; independent validation of selected H 24; shared H0 independent validation 8. G inference, build, native assembly, and scoring costs are recorded separately. Candidate budget left unconsumed by early termination is recorded truthfully and is not made up by extra runs.

The experimental unit is one independent search, with only two per group. Report the difference between H* and the same search's H0 per search and per task, along with raw scores, failures, tokens, request counts, and elapsed time; do not treat the eight task samples as eight independent evolutions, and make no significance claims. Each selected H must also have its actual source diff inspected to distinguish whether an implementation or composition change truly occurred.

Execution order is determined by the frozen study job list, and full timestamps are retained. Concurrency on the shared machine and the official model alias are both confounders. Terminal search failures use the contract failure score, and unobserved independent validation slots remain null; quality failures and service failures are not automatically retried, and negative results are not rewritten.

```bash
node --env-file=/absolute/private/deepseek.env scripts/verify-feedback-study.mjs \
  --comparison mutation-space --root <NEW-study-directory> \
  --image <immutable-spreadsheet-image> --isolation <isolation.json> \
  --model examples/deepseek/model.json --provider-directory examples/deepseek \
  --controller-ip <container-reachable-IPv4>
```

Adding `--check-contracts` only checks the image, native runtime environment, build, and contract, without requesting the model. `research-registration.json` is written before the first model call. Raw state is in the study ledger; `validation-comparison.json` is a read-only summary and cannot overwrite raw scores.

This experiment covers new numeric values for synthetic tasks of the same kind and cannot represent official SpreadsheetBench, unseen business domains, or a general method advantage. Subsequent extensions must be registered separately and cannot retroactively adjust this round's protocol.
