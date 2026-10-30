# A Flagship Experiment for Structural Harness Evolution

Status: researched design; no new benchmark run has been launched by this audit.

Audited repository: `ce4a0a12deacb8ae996f3f6210bb8e8bb7c583e9`, 2026-10-30.
This design preserves **Evolve the Harness, Not the Model.** It changes the strength of the experiment, not the project's core ideas.

## The research question

**Can autonomous changes to native plugin implementations and assembly produce capabilities that generalize beyond the tasks used to evolve them?**

Demonstrating code modification, a successful installation, and a high score on a small synthetic task set establishes useful engineering behavior. The flagship experiment must additionally establish where structural search helps, where it fails, and what survives independent validation.

The deliverable is an original installable Bundle, its actual ancestry, and reproducible evidence. A predetermined sequence of six mutation actions is not a research result.

## What the current evidence actually establishes

| Finding | Verified evidence | Consequence |
|---|---|---|
| Default examples are small | Structured-data preparation budgets two candidates including H0; spreadsheet preparation budgets four. | Preserve their Quick Start purpose; use a separate research recipe. |
| The latest study does not test cumulative ancestry | The feedback-study driver freezes `seed-only`; H1 and H2 independently inherit H0. Normal example recipes already allow unrestricted ancestry. | Configure a genuine archive-based search. The controller does not need a replacement runtime to support parent inheritance. |
| Selection pressure is weak and noisy | Five of six searches selected H0. Repeated H0 development observations ranged from 75% to 100%. | Calibrate task difficulty and measure stochastic variation before making method claims. |
| Structural evolution was not demonstrated in that study | None of its 12 mutation patches changed `cordis.patch.yml` or package dependencies. | Distinguish implementation edits from assembly changes; do not infer composition from an action label. |
| Existing reuse is narrow | Validation and reuse use new values within four public task families. | Add workbook-family and layout separation before claiming transfer. |
| Reuse does not establish universal semantics | Successful archived plugins still produced false warnings or destructive coercions in inspected counterexamples. | Include negative cases and regression evidence without inserting benchmark-specific repair code. |

Repository evidence:
[study results](../experiments/2026-10-29-closure-study-results.md),
[registration](../experiments/2026-10-29-closure-study-registration.md),
[study driver](../../scripts/verify-feedback-study.mjs),
[controller](../../src/controller.ts),
[spreadsheet preparation](../../tests/fixtures/spreadsheet/prepare.mjs),
[structured-data preparation](../../tests/fixtures/structured-data/prepare.mjs).

## One experiment, a complete evidence chain

```text
Pinned domain adapter + exposure-aware task groups + fixed model/runtime/budgets
                                  |
                         Competent native H0
                                  |
             +--------------------+--------------------+
             |                    |                    |
        Prompt-only        Single-plugin         Open-plugin
             |                    |                    |
             +----- independent searches per arm -----+
                                  |
                  Native optimizer G reads permitted
                  task traces, failures and regressions
                                  |
          +---------------- candidate archive ----------------+
          | H0 --> H1 --> H3                                   |
          |  |      |       [actual parent links, not round IDs] |
          |  +--> H2 --> H4  [rejected branches retained]        |
          |         +-----> joint candidate, if chosen by G     |
          +----------------------------------------------------+
                                  |
              Source/assembly diff + native operational QA
                                  |
                 Fixed development panel and full ledger
                                  |
                   Predeclared selection -> frozen H*
                                  |
              Fresh paired H0 / H* independent validation
                                  |
                   Sealed workbook-family test
                                  |
              Install the ORIGINAL archive in a clean DSH
                                  |
          Capability Bundle + lineage + quality/cost evidence
```

The diagram illustrates permitted branching, not a required search trajectory. G chooses parents, mechanisms, and optional behavior probes. A joint candidate requires implemented integration and recorded provenance; listing multiple parents alone does not establish composition.

The optimizer remains fixed during this method comparison. Optimizer self-evolution is a separate study after the executor experiment has meaningful selection pressure.

## Task design and historical exposure

Use SpreadsheetBench 2 as the first substantial domain adapter. Keep benchmark-specific loading and grading outside the generic controller. Its published 321 tasks comprise 100 Financial Modeling, 100 Debugging, 97 Template and 24 Visualization tasks.

The directly executable nonvisual scope is **297 tasks**. This is a named subset study, not a result on the complete benchmark. The visual track requires its own Excel/WPS rendering environment and official VLM assessment; it must not be approximated with formula scoring.

An audit of 280 direct historical `run-results.json` files found 100 distinct category/task identities: 30 Template, 40 Debugging, and 30 Financial_Model. This is a conservative exposure inventory, not proof that all other tasks are unseen. Nested run directories, prior inspected inputs, shared workbooks and dataset revisions require additional alignment.

Before freezing a roster:

1. Pin the canonical dataset revision, evaluator commit, input hashes, recalculation environment and license/attribution requirements.
2. Align historical IDs and hashes with that revision. Record executed, inspected and unknown exposure separately.
3. Have the data steward group related tasks by originating workbook and shared source material. The optimizer receives opaque group IDs, never Gold contents or answer-derived grouping material.
4. Assign whole groups to development, validation and sealed test. Do not split variants of the same workbook across these sets.
5. Use only development tasks for difficulty calibration. Retain mixed difficulty, multiple business operations, cross-sheet dependencies, preservation requirements and negative cases.
6. Publish the actual roster before the study. Do not pick an exact split size before knowing the independent group count.

Historical tasks may support development. A group with known prior exposure cannot be advertised as an untouched test group. If clean provenance cannot be established, describe the experiment as benchmark adaptation and obtain separately sourced workbook families for the generalization claim.

A new seed, new split, or new task adapter does not erase historical exposure.

## A fair starting Harness and mutation space

Start every arm with the same functional native DSH Bundle. Define plugin boundaries by real responsibilities such as workbook inspection, explicit editing and recalculation; retain the same useful behavior across arms. Do not remove working capabilities merely to make an attractive learning curve.

Record seed engineering and benchmark-specific preparation separately from autonomous gains. Historical champion scores remain historical references; the new H0 must be rerun under the new contract.

| Arm | Permitted changes | What the comparison asks |
|---|---|---|
| Prompt-only | Designated instructions and configuration fields declared as prompt scope | How much can instructions alone improve the common seed? |
| Single-plugin | Instructions plus implementation of one designated capability, with assembly fixed | What does code-level capability adaptation add? |
| Open-plugin | Authorized plugin implementation, configuration, dependencies and composition; new plugins allowed | Does the larger native capability space provide additional independent benefit? |

The single-plugin arm must be allowed substantive new logic inside its permitted implementation. Otherwise an open-plugin win could merely reflect an unfairly crippled comparator.

Task-time temporary scripts remain available under the shared execution contract. Persisted candidate changes must stay within the registered mutation scope. All arms use the same execution permissions and artifact interface.

Preserve native assembly validation and explicit operational semantics. The flagship QA contract must specify which public interfaces are invariant and which may be replaced; do not silently require an old tool name while claiming unrestricted replacement. Business quality belongs to the independent grader.

## Search, selection and compute

Proposed study envelope:

- Three mutation-space arms, initially three independent searches per arm.
- Up to 16 candidates per search, including H0, with unrestricted archived parent selection.
- The same development roster, inference configuration, task repetition policy, concurrency, candidate budget and probe budget across arms.
- Correctness is the selection objective. Runtime, tokens, money and regression observations are separately reported unless the contract explicitly defines otherwise.
- The 600-second task budget is the current starting default. Any longer budget needed by the real workload must be established using development calibration and frozen equally before comparison.
- No requirement to use all six actions, reach a particular ancestry depth, or produce a fixed number of winners.

Sixteen is a proposed exploration budget, not a claimed optimum. Three searches provide an initial estimate of run-to-run variability; they do not guarantee statistical power. Freeze the final budget after development-only calibration and retain all completed searches.

For perspective, nine searches with 16 candidates and a 30-task development panel permit **4,320 development task executions**, before probes, validation, test or installation acceptance. Report this cost envelope before execution. A manually configured experiment recipe is preferable to silently expanding the default startup cost.

The current system records usage but does not enforce an aggregate token budget across optimizer, executor and probes. Until such enforcement exists, describe the comparison as matched candidate/task/probe budgets, not equal-token or equal-dollar compute. Report every call, failed attempt, rejected candidate, tool execution and probe. Report quality against cumulative spend as well as candidate count.

Select H* using the registered development rule before opening independent validation. Validate H0 and H* on fresh paired executions, with order balanced and recorded. Freeze repetitions before execution; never retry a valid low score to obtain a better sample. Retain the entire denominator and failed attempts.

Keep sealed test unavailable to G and to tuning. If validation feedback informs a later search, mark that validation set as seen and allocate a new independent set. Do not repeatedly probe a single holdout while continuing to call it independent.

## Preserve the official scoring contract

Pin and invoke the official evaluator unchanged. Keep its raw reports on the grader side, alongside a separate research aggregation.

The current evaluator compares annotated `answer_position` ranges with category-dependent value, formula or color logic. It rounds ratios and promotes regression ratios of at least 0.998 to 1.0 before task accuracy adjudication. It also excludes certain missing-file rows from aggregate Modif/Regression averages. Therefore “exact equality of every cell in the whole workbook” is an incomplete description of the actual implementation.

Report separately:

- Official task accuracy, with the exact evaluator revision and selected benchmark scope.
- Official Modif and Regression metrics, with their actual denominators.
- Full-denominator research metrics that explicitly retain missing/failed deliveries under the registered failure rule.
- Per-category results, per-task differences and regressions.
- Cost, runtime, native tool usage and package-installation acceptance.

Do not overwrite the official JSON to make its denominator match a research policy. Do not compare the historical Modif score directly against a leaderboard task-accuracy score.

Raw cell mismatch diagnostics can reveal reference information. The feedback adapter must expose only authorized score summaries and source/trajectory evidence; raw reference values and answer positions stay outside the optimizer and executor.

## Measure structural evolution instead of counting labels

For every candidate, produce one evidence record:

```text
Actual source/config diff
  -> resolved plugin and service graph change
  -> native registration and exercised calls/events
  -> paired task outcomes, including regressions
  -> independent validation of the frozen selection
  -> unchanged archive installation and reuse
```

Record enabled/removed registrations, provider/consumer changes, configuration changes, implementation changes and new modules separately. A file count, source filename, declared `actions` field, or an unused registered plugin is insufficient evidence.

Store real ancestry depth, branching, merged provenance, time spent, calls and task-level changes. Count cumulative evolution only when a child actually inherits a previous mutation. Preserve nonwinning branches for inspection.

For a selected structural change, preregister a mechanism ablation where technically meaningful: compare the integrated candidate against a version with that mechanism removed while other changes are held fixed. If removing a dependency makes the package invalid, record that limitation and do not present the invalid package as a fair behavioral comparator.

More actions or a deeper graph are descriptive results. The important outcome is independent quality and reusable capability.

## Implementation work in this repository

| Work package | Existing foundation | Required delivery and acceptance |
|---|---|---|
| Official benchmark adapter | Domain adapter contract; isolated input/delivery/evaluation mounts | Add a dedicated adapter directory, exposure/group manifest and pinned grader runner. Verify that official raw results are preserved and private scoring data never enters G/H mounts or feedback. |
| Longitudinal study recipe | Unrestricted parent support in `src/controller.ts`; fixed scopes in `src/mutation-scope.ts` | Add a separate research driver that accepts a frozen roster and budget. Verify H2 can inherit H1, forks retain exact parents, and all arms receive the same H0 and task contract. Do not relabel old seed-only results. |
| Structural evidence | Candidate diffs, native assembly and task traces | Extend reports with resolved assembly changes and observed use. Test implementation-only, composition-only and unused-plugin cases separately. |
| Complete accounting | Telemetry and search reports | Aggregate G/H/probe/failure usage per search. Implement budget enforcement before making equal-token claims; provider usage absence remains explicit. |
| Independent evaluation and delivery | `src/validation.ts`, original artifact identity, clean-profile installation | Freeze selected hashes, rerun H0/H* on grouped unseen inputs, and install the original archive without rebuild. Test complete denominators and artifact identity. |
| Research presentation | Existing experiment records and README visuals | Publish the actual ancestry graph, code/assembly diff, quality-versus-cost curve, negative results and Bundle download. Link to immutable evidence, not a manually invented progress story. |

Keep the lightweight start command and existing acceptance examples. Add the flagship recipe alongside them. No benchmark IDs, coordinates, expected answers or task-specific repair rules belong in the generic evolution engine.

Native behavior probes already exist. Reuse them for draft execution, failure replay and synthetic counterexamples rather than adding a parallel agent runtime.

## What would justify a stronger public claim?

A convincing result would show independently measured gains from open-plugin search, concrete native structural changes that were actually exercised, and successful reuse of the same frozen package on separately sourced workbook families.

If prompt-only or single-plugin performs just as well, publish that finding. If H0 remains selected, publish that finding. If a structural change raises development scores and lowers validation scores, retain it as a negative example. These outcomes inform the research method and do not justify fabricating a richer trajectory.

After this study, use a second domain with different artifacts and grading semantics to test framework reuse. Changing only spreadsheet numbers establishes a much narrower claim.

## Related work and source boundaries

- [SpreadsheetBench 2 paper](https://arxiv.org/html/2606.29955) and [official evaluator at a7bdc2d](https://github.com/RUCKBReasoning/SpreadsheetBench-2/blob/a7bdc2d358e052d35a94768e1f487c0d9e9c0011/evaluation.py): task composition, real spreadsheet workload, official metrics and reproduction requirements.
- [Official visual evaluator](https://github.com/RUCKBReasoning/SpreadsheetBench-2/blob/a7bdc2d358e052d35a94768e1f487c0d9e9c0011/run_visual_vlm_checklist_eval.py): visual scoring is a separate execution and measurement path.
- [Darwin Godel Machine](https://arxiv.org/html/2505.22954v3): archived candidates and branching motivate genuine ancestry and retained stepping stones. This does not establish SparkVolve's performance.
- [AutoSaddler V2 architecture at e841543](https://github.com/microsoft/AutoSaddler/blob/e841543ce6cf6bdf690e65134b12a829ec9f66d1/docs/v2-architecture.md): current plugin-based engine, immutable candidates, EvoDAG, policy boundaries and development/test separation. Its V1 research results must not be attributed automatically to V2.
- [VERSE paper](https://arxiv.org/html/2610.02616) and [repository at d8ff0ad](https://github.com/wzekai/VERSE/tree/d8ff0adab0cf82e13d7878f84ff84f823cb2f6c9): executable verification and changed-outcome feedback support a testable optimizer; recursive optimization remains a separate empirical claim.
- [AutoSaddler author discussion on X](https://x.com/sunghopark20124/status/2107493614364631136): a community signal around choosing useful learning problems, not independent performance evidence.

The borrowed lesson is a stronger experimental design: useful failures, real candidate ancestry, execution-grounded feedback, independent evaluation and transferable artifacts. SparkVolve's distinctive research target remains native DSH/Cordis capability evolution and delivery.
