# What Feedback Actually Brings: A Pre-registered Comparison Protocol

Status: **research protocol, not yet executed or registered as an experimental contract**. This page supplements the methodological validity issues raised by external review, and is kept separate from the completed experiments on the optimizer's own evolution mechanism. The fixed model, real plugin mutations, and independent scoring continue to follow the project overview; no method is presumed to win.

## First Distinguish Three Questions

| Question                     | Evidence required                                              | Current boundary                                                                                                         |
| ------------------------ | ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Can the system modify G and run it  | Native meta-optimizer traces, G code/assembly diffs, actual sub-searches and original package installation | A real Study has run G1; installation acceptance and mechanism defects are recorded separately, see [results](../experiments/2026-10-28-optimizer-study-results.md) |
| Can feedback improve H mutations      | Same starting point, same generation resources, comparison that only changes feedback visibility          | A subsequent real study with two arms on the same G has been completed; the between-group difference comes from execution fluctuation of the same H0, and no benefit was demonstrated; see [full results](../experiments/2026-10-28-paired-feedback-results.md). The full E/B/R protocol on this page has still not been executed |
| Does G self-evolution improve search returns | Develop-select G*, compare G0/G* on new search instances not used for selection       | A single synthetic engineering acceptance and within-task repetition are both insufficient to prove                                                                         |

## Verified Research Basis

- The [AutoSaddler paper](https://arxiv.org/html/2608.23041) distinguishes development selection from final testing, and separately records optimizer calls, task rollouts, and modification results. Different methods have different evaluation frequencies; the same number of iterations does not mean the same cost; [pinned source version](https://github.com/microsoft/AutoSaddler/tree/e841543ce6cf6bdf690e65134b12a829ec9f66d1).
- The [VERSE paper](https://arxiv.org/html/2610.02616) adopts train/validation/test and a comparison between fixed and self-evolving optimizers, while explicitly noting that some comparisons did not match total execution counts and Tokens. Repeating three times in the test phase is not equivalent to independently executing three searches; [pinned source version](https://github.com/wzekai/VERSE/tree/d8ff0adab0cf82e13d7878f84ff84f823cb2f6c9).
- The [AHE paper](https://arxiv.org/html/2604.25850) records modification predictions, actual fixes, and regressions, and studies transfer of a frozen Harness. Its random baseline involves fix predictions and cannot be directly cited as a random program mutation baseline; [pinned source version](https://github.com/china-qijizhifeng/agentic-harness-engineering/tree/8b2a55d97590363fe50c3cc6b5e833b020a4bb4c).
- [Rethinking Evaluation](https://arxiv.org/html/2607.12227) emphasizes a common starting point and evaluation resources, and supports distinguishing same-task sampling from cross-task transfer. Accordingly, this document makes the search instance the unit of comparison.

The above is the basis for the research design; paper results do not enter this project's results table. Verification date: 2026-10-28.

## One Question, Three Explicit Controls

Research question: **Under the same starting point and resource limits, does real task feedback help generate more effective, transferable plugin mutations?**

```text
Frozen model, H0, task family partition, modification space, budget, seeds
                         │
       ┌─────────────────┼─────────────────┐
       ▼                 ▼                 ▼
  E: full feedback       B: blind mutation        R: random action selection
  traces/deliverables/scores    task/source         task/source
  failures/cost        no runtime feedback       no runtime feedback
       └─────────────────┼─────────────────┘
                         ▼
          each arm H0 + 4 mutations, all branching from H0
                         ▼
       common host selection rule → freeze H* → independent test
                         ▼
           instance-paired quality, regressions, full cost and lineage
```

- E/B use the same G implementation, model, and modifiable scope, and only change the runtime feedback exposed by the trusted host. B can still read task requirements, source code, and mechanical build errors, avoiding turning the blind arm into a weak opponent that cannot program.
- R uses a pre-registered random seed to select legal mutation actions, and the model is responsible for producing executable code. It compares "random action selection" and does not claim uniform coverage of the program space. Action legality and handling of no available actions must be fixed before seeing results.
- The first experiment all branches from H0, and E may use feedback from earlier candidates. This avoids leaking superiority information from the selected champion's source code to the blind arm; conclusions are limited to the effect of feedback on mutation generation, and multi-generation recombination is studied separately.
- The same host selector uses search scores to select H* for each arm, keeping H0 on ties. Before all arms' candidates are frozen, the blind arm cannot read the champion, scores, or selection results.
- The main comparison disables behavioral probes; build and mechanical QA are consistent across all arms. Probe value is compared separately, avoiding changing two factors at once.
- G generated by the meta-optimizer requires separate study; here the three methods are frozen first, so that development selection rules do not eliminate control arms before entering the final comparison.

## Budget, Partitioning, and Reporting

The recommended full research unit is two domains, with three independent search repetitions per domain; each arm per instance has 8 search tasks and 16 sealed test tasks, with at most H0 plus 4 mutations. This recommendation corresponds to 18 searches, at most 720 search tasks and 288 H* tests, plus 96 independent H0 tests. **These quantities have not been admitted and will not be automatically started by this document.** The actual contract must first freeze the resource scale and task list; failures, insufficient candidates, and early termination are recorded against the original denominator, with no supplementary sampling.

Task sources, family IDs, split scripts, repetition numbers, and hashes are registered together. Merely changing numbers or adding random prefixes to fields still belongs to the same public task family and cannot support transfer across templates or unknown held-out sets. Synthetic tasks on which the current baseline achieves full marks are used only for mechanism acceptance.

Equal budget is accurately stated as **the same allocation cap**: candidate count, task execution count, optimizer time, concurrency, timeouts, and QA quota are identical. Actual Tokens, requests, runtime, and cost are reported separately; a single-request `maxTokens` is not equal to a cumulative Token cap. Before cumulative limits are implemented, no claim of equal Tokens or equal cost is made.

The main report uses case × full search repetition as the unit, retaining E−B, E−R, paired differences relative to H0, and raw task results. Meta-optimization, G search, H execution, build/QA, and independent scoring are accounted for in separate layers. Missing usage and unknown prices are not recorded as zero; when there are no positive-return instances, "cost per effective improvement" is explicitly unavailable, without hiding total overhead or negative returns.

## Implementation of the General Protocol and Research Boundaries

| Capability         | Necessity and acceptance scope                                                                                                                                                                   |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Host feedback view | Model projection of status, events, submission replay, finish, evidence reading, and materialization has been unified; the raw ledger is retained. Two arms on the same G, 21-way native probing with real run IDs, read-only inputs, and mount checks pass; historical sessions can only continue within the same frozen contract |
| Fixed comparison arms   | `FixedOptimizerComparison` explicitly freezes `methodIdentity + hostSearchProtocol`; the same G with different policies has different arm identities. Actual native search and independent evaluation pass, and the three-arm failure full-denominator regression also passes                 |
| Common selection contract | Ties, failures, insufficient candidates, and early termination have the same pre-registered rule; no arm can obtain extra sampling due to failure                                                                                                     |
| Search instance reporting | Distinguishes task repetition from independent search, outputs paired differences and full cost per instance, and does not use the number of problems to inflate evidence strength                                                                                                       |

These capabilities serve one specific research question and do not constitute an ever-expanding controller checklist. The current Study's `developmentCases → G* → validationCases` is still used for the optimizer's own evolution; the results of the two protocols are interpreted separately and are not merged into a single generalization success.

The comparison unit of `FixedOptimizerComparison` is case × full search repetition. All registered methods have a final evaluation slot; failures and cancellations enter the full denominator; non-terminal scores remain unknown. The fixed-method comparison does not include the meta-optimizer, and its cost is marked as not applicable. The host feedback view and arm identity for the same G have landed; **the E/B/R real-model study on this page has still not been registered or run**, and deterministic acceptance does not count toward research results.

After further checking [VERSE's validation/test division](https://arxiv.org/html/2610.02616#S2.SS2) and the [probe budget ablation](https://arxiv.org/html/2610.02616#A8), two research boundaries are retained: candidate selection within a method and the final comparison between methods are registered separately; multiple tests after the same search do not replace independent search repetitions. The deterministic model fixture in the native container only proves that the registration, search, scoring, and recovery protocols work, and does not count toward method quality results.

## Host Feedback View: Verification and Implementation

An independent read-only subagent verified the actual entry points, and the following wiring has been implemented together in code and tests; pre-implementation risks are retained here for review:

| Actual entry point                                                  | Current risk and implementation requirement                                                                                                              |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| status, submit replay, finish of `controller.ts` / `api.ts` | All may return a complete Candidate or the champion; the unified projection accepts receipts, preventing repeated submission of already-scored candidates from reading out quality                                               |
| `Store.wait()` / events                                   | Events carry scores, promotions, and constraints; the model view needs its own continuous cursor, while host raw events are retained                                                          |
| `evidence.ts` / materialize                               | The same authorization function controls indexing, reading, and raw-byte publication; trace/delivery are forbidden; access to public input by registered task id is added, avoiding blocking legitimate inputs after hiding the run |
| branch / submit.parents                                   | The host enforces a common seed-only research convention; champion selection information cannot be obtained through other candidates' source code                                                         |
| library / probe / domain QA                                 | The first causal protocol jointly disables library and probe; domain behavioral QA also provides feedback, so the purely mechanical control should jointly disable it, retaining only native assembly QA                                 |
| `optimizer.ts` trusted scheduling and mounting                             | Current scheduling also reads status/events and must be separated from the model projection view; the same policy's own previous sessions may be retained, but reusing experiment directories or materialized evidence across policies is forbidden  |

The current registration identity already includes `methodIdentity + hostSearchProtocol`. The same G with different host feedback policies is a legal causal arm; repetition with the same G and same policy still uses `repetitions`. The policy is frozen in the host contract and cannot be modified by candidate plugins; the run main ledger and read-only reports continue to preserve complete results. For the interface and usage, see [host feedback protocol](../feedback-views.md); for the actual run summary, see [machine evidence](../evidence/2026-10-28-feedback-views.json). The first acceptance missed the native Bash required `description`, causing submission failure, and the original report is retained; after fixing the test driver, acceptance was completed in a new directory, without modifying the production protocol or rewriting old results.

When Shell, source code, and public inputs are retained, the optimizer may still write scripts to test its own hypotheses. Therefore this comparison answers **the role of trusted host task feedback** and cannot claim to isolate all autonomous verification. Wall-clock time and resource contention are research limitations; this time they are not pretended to be eliminated by weakening tools, clearing multi-turn memory, or adding pre-written optimization strategies. Acceptance should place distinguishable markers in raw scores, deliverables, and traces, traverse all HTTP/native tools, replay, pagination, and recovery, and then use real containers to check mounting and independent scoring of the two arms.
