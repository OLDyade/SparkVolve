# Pluginized Harness Self-Evolution: Mechanisms, Experiments, and Open-Source Positioning Review

Date: 2026-10-27. Corresponding main diagram: [11.md](../../11.md).

Sync note: This document comes from design research for the original experimental project; historical results and execution policies are cited in their original context. The policy snapshot is for traceability only and does not authorize this repository to restore old monitoring or experiments; the original evaluation data and run artifacts were not synced. The migration only adjusts policy links and their identifiers; sources are in the [sync record](archive/README.md).

## Scope and Conclusions of This Update

This update covers the target architecture and the basis for subsequent refactoring. It retains the user-approved core claims, six mutation actions, the complete ASCII flow, and feedback loops; it adds parent version selection, linked mutation, evidence reuse, candidate identity, and research validation. No run code, current execution policy, champion, scorer, or monitoring was modified, and no experiments, re-verification, or isolated tests were started. Jev is retained only as historical failure analysis material; that special project is not restored.

The current blueprint defines the method design; benefits still await experimental proof. Subsequent contributions should be organized around three questions:

1. **Is linked mutation more effective?** Using native plugins' service dependencies, scopes, events, and call relationships to jointly modify configuration, implementation, and composition structure, can it outperform restricted mutation and whole rewrites that do not use these relationships under the same budget?
2. **Can evidence accumulation improve search?** By retaining candidate lineage, plugin variants and their applicable combinations, and failure conditions at the same time, can it reduce repeated failures and improve search gains on independent tasks?
3. **Can capabilities be reliably delivered?** After independent validation and clean installation, can the frozen version still deliver the corresponding scenario capabilities, and which gains are transferable?

These three are testable research hypotheses. Native Cordis integration itself provides engineering distinctiveness; method contributions require controls and cannot be established merely by switching the runtime framework.

## 1. What Recent Related Work Changed in Our Judgments

| Work and evidence read | What was verified | Impact on this project |
|---|---|---|
| [PluginRSI paper v2](https://arxiv.org/html/2609.32423v2), [official implementation](https://github.com/syr-cn/PluginRSI/tree/bafab39e4c62b7f0aa252f2ffd891886b45c82f8) | Explicitly cites DSH; alternates search between single-plugin mutation, a shared plugin library, and workflow recombination. The paper's plugin representation includes YAML specs and Python implementations; the code read defines Role, Skill, Tool, and Memory interfaces | "Pluginized evolution / recombine after accumulation" already has a highly similar method. Comparison should focus on native runtime relationships, cross-plugin joint migration, and context-dependent reuse evidence; we cannot claim these research hypotheses already outperform PluginRSI |
| [GEPA optimize_anything](https://github.com/gepa-ai/gepa/tree/d7918ba2f382d5d0652c10814bb278c1c7ffa7c3), [maintainer's omni explanation](https://gepa-ai.github.io/gepa/blog/2026/07/22/optimize-anything-omni/) | Supports text objects such as code, configuration, and Agent architecture; provides multi-engine and compositional optimization interfaces | GEPA cannot be described as only modifying prompts; parent candidates, proposers, and search strategies should be independently configurable, and strategy switches must be recorded within the established budget |
| [VERSE](https://arxiv.org/html/2610.02616), [repository](https://github.com/wzekai/VERSE/tree/d8ff0adab0cf82e13d7878f84ff84f823cb2f6c9) | Combines executable probes with optimizer self-modification; separates training, validation, and test, and limits validation feedback | Retain optimizer self-evolution as extended research; must compare the search effectiveness of old and new optimizers, and cannot infer optimizer improvement from a single score gain by the executor |
| [HarnessOpt-Bench](https://arxiv.org/html/2608.06301) | Measures optimization capability using a protected execution environment, fixed evaluation budget, and invisible test partitions | Fix run identity, feedback permissions, and budget definitions; keep final test and search scores separate, and candidate records must be auditable |
| [Rethinking the Evaluation of SparkVolve for Agents](https://arxiv.org/html/2607.12227v2) | Discusses extra search budget, simple task-level search controls, and insufficient generalization under its task and model conditions | Add equal-budget controls; separate offline search cost from deployment inference cost, and limit conclusions to the tested conditions |
| [VeRO](https://github.com/scaleapi/vero/tree/d1400011917ff66b7c122e7a787d547372f43e97) | Separates candidate generation, evaluation, and history | The optimizer can serve as an end-to-end research Agent; a trusted experiment service controls execution, scoring, and result submission |

The PluginRSI official README records the paper's first release as 2026-09-26, code release as 10-07, and project page as 10-18. The 10-18 date from search engines cannot be uniformly treated as the paper's first release date. This verification covered the README, interface definitions, and paper algorithm; its results were not reproduced; the repository's existence does not prove every implementation was reviewed line by line.

AFlow, AgentSquare, and DGM's workflow search, module recombination, code self-modification, and archive exploration remain necessary background; see [prior discussion basis](2026-10-09-harness-blueprint-audit.md). This round additionally checked PluginRSI and recent evaluation research to avoid defining the competitive scope only with early papers.

## 2. DSH Mechanism Verification and Design Implications

This round pinned DSH commit `22ddee3792402c3e70ec5f86a63c3e3e895a2f60` via the GitHub API, combined with Context7 retrieval, and re-read that commit's architecture, configuration, and package documentation. The old review's `5badb...` is retained as history and does not serve as the latest fact.

| Concept | Verification boundary | Plan handling |
|---|---|---|
| Profile / Bundle | Profile composes Bundle, Profile patch, home patch, and command-line overrides in order; a config matching an ID is replaced as a whole item | Freeze the actual effective tree and all configuration layers; cannot save only a single patch |
| Preset | The Agent's sub-plugin composition; contributions are determined by scope and assembly | A dedicated Evolution Preset explicitly lists research, editing, validation, and experiment service entry points |
| Standard / Cordis | The current Standard includes files, Shell, Skills, etc.; the Cordis preset additionally assembles `dsh-tool-cordis` and related Skill paths. Plugin management tools are also affected by `profileContext` | Can start from Standard, with the actual composition as final; verify coding capability and Cordis runtime inspection capability separately |
| SystemPrompt | Assembled at each step; dynamic facts can refresh before admission; tool Schema is provided by service and scope | Separate static candidate freezing from dynamic request tracing; record the actual model requests sent and the effective tool surface |
| Goal | Continues within the same session; not automatically activated after restore, fork, or remount | Experiment recovery cannot rely on Goal restarting itself; the host starts stage jobs within the authorized scope and explicitly records continuation status |
| Schedule | Requires a running Host, persistent storage, and session activation; the current SDK has its own recovery handler, and Web has a Session controller; crash windows may cause duplicate delivery | Correct the old diagram's overly narrow statement of "depends on Web Host"; deduplicate by execution identity and reconcile actual artifacts |
| Workflow | Current documentation explicitly states no script journaling/resume | After process restart, the experiment layer restores stages; cannot claim automatic resumption of the script's internal position |
| Cordis scope | Manages visible services, contributions, and lifecycle | File, network, credential, container, and process permissions are enforced independently; unload does not undo external side effects that have already occurred |

Pinned sources: [architecture](https://github.com/deepseek-ai/deepseek-harness/blob/22ddee3792402c3e70ec5f86a63c3e3e895a2f60/docs/architecture.md), [Standard](https://github.com/deepseek-ai/deepseek-harness/blob/22ddee3792402c3e70ec5f86a63c3e3e895a2f60/packages/bundle/web-app/presets/standard.patch.yml), [Cordis](https://github.com/deepseek-ai/deepseek-harness/blob/22ddee3792402c3e70ec5f86a63c3e3e895a2f60/packages/bundle/web-app/presets/cordis.patch.yml), [SystemPrompt](https://github.com/deepseek-ai/deepseek-harness/blob/22ddee3792402c3e70ec5f86a63c3e3e895a2f60/packages/core/system-prompt/README.md), [Goal](https://github.com/deepseek-ai/deepseek-harness/blob/22ddee3792402c3e70ec5f86a63c3e3e895a2f60/packages/goal/goal-round-driver/README.md), [Schedule](https://github.com/deepseek-ai/deepseek-harness/blob/22ddee3792402c3e70ec5f86a63c3e3e895a2f60/packages/schedule/schedule/README.md), [Workflow](https://github.com/deepseek-ai/deepseek-harness/blob/22ddee3792402c3e70ec5f86a63c3e3e895a2f60/packages/workflow/workflow/README.md).

The current [DeepSeek model page](https://api-docs.deepseek.com/quick_start/pricing/) points `deepseek-flash` to `DeepSeek-V4.1-Flash-1017`. The blueprint retains the V4.1 series as the reference optimizer; each experiment explicitly specifies the provider, model identifier, parameters, date, and available service version. Response request IDs and returned model names are used for traceability and cannot independently prove that remote weights are fully fixed. When service drift occurs, mark comparability and do not treat it as plugin gain.

## 3. General Design Requirements Extracted from Existing Experiments

The following is based on review of existing local reports; no tasks were rerun, and no restricted answers were read. Historical results serve only as design motivation.

| Historical evidence | Judgment it can support | Impact on the plan |
|---|---|---|
| [176 fixed five tasks](../prd/DIAGNOSIS-Round176-Fixed5.md): same-version anchor single task 98.59%, that task in the extended round 45.07%; five-task mean 60.16%, historical 70.412% | A single-task high score did not stably translate into batch gains; historical concurrency conditions also differed | Separate search records from stability conclusions; for external validation, pre-fix the task set, contract, and repetition protocol |
| Same report: the model performed internal computation, but some metrics in the delivery remained empty; target identity mismatch | Self-filled checks, verbal completion, and tool call counts cannot prove that actual delivery is correct | Attribution must link input, actually visible evidence, actions, and delivery; acceptance expectations must come from an independent source |
| [179 controlled comparison](../prd/DIAGNOSIS-Round179-Controlled-Ablation.md): off/source/live five tasks each, means 75.594% / 63.760% / 35.096%; live included two startup protocol failures | The extra auxiliary package brought no overall gain in that round; protocol failures and business quality must be separated | Record the applicable combinations of failures and gains; cannot infer independent causality of each module from a whole-package comparison |
| [Original experiment execution policy snapshot](archive/evolution-policy-2026-10-27.md) records that an old QA snapshot masked completed formal results | Continuation based only on prompt or old PID is unreliable | Cross-reconcile experiment stages with actual artifacts; adjudicate directly after scoring completes, and investigate execution status when no artifacts exist |

The original execution policy of "promote only on strict quality improvement, report cost only" remains in effect. The re-verification, isolated testing, migration, and release protocols in the new document are future research designs and must be registered separately before activation; this update does not trigger these experiments, nor does it retroactively change historical champions and reports.

## 4. Search Method: Parent Versions, Linked Scope, and Reusable Evidence

### Minimal Executable Loop

| Decision | Default behavior and records |
|---|---|
| Where to start | Without evidence, run the initial baseline first. Usually deepen from the search champion; a historical branch may serve as a parent version when there is concrete basis in target mechanism, capability complementarity, or lower coupling. Record sources item by item for multi-parent inheritance |
| What to prioritize | Considering failure impact, evidence strength, observable improvement, and implementation/evaluation cost, list the reasons for the choice. Priority serves quality; subjective estimates must not be disguised as accurate gain predictions |
| How to define linked scope | Trace back from the target behavior to tool implementations, Schema, Prompt, Skills, service providers/consumers, scopes, and event wiring; clarify which relationships are verified and which require runtime validation. Dynamic calls cannot be claimed to be fully covered by a static tree |
| How to generate mutations | Enable, disable, tune, replace, combine, and create can occur simultaneously; whole rewrites, complexity removal, and interface migration are allowed. Record parent version, change set, expected behavior changes, counter-evidence conditions, and budget |
| When to add probes | When evidence is insufficient to distinguish key hypotheses, use development data or synthetic fixtures for necessary reproduction; clarify what can be discriminated. If existing evidence is sufficient, build candidates and do not make single-factor experiments a prerequisite gate for every round |
| How to choose the next step | Valid scores update the search champion per the spec; failed candidates retain results, failures, and invalidated hypotheses. After consecutive stagnation reaches the spec's preset conditions, switch mechanism, parent branch, or proposal strategy; do not advance by re-sampling scores without changes |
| What to reuse | Candidates are reproducible as a whole; the plugin variant library stores immutable implementations, dependency/applicable combinations, original evidence, and counterexamples. Whole-package score gains only prove the observed result of that combination; after extracting a single plugin, re-accept the combination and do not directly inherit the score |
| How to stop | Persistently record when the goal is reached, budget is exhausted, authorization stops, or a blockage cannot be resolved autonomously; stopping and release are judged separately. Repetition counts, stagnation conditions, and recovery budget are declared before the experiment starts |

The minimal implementation can propose candidates serially while retaining all six actions. Parallel candidates, parent version sampling distributions, and multi-engine composition are replaceable search strategies; in the same research comparison, fix the strategy version, budget, ordering, and tie-breaking rules to avoid completion order determining the winner. Candidate diversity is for exploration; the champion is still selected by the declared quality standard.

### Core Artifacts

| Artifact | Minimal content |
|---|---|
| ExperimentSpec | Task list and partitions, comparison baseline, model/environment contract, mutable objects and invariants, feedback permissions, quality metrics, budget, repetition/failure/stop/release rules |
| MutationProposal | Parent candidate, evidence references, mechanism hypothesis, six-action set, cross-plugin linked scope, expected trajectory changes, counter-evidence conditions |
| CandidateManifest | Source and dependency hashes, Profile/Bundle/Preset and override order, actual loaded tree, static Prompt/Skill resources, image and tool environment |
| RunRecord | Spec, candidate, data, task, repetition and attempt identity, process/container/Session handles, stages, actual requests and deliveries, usage, and failures |
| SelectionRecord | Full scoring denominator, comparison conditions, results, decision rationale, champion reference, regressions, and uncertainty |
| VariantEvidence | Plugin variant, the joint change that produced it, tested combinations, observed gains, counterexamples, and reuse limits; explicitly mark when independent causality has not been tested |

These are semantic requirements for subsequent interfaces; a unified machine-readable Schema is not yet claimed to be implemented. Each rule is versioned by ExperimentSpec; run records reference it to avoid multiple prompts and state files duplicating conflicting policies.

## 5. Identity, Isolation, and Reliable Continuation

Candidate identity is determined by executable content and the assembly manifest. Experiment spec, data, and repetition number belong to run identity; the same candidate can legitimately participate in multiple pre-registered runs. Secrets are managed via credential references and do not enter manifests, hash inputs, prompts, or public logs.

At the model call boundary, the runtime records actual requests and Schema, loaded Skills, tool executions, and available response identity. When deduplicating content, retain complete parseable references. Dynamic context changes with task and step; a single startup snapshot cannot replace the full trajectory, nor is it required that prompts be identical across tasks. Native compaction, truncation, and caching are recorded separately to avoid treating inferred context as what the model actually saw.

The experiment layer holds immutable candidates, task inputs, and protected scoring configuration; the optimizer writes only to the candidate area, the executor can access only the approved inputs and delivery directory for the current task, and the scoring side independently holds evaluation materials. Plugin distribution uses the DSH mechanism; trusted control and scoring can be provided by independent restricted processes and must not share unrestricted permissions with candidate code.

Stage progression covers at least: `proposed → built → validated → running → completed → scored → selected/rejected`; also record `build_failed / validation_failed / run_failed / scoring_pending / cancelled / blocked`. Run completion and business correctness are separate; deliveries with business errors can still enter scoring normally.

Experiment control establishes exclusive records by execution identity, and submitted jobs carry a queryable stable identifier. When the host crashes or the submission receipt is lost, first check the job handle, container labels, and artifacts; when status is unclear, expose it for investigation and do not blindly resubmit. Idempotent registration does not guarantee strict exactly-once external side effects. Retries create new attempts per pre-registered rules, fully retain old attempts, and do not splice and cherry-pick successful results.

Results are linked to scoring via persistent submission records; scoring failures only re-run scoring, and healthy tasks remain frozen. Goal/Schedule are continuation or wake-up entry points, and the experiment control service handles reconciliation and stage recovery. The executor cannot hide the original failure by changing the candidate ID.

## 6. Exploration Selection, Research Validation, and Release

### Data and Feedback Permissions

| Partition | Content visible to the optimizer | Control requirements |
|---|---|---|
| Development set | Approved inputs, trajectories, deliveries, diagnostics, and scores | Do not read restricted reference answers; all model probes and evaluations count toward search cost |
| Selection set | Pre-agreed aggregate metrics and restricted feedback | Fix query budget and feedback granularity; by default do not return task text and step-by-step trajectories; public tasks also require constraining network/file access |
| Isolated test | Invisible during search, ultimately executed by an independent research process | Test after freezing method and candidates; once any test feedback is used for subsequent design, that data is registered as seen, and new validation requires separate data not involved in optimization |

Directory separation only provides organization; trusted processes and access control enforce permissions. Public benchmarks still carry pretraining contamination and prior exposure risk, which cannot be ruled out by access logs alone; this should be disclosed, and validation supplemented with new task sources or time splits. Limited queries on the selection set may still overfit; the quota cannot be described as a generalization guarantee.

### Three Conclusions Stated Separately

| Level | Determination and use |
|---|---|
| Search champion | Updated per the validity and quality comparison rules pre-agreed for this experiment; recorded as the best observed candidate in search, without directly claiming stability or module causality |
| Research gain | Pair baseline and frozen candidate on the same tasks and same contract; pre-register repetition, aggregation, and interval estimation methods; for multi-candidate selection, additionally test with an independent test. Repeated validation still cannot eliminate same-set selection bias |
| Release version | Decide whether to recommend based on scenario delivery requirements and research evidence; verify installation, permissions, applicable environment, source, and license. With insufficient evidence, an experimental framework and negative results may be released, explicitly making no capability gain promise |

Quality is the primary goal; Token, call count, elapsed time, and cost are reported separately. To answer efficiency questions, a quality-cost relationship may be plotted separately; do not impose Pareto multi-objective selection on the current quality promotion rules. Total search cost covers the optimizer, probes, all candidates, failures, and evaluation; deployment cost is calculated per task. Set budgets separately for the two and report actual consumption; "same call count" cannot substitute for identical compute.

### Controlled Studies

| Control | Question answered |
|---|---|
| Fixed baseline | What are the original capability, variance, and actual cost |
| Prompt/Skill-only, Config-only, Implementation-only | What gains each restricted mutation space can achieve; define modifiable files and fields item by item; they do not form a natural nesting hierarchy |
| Full joint mutation | Whether allowing six actions and linked migration can improve final independent quality and search efficiency |
| Same full space, removing dependency/scope information | Whether native structural information helps propose effective candidates; keep other proposal capabilities and budget consistent |
| Same full space, disabling historical variant reuse | Whether the reuse mechanism reduces search cost or improves results; control initial resources and historical exposure |
| Same proposer, randomly selecting parent version/action | Whether evidence-guided selection is effective; specify the random distribution, validity checks, and budget, and avoid using random code corruption as a weak baseline |
| Task-level multiple solving under legitimate feedback | Whether offline evolution is worthwhile compared with increasing inference budget; answer selection may use only equally approved feedback, and test answers cannot be used as a selector |

Controlled studies should also include properly adapted existing optimizers. Due to task adaptation cost, the most discriminative comparisons may be done first, but the full method claim requires corresponding evidence. Multiple independent search repetitions and inference repetitions of the same frozen candidate answer different questions and are reported separately. When tasks have shared workbooks or near-duplicate families, partition and estimate uncertainty by source group to avoid treating many correlated cells as independent samples.

## 7. Commercial Excel Adaptation Boundaries

The [SpreadsheetBench 2 official instructions](https://github.com/RUCKBReasoning/SpreadsheetBench-2#readme) require recalculating input and reference files before experiments and refreshing output caches before evaluation. Reference file preparation is completed only in the protected scoring environment; the optimizer and executor do not thereby gain answer access. Retain original inputs, normalized inputs, actual deliveries, and recalculated copies used for scoring, each with its own hash, and fix the recalculation engine, version, and parameters to avoid contaminating sources or treating engine differences as capability gains.

The [official metrics page](https://spreadsheetbench.github.io/) distinguishes Modif and Acc: numeric Modif is the match ratio of computed values for target cells, while Acc measures complete task output; Visualization is evaluated with a rubric and has a different meaning, which must be explained when aggregating. The adapter documentation must clarify the PASS item derivation, retention-rate denominator, failure scoring, and task averaging; they cannot be collectively called "complete task accuracy".

Current instances cover Template, Financial_Model, and Debugging; we do not claim support merely because the official site includes Visualization. When visualization is integrated in the future, separately list the official Windows Excel/WPS COM export, VLM model, rubric, and scoring variance protocol. The above technical verification does not modify the official Evaluator or Minimal.

## 8. How External Review Maps to This Update

| Comment | Handling in this update |
|---|---|
| Selection variance, repeated use of data | Adopted; add independent research protocol and feedback budget; current search promotion keeps the original rules |
| Candidate behavior freezing | Refined into static assembly freezing + actual request tracing; avoid incorrectly grouping dynamic requests under the same static hash |
| Separation of powers and state machine | Add identity, submission reconciliation, stage, and permission responsibilities on top of the existing design; do not treat wake-up as execution completion |
| Split major changes into single factors first | Retain on-demand probes and ablations; allow evidence-supported cross-plugin whole mutation |
| Do only Prompt first, search strategy last | The minimal loop retains six actions and defines parent version and feedback utilization rules from the first version |
| Four-layer architecture replacing the whole diagram | Retain the complete flow and loops, clarify roles in ③; the bottom continues to carry cross-stage infrastructure, extended research, and release |
| Rewrite core claims | Retain user-approved claims; place method hypotheses, current evidence, and limitations into the research protocol |

X/Twitter was searched in a targeted way for Harness evolution, PluginRSI, HarnessOpt-Bench, etc. Results contained much broadly related or irrelevant content; this round obtained no verifiable original posts sufficient to support judgments about these methods' gains or relative popularity, and engagement volume is not used to endorse the design. The main basis uses original papers, official implementations, and local historical reports.

Git HEADs verified in this round: DSH `22ddee3792402c3e70ec5f86a63c3e3e895a2f60`; PluginRSI `bafab39e4c62b7f0aa252f2ffd891886b45c82f8`; GEPA `d7918ba2f382d5d0652c10814bb278c1c7ffa7c3`; VERSE `d8ff0adab0cf82e13d7878f84ff84f823cb2f6c9`; VeRO `d1400011917ff66b7c122e7a787d547372f43e97`. HEAD verification, reading specified files, and experimental confirmation are different evidence levels; this round did not run these external projects or new experiments in this project.
