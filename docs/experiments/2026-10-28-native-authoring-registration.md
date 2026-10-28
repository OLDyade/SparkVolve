# Native DSH authoring integration acceptance

This registration tests the default optimizer's connection to DSH's native plugin authoring ecosystem. It does not select a favorable score or claim stable quality gains. The actual immutable image, all contracts, source hashes and reference bodies are recorded by the driver **before any model request**.

```text
installed DSH inspector + official package Skills (hash-bound)
             │ actual model queries / exact loaded Skill receipt
             ▼
H0 → native QA + four development tasks → autonomous G implementation
             │ optional probe; up to two new frozen candidates
             ▼
native QA + independent scorer → ordinary controller champion selection
             │ exact original source + build + archive, no rebuild
             ├── H0 + selected H: four validation tasks each
             └── ordinary export → original archive native installation
```

## Fixed contract

| Item           | Registered choice                                                                                                                   |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Public tasks   | Four existing `research.py` business families, development and validation inputs generated separately; original `grade.py`          |
| Task budget    | H0 + at most two candidate H versions: 12 search tasks; original H0 and final champion: 8 validation tasks; total ceiling 20        |
| Model          | Explicit caller-supplied Venus model contract, frozen equally for G and H; credential only from private environment                 |
| G budget       | 1,200 seconds; optional probes at most 3, each 120 seconds                                                                          |
| Task execution | Four concurrent tasks, one repetition, 300 seconds per task, failure limit zero; no retry                                           |
| Isolation      | Explicit caller-supplied runtime/network contract; MicroVM not required                                                             |
| Mutation       | Optimizer chooses implementation/assembly changes using authorized evidence; no prescribed formula, topology, repair or task answer |
| Selection      | Ordinary controller selection on full development denominator; validation never feeds a new search                                  |
| Delivery       | Export final champion's original archive and provenance, then install that exact archive under original image/environment           |

If the champion remains H0, both validation arms explicitly identify the same original artifact. A rejected candidate can demonstrate the integration path. A positive score is not a prerequisite for reporting successful integration. Failed builds, native QA, model requests and tasks remain in the original ledger; unobserved scores stay unobserved. A failure does not authorize another attempt.

## Acceptance evidence

1. At least one **successful native `cordis_inspect_query` receipt** and one **successful `skill` receipt** containing the exact registered official Skill body and source directory. Tool names shown in a prompt, schemas, model claims and failed calls do not count. Tool use is explicitly requested for this integration test; it does not measure spontaneous tool selection.
2. A nonbaseline frozen candidate has a JavaScript/TypeScript or Python AST shape change beyond literal prose/comments and completes native QA plus all four scored development tasks. All source and patch differences are reported against registered H0; declared parents are recorded separately, including valid zero/multiple-parent proposals. AST structure does not prove meaningful behavior, correct API use or generalizable gains; bounded source/actual-trace review assesses those claims. Pure textual changes or unexercised topology mechanisms are not relabeled as proven implementation improvements.
3. Both original-package validation arms have all four actual scores. Results, regressions and complete denominators are reported separately from integration checks. These public generated families are not unseen heldout data or cross-domain evidence.
4. The ordinary capability export and original archive install succeed; no repacking, rebuilding or replacement of the selected candidate is permitted. Installation starts native DSH composition with no model inference.
5. Actual optimizer/task request ledgers, tokens, failed/unfinished counts and durations remain complete. Missing usage prevents a complete integration claim. Optional probes are reported independently; absence is not a failure.

The driver saves `registration.json`, command logs, immutable inputs, ordinary search/validation ledgers, `export/`, installation evidence and `acceptance.json`. Read `checks`, actual source changes and quality results together. No single boolean certifies stable accuracy or every mutation category.

```bash
node --env-file=<private-env-file> scripts/verify-native-authoring.mjs \
  --root <NEW-evidence-directory> --image <immutable-image-digest> \
  --model <model.json> --isolation <isolation.json> \
  --controller-ip <reachable-IPv4> --install-policy <pnpm-policy.json>
```

`--check-contracts` performs image/source/contract preflight without model calls. It reserves its own new evidence directory. A later real run uses a different new directory and re-registers the same checked immutable image. There is no resume/retry shortcut.

The acceptance driver owns its executions. On interruption it first waits for the public observer to stop, then explicitly invokes `cancel` for its initialized search and `cancel-validation` for its frozen validation registration. Registered preflight/installation execution identities are separately cancelled through the existing cancellation API. It stores `owner-cancellation.json` and each original cancellation receipt; unsuccessful cleanup yields `cancellation-failed`, never a completed or successful experiment. Ordinary public observer interruption continues to preserve resumability; the owner action is explicit and confined to this invocation.
