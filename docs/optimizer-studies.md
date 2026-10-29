# Let the Optimizer Participate in Evolution Too

The research entry point supports two explicit experimental contracts. **Optimizer self-evolution** has the meta-optimizer generate G, then select G* from development results; **fixed method comparison** freezes all G in advance and runs the full search and independent evaluation for each one. Both reuse native DSH, candidate construction, execution recovery, and accounting, and record their research purposes separately.

| Question to answer                                  | Contract                                                 | Final evaluation object                 |
| --------------------------------------------- | ---------------------------------------------------- | ---------------------------- |
| Can the optimizer improve itself and enhance subsequent search            | `OptimizerStudy`                                     | G* selected in the development phase and G0      |
| How frozen methods or host feedback conditions with the same G affect search results | `FixedOptimizerComparison`, `kind: fixed-comparison` | All registered arms; no arms removed based on intermediate scores |

## Optimizer Self-Evolution

In ordinary experiments, optimizer G rewrites task Harness H. Optimizer Study also places G's plugin implementation, configuration, and assembly into the research space: the native DSH meta-optimizer reads actual search evidence and autonomously submits new G; a trusted host compares them using a common H0 and the same budget cap.

Current status: the real meta-optimizer has generated and run G1, and both development selection and final independent scoring are complete. G0/G1 development scores are both 1.0, and G0 is retained per the rules; final validation is 1.0. Although G1's native tools were registered, they were never actually invoked, and source review also found role and observation scope errors; it is retained as a research record. The original frozen G1/G0/H0 have been independently installed and pass native assembly; for the full denominator, 325 requests, and earlier wrap-up errors, see the [actual research report](experiments/2026-10-28-optimizer-study-results.md); no G self-evolution benefit is claimed on this basis.

```text
Frozen research contract · G0 · H0 · data partitions · per-instance budget
                         │
              native DSH meta-optimizer
       read G sessions / H trajectories / raw deliveries / development feedback
       rewrite G's code, configuration, plugin composition → build and QA
                         │
               G0 and each frozen G1
                         │
          ┌──────────────┴──────────────┐
          │ development research: each G searches from the same H0 │
          │ development search → freeze H* → independent scoring │
          └──────────────┬──────────────┘
                         │ development rules select G*
              close the meta-optimizer control interface
                         │
          ┌──────────────┴──────────────┐
          │ final validation: run only G0 and the selected G* │
          │ new search instances → freeze H* → independent scoring│
          └──────────────┬──────────────┘
                         │
            paired results · complete failures · stratified costs
```

## The Contract Determines Comparison Conditions

The `OptimizerStudy` schema is exported from the package's `study-contracts` entry point. Input paths are all relative to a trusted input root directory; inputs are frozen at initialization and no external modifications are accepted again during the run.

| Field                                   | Convention                                                                                  |
| -------------------------------------- | ------------------------------------------------------------------------------------- |
| `baseline` / `metaOptimizer`           | Source digests, actual build identity, and assembly entry points for G0 and the meta-optimizer. Build artifacts and source are verified separately               |
| `developmentCases` / `validationCases` | Development research and final validation instances. Each instance contains a common H0, a search contract, and an independent scoring contract; the two data paths are separated |
| `repetitions`                          | Number of full search repetitions per method and instance; multiple problems within a single search cannot be counted as multiple independent search experiments        |
| `methodBuild` / `methodQA`             | The actual build environment for new G, and optional independent behavioral acceptance. Native assembly QA always runs                     |
| `metaRuntime`                          | The meta-optimizer's fixed model, runtime image, permissions, and egress; no Docker socket available to candidates                |
| `budget`                               | Number of method candidates, meta-optimizer time, parallel search count; each sub-contract freezes H candidates, probes, and task budgets             |
| `selection`                            | Failure limit for method selection; only the development phase decides G*, and final validation results do not flow back into this round of optimization                   |

All methods use the same instance contract and budget cap, with actual consumption recorded separately. The output limit per model request is not a cumulative Token limit; equal-Token search is not promised here. Failed method builds, failed searches, and incomplete work retain their original state, with no supplementary sampling and no switching back to other methods to mask failures.

## Running and Observing

First prepare the actually frozen G0, meta-optimizer, H0, and research inputs, then initialize:

```bash
node dist/cli.js study-init --root /absolute/new-study \
  --spec /absolute/study.json --dataset /absolute/trusted-inputs

node --env-file=/absolute/private/model.env dist/cli.js study-run \
  --root /absolute/new-study --host 0.0.0.0 --port 18948 \
  --endpoint http://CONTAINER_REACHABLE_IP:18948 \
  --child-host 0.0.0.0 --child-endpoint http://CONTAINER_REACHABLE_IP:0

node dist/cli.js study-status --root /absolute/new-study
node dist/cli.js study-report --root /absolute/new-study --output /absolute/new-report.json
```

Addresses must be replaced with IPs confirmed by the deployer as reachable from containers. `--child-endpoint` explicitly uses `:0`, and each sub-experiment persists its actual port after first binding; recovery uses the original address, and occupancy conflicts raise an error directly. The parent control address also has an independent persistent identity.

Ctrl-C stops host observation and preserves the original containers and attempts. Run `study-run` again with the original arguments to recover; it verifies the original contract, build, and task identities, collects the original containers, and does not resample.

To end the entire study, first stop the active host, then run:

```bash
node dist/cli.js study-cancel --root /absolute/new-study
```

Cancellation acquires the study lease, closes admission of new work, and only handles methods, searches, scoring, and meta-optimizer resources registered in the ledger. After actual stopping, log forensics, and removal complete, a reclamation summary is recorded; if reclamation is interrupted, running the same command again continues along the original identity. Completed research records are retained, and same-named replacements of original containers are not removed as old resources. Ordinary experiments use `cancel --root <experiment>`.

## Fixed Method Comparison

Register all methods to be compared before running; this suits comparisons of different optimizers, plugin configurations, or research mechanisms. Each method uses the same case's H0, tasks, model, candidates, and time cap; each completes its own search, selects H* per the common sub-contract, and then uses the frozen artifacts for independent evaluation.

```text
register all methods + explicit baseline + case × full search repetitions
                         │
        ┌────────────────┼────────────────┐
        ▼                ▼                ▼
       G-A              G-B              G-C
   common H0 search      common H0 search      common H0 search
        │                │                │
   frozen H-A*        frozen H-B*        frozen H-C*
        │                │                │
   independent evaluation          independent evaluation          independent evaluation
        └────────────────┼────────────────┘
                         ▼
        all-arm results · instance paired differences · failures/cancellations · actual costs
```

| Field                        | Content                                                                                                                           |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `kind`                      | Fixed to `fixed-comparison`, explicitly selecting the research protocol                                                                                    |
| `name` / `objective`        | Experiment identity and research question                                                                                                             |
| `arms`                      | At least two `{ id, method, hostSearchProtocol }`; method is the actually frozen source, build artifacts, and assembly entry point, and the protocol controls that arm's host feedback and parent version scope |
| `baseline`                  | The id of the registered arm, which determines the reference for paired reporting; no reselection based on scores                                                                            |
| `cases`                     | Each item contains `id`, a common `seed`, `search`, and `assessment`; the structure is the same as the research instances above                                                   |
| `repetitions`               | Number of full search repetitions per case; repetitions of the same method use this field                                                                           |
| `budget.concurrentSearches` | Host parallel search cap; the actual per-instance budget is determined by the common sub-contract                                                                               |

This contract has no meta-optimizer, development method selection, or new G build configuration; methods are already frozen and cannot fork, be replaced, or submit G during the run. The same G with different host protocols can become two arms, and the host still registers only one real G; repetitions of the same G with the same protocol use `repetitions`. Registration checks reject duplicate arms, duplicate method-and-protocol combinations, unregistered baselines, and crossings between the public method/seed directory and the sealed data directory.

`comparisonArm` separately identifies fixed comparison arms, and `method` preserves G's content identity. The host verifies each arm's complete sub-search contract after applying the protocol at registration; reports are paired by registered baseline arm, preserving method and protocol, to avoid merging two conditions with the same G. For development-selection studies, `comparisonArm` is `null`.

Every new sub-Experiment must fill in `hostSearchProtocol`; every fixed arm must likewise declare it. No default fields are backfilled or silently migrated for old registrations; old studies retain their original files and corresponding code versions, and their JSON cannot be modified to continue using the old identity.

Initialization and reporting still use `study-init` / `study-report`. Running only needs the sub-experiment connection address:

```bash
node dist/cli.js study-init --root /absolute/new-comparison \
  --spec /absolute/fixed-comparison.json --dataset /absolute/trusted-inputs

node --env-file=/absolute/private/model.env dist/cli.js study-run \
  --root /absolute/new-comparison \
  --child-host 0.0.0.0 --child-endpoint http://CONTAINER_REACHABLE_IP:0

node dist/cli.js study-report --root /absolute/new-comparison \
  --output /absolute/new-comparison-report.json
```

All case × repetition × arm work is registered before execution. Run failures, active cancellations, and incomplete states are each retained; terminal failures enter the full denominator at the pre-registered failure value, and paired results still in flight are not treated as completed means. Re-entering the same contract collects the original work without resampling. The cost of no meta-optimizer is explicitly not applicable; missing usage for search and independent evaluation remains unknown.

Fixed comparison uses **case × repetition paired blocks**: each block contains all registered arms, and dispatch order rotates by repetition number; two arms and two repetitions correspond to AB/BA. Within a block, `concurrentSearches` is observed, and the next block runs only after the previous block reaches a terminal state, avoiding running one entire method before switching to another. The plan is persisted before the first dispatch, and actual execution still records events such as the original `job.searching`; recovery reconnects to existing work, preserves terminal states, and does not change order based on scores. When in-flight work exists without a corresponding dispatch plan, it is explicitly rejected, and historical plans cannot be fabricated. Shared load and vendor timing noise still need to be disclosed in the research report.

Fixed method comparison only provides an executable experimental protocol and **does not automatically prove the benefit or causal effect of the compared methods**. Feedback controls with the same G are constrained in state, events, submission replay, and evidence entry points by the [host feedback view](feedback-views.md); source and public inputs remain available for autonomous testing. For the related research design and not-yet-admitted scale, see the [feedback causal protocol](research/2026-10-28-feedback-causal-protocol.md).

The [real feedback trial registration instructions](experiments/2026-10-28-feedback-study-registration.md) provide an independent driver: first perform a contract/image precheck with no model calls, then explicitly execute a real model search in a fresh directory. The statistical unit is the full search repetition; a single artifact's scores on multiple tasks cannot be expanded into multiple independent evolutions.

The actual Docker + DSH fixture has passed three-method acceptance: two methods completed search and independent scoring, and the intentionally failing method retains its denominator and failure value; of 16 requests, 15 returned and 1 failed. Before and after terminal-state re-entry, the 35 execution/request evidence items and the manifest are unchanged, and the meta-optimizer interface was not opened. The 6 runtime files listed in the image match the local build; the [machine record](evidence/2026-10-28-fixed-comparison.json) limits the scope of this acceptance. The failed arm lacks an independent scoring ledger, and usage completeness remains false; it was not interpreted as a zero-cost success.

## What Capabilities the Meta-Optimizer Gets

| Native tool                                   | Purpose                                                                  |
| ------------------------------------------ | --------------------------------------------------------------------- |
| `optimizer_study_status` / `wait`          | Read methods, development instances, budgets, and committed event cursors                              |
| `optimizer_study_search`                   | View H candidates, tasks, probes, and real G episode indices of registered development searches            |
| `optimizer_study_evidence` / `materialize` | Read raw evidence or publish original-byte read-only files; G sessions and H task trajectories use different reference types |
| `optimizer_study_branch` / `submit`        | Create G source drafts and submit code and assembly mutations; after freezing, build and run independently             |
| `optimizer_study_finish`                   | Close development after all accepted development work ends; only then does the host enter final validation                  |

`branch` returns the actually available `/workspace/<draft>`, parent candidate/source/method identity, parent assembly entry point, and `targetRole: search-optimizer`. This is a draft of the inner search optimizer; the running meta-optimizer remains frozen. Replaying with the same parent and same name preserves existing edits. `finish` uses native DSH `concludeTurn()` only after the controller successfully accepts and the call is not cancelled; HTTP rejection keeps the current research session.

Evidence authorization comes from registered methods, search contracts, and actual execution identity. Tools do not provide private graders, assessment files, or final validation data. The meta-optimizer can read development method scores for selection; it cannot read the private validation materials behind those scores.

`study-report` aggregates meta-optimizer cost, G search cost, and independent scoring cost separately. Missing request ledgers or usage fields are explicitly preserved; missing is not interpreted as zero consumption. Actual model benefit, method causal effects, and cross-task transfer still require pre-registered research and independent repetition support.

For ecosystem sources, design trade-offs, and evidence boundaries, see [G/H research basis](research/2026-10-28-optimizer-self-evolution.md).

The acceptance driver for completed experiments can independently continue installation checks: `node scripts/verify-optimizer-study.mjs --verify-completed <original experiment directory> --root <fresh acceptance directory> --framework-package <frozen support package.tgz>`. This path does not call `study-init`, `study-run`, or models; it uses the originally registered Profile and the original G/H tarballs, verifies the original evidence digests, and outputs a new receipt. If any package installation fails, the error is preserved and checks of other independent packages continue; overall failure is not changed to pass. It does not modify old scores, old failures, or candidate code.
