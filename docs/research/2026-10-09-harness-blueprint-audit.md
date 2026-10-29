# Panorama Ecosystem Audit and Design Rationale

> Historical record retained. For the 2026-10-27 ecosystem update, search mechanism, and experimental protocol refinements, see [follow-up in-depth audit](2026-10-27-harness-evolution-design-review.md); the current main diagram already cites the new rationale.

Verification date: 2026-10-09<br>
Main document: [11.md](../../11.md)

## Positioning of This Work

`11.md` is the open-source-oriented target architecture; subsequent code will be refactored according to the diagram. Existing implementations, old run scripts, and historical monitoring do not constrain the design space; existing experiments serve only to distill reusable experience. The main diagram describes the method, structure, and interface relationships; completeness, version compatibility, and experimental results are disclosed by independent materials.

This round modifies documentation only; it does not update experimental rules, model configuration, monitoring, or run code, and does not start tasks. The first round retained the core claims and ①② and rewrote the remaining units; a subsequent line-by-line self-review authorized refinement of the concepts and wording of ①②, with the core claims unchanged. The main diagram removes historical rounds, old concurrency parameters, and failure-postmortem-style phrasing.

Presentation follows the user's latest ruling: the main diagram retains branches, merges, and feedback loops, showing paths such as healthy in-flight / pending scoring / pending research, acceptance success / failure, run validity, and promotion / elimination; conceptual details move into this record, avoiding sequential text boxes replacing the flowchart. The optimizer, experiment control, and executor are designed according to the target architecture, unconstrained by how the old code was implemented.

## Research Positioning

Recommended phrasing: **Treat plugins as operable mutation carriers, drive selection with task feedback, and deliver scenario improvements as installable, composable, and further-evolvable Harness capabilities.**

Research distinctiveness should rest on three testable contributions:

- **Structured mutation space**: uniformly describe plugin configuration, implementation, and composition structure; six action classes support cross-plugin rewriting, deletion, and recombination while preserving service dependencies, scope, and lifecycle semantics.
- **Evolution loop within the native ecosystem**: the optimizer, experiment infrastructure, and executor connect through DSH services, tools, and events; persistent experiment state and Agent sessions each play their own role.
- **From experimental versions to capability distribution**: selected artifacts retain candidate identity, are converted into installable Bundles, and are accompanied by compatibility conditions, reproduction specs, per-task results, and cost.

These are the project's research design and engineering landing points. Existing research already covers code-level Harness optimization, candidate archiving, and optimizer self-update; these individual items should not be claimed as firsts. Whether the method outperforms related work requires subsequent controlled experiments.

## Unit-by-Unit Audit

| Unit | What needed adjustment in the draft | Treatment in the panorama |
|---|---|---|
| ③ Optimizer | Focused on who executed in the past, lacking systematic role relationships | Clarify the three layers of optimization, experiment, and execution; DSH Standard is the optimizer's assembly starting point, and added capabilities form an evolution Preset |
| ④ State | Too much monitoring description; responsibility for the next stage was unclear | Organize the complete loop with persistent stage records; completion-event handoff, periodic reconciliation, recovery by identity |
| ⑤ Attribution | Easy to mistake trajectory interpretation for the cause directly | Combine original input, evidence actually visible to the model, and delivery; reproduce when necessary; distinguish facts from hypotheses |
| ⑥ Investigation | Investigation easily becomes a side branch | Each time center on a mechanism gap, check versions, dependencies, and execution boundaries, and end the research with a testable design |
| ⑦ Mutation | Vague terms such as "knowledge" are imprecise; code-level rewriting was listed separately as a historical supplement | Use explicit objects such as tools, Schema, Prompt, Skills, context projection, events, and orchestration; include implementation rewriting in the six actions |
| ⑧ Candidate | The configuration diagram may be mistaken for the complete identity | Combine code, dependencies, assembly order, actual files, Prompt, Schema, model, and external service identity |
| ⑨ Acceptance | Tool calls and self-filled checks are easily taken as quality proof | Verify actual wiring and delivery, validated against independent task definitions; separate acceptance from formal quality evaluation |
| ⑩ Execution | Fixed historical model and 30 tasks written as a whole-framework definition | General task adaptation and isolated execution; commercial Excel retained as the first domain instance |
| ⑪ Scoring | Historical failure thresholds solidified in the main diagram | Thresholds and retries delegated to the experiment spec; distinguish task failure, infrastructure failure, and scoring service failure |
| ⑫ Selection | Historical cross-task-set promotion easily packaged as paired improvement | Quality-oriented selection, retaining negative results and branches; public gains require comparable conditions |
| A Plugin infrastructure | How the framework itself enters the DSH ecosystem was rather implicit | Task adaptation, candidate lineage, experiment control, and evidence query provide plugin services; distributed via Bundle |
| B Continuous operation | Goal, Schedule, Workflow may be mistaken for a reliable experiment workflow | State each one's capability boundaries explicitly; experiment control handles stage persistence, idempotent advancement, and budget |
| C Evidence and permissions | Session, telemetry, and full model requests conflated | Associate but separate the three evidence types; key requests independently attested; separate authority for optimization, execution, and scoring |
| D Optimizer evolution | A single score gain from the executor alone is insufficient to verify | Version G/H separately, compare at equal budget and same starting point; verify self-update at round boundaries |
| E Research protocol | Generalization evidence sandwiched within run constraints | Express development, selection, and isolated testing independently; ablation, variance, regression, and transfer must all be reported |
| F Open-source delivery | Only a release checklist, lacking an experience path | Three entry points: capability experience, minimal evolution loop, and full research reproduction, with clear installation and licensing boundaries |

Historical execution policy remains in effect; removing fixed parameters from the main diagram does not mean this round modified the policy. Future research protocols must be implemented separately and cannot retroactively rename or cherry-pick historical results.

## Current DSH Facts and Design Implications

This round verified the upstream HEAD via the GitHub API, consistent with the local research copy:

`deepseek-ai/deepseek-harness@5badb15009ae1756c3afe0ae0cef1faafc290ccc`

| Verified item | Current upstream fact | Constraint on the blueprint |
|---|---|---|
| Standard | Declared as a plugin composition of an Agent Preset; includes entries such as tools, Skill, Goal, compaction, and delegation | The evolution Preset should state its own increments; the extended configuration cannot be called an unchanged Standard |
| Plugin management | Can change the entire Profile; some modifications require restart; Standard's management tools are disabled by default | The optimizer edits code and configuration in isolated candidates; it does not directly hot-modify the Profile used by running experiments |
| Goal | Continues when the same session is idle; recovery, fork, or remount does not automatically reactivate; round limit and resource budget are independent | Used as a continuation mechanism for research work; experiment budget, recovery strategy, and independent scoring are handled by the experiment layer |
| Schedule | Depends on Host session control and persistence; receipt confirms persistent enqueue; crash windows may cause duplicate delivery | Wake-up is separated from experiment completion; cannot assume a standalone Headless runs with only a Schedule installed |
| Workflow | Scripts coordinate sub-Agents, currently aggregated in the foreground; no script recovery after process restart, and no cross-subtask Token budget vocabulary | Usable for research subtasks, but cannot directly serve as a persistent experiment engine |
| Session telemetry | Non-blocking, best-effort delivery; queue may be lost on crash; no default redaction rules | Reliable experiment archives are persisted separately; public records state an explicit redaction policy |
| Skills | Registry, Provider, Loader, and content are separate; body loaded on demand | Describe a Skill with concrete instructions, resources, and execution tools; do not treat it as an automatic execution service |
| MCP | Connects external tools and resources via client plugins | Clarify connections, permissions, and external dependencies; MCP itself cannot be treated as a plugin lifecycle manager |
| Compaction | Summary compression, tool-result trimming, image processing, and Token measurement are distinct capabilities | Avoid conflating "context optimization" with server-side caching; whether mutation is allowed is stipulated by the research spec |
| Isolation | Cordis scopes and registered resource lifecycles do not provide a container security boundary | Restricted answers, credentials, files, and network access require actual permission separation |

Fixed source entry points:

- [Standard Preset](https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/packages/bundle/web-app/presets/standard.patch.yml)
- [Cordis communication and extension mechanisms](https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/docs/cordis-primer.md)
- [Plugin management and Profile impact scope](https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/packages/boot/plugin-manager/README.md)
- [Goal continuation driver](https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/packages/goal/goal-round-driver/README.md)
- [Schedule service and persistence limitations](https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/packages/schedule/schedule/README.md)
- [Workflow capabilities and limitations](https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/packages/workflow/workflow/README.md)
- [Session telemetry](https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/packages/session/session-telemetry/README.md)
- [Skill service](https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/packages/skill/skill/README.md)
- [MCP package group](https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/packages/mcp/README.md)
- [Compaction package group](https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/packages/compaction/README.md)

In this verification, the official model page maps `deepseek-flash` to DeepSeek-V4.1-Flash, so it is retained as the reference optimizer. It is a service alias; long-term experiments should still record the responding model information, date, parameters, and vendor changes, and absolute freezing of remote weights cannot be inferred from the alias. [DeepSeek official model description](https://api-docs.deepseek.com/quick_start/pricing/)

## Related Research: What to Borrow, What Phrasing to Avoid

### GEPA

The current README's `optimize_anything` already covers code, architecture, and configuration, emphasizing trajectory feedback, reflection, mutation, and candidate selection. GEPA cannot be reduced to "only changes Prompts," nor should "we can change code" be used as the sole differentiator. Borrow its practice of passing rich execution feedback to the optimizer; this project further clarifies the assembly, scope, and distribution semantics of DSH plugins.

Verified HEAD: `462e437a09be67d2acb59564cc0ea59132f5777c`.<br>
Source: [GEPA README](https://github.com/GEPA-ai/GEPA/blob/462e437a09be67d2acb59564cc0ea59132f5777c/README.md).

### VeRO

The current project separates candidate production, independent evaluation, and version history, and supports optimization of code and other scorable objects; the current system and the paper-era implementation are clearly distinguished. Borrowing its replaceable candidate producer and evaluation boundary, the main diagram adopts the three-layer responsibilities of optimization, experiment, and execution, and retains experiment identity and candidate identity.

Verified HEAD: `d1400011917ff66b7c122e7a787d547372f43e97`.<br>
Source: [VeRO README](https://github.com/scaleapi/vero/blob/d1400011917ff66b7c122e7a787d547372f43e97/README.md). Its benchmark was not run this round, and the gain figures given by the maintainers are not cited to endorse this project.

### VERSE

The 2026-10-02 paper studies the combination of execution verification and optimizer self-update; the actual configuration enables `self_edit` and sets a probe budget. Its idea of linking attribution, verification, and optimizer update can be borrowed. Accordingly, the main diagram retains the G/H two-layer versioning and the independent research mode, and does not directly call "writing experience notes" or "a single candidate's score gain" effective optimizer evolution.

Verified HEAD: `d8ff0adab0cf82e13d7878f84ff84f823cb2f6c9`.<br>
Sources: [paper](https://arxiv.org/html/2610.02616), [README](https://github.com/wzekai/VERSE/blob/d8ff0adab0cf82e13d7878f84ff84f823cb2f6c9/README.md), [actual configuration](https://github.com/wzekai/VERSE/blob/d8ff0adab0cf82e13d7878f84ff84f823cb2f6c9/verse/configs/self_teacher/verse_mh.yaml).

The training, validation, and test designs of these external methods serve only as research references; this project does not copy their task access permissions, probe counts, or retry rules.

## Community Verification Scope and Gaps

- Queried DSH documentation via Context7 and cross-checked key capabilities against the configuration and package documentation of the current commit. Index hits cannot independently prove current assembly behavior.
- The GitHub repository and HEAD were verified on-site; source configuration, official documentation, and paper conclusions are used at separate levels.
- Targeted searches on X for DSH/VERSE/GEPA yielded no verifiable original posts. This round does not claim to have verified community popularity, nor does it fabricate popularity data.
- The DSH issues API returned empty results this round; this is not taken to imply there are no known defects. Behavior limitations explicitly listed in the package documentation are adopted as design rationale.
- Upstream research experiments were not run, and the new experiment control plugin in the blueprint was not implemented. This document completes conceptual audit, architecture design, and wording revision.

## Line-by-Line Self-Review Supplement: Wording, Connections, and Research Semantics

This round re-checked the main diagram line by line; revisions were made on the basis of the same verified DSH version, without re-constraining the target architecture to existing code.

| Check location | Self-review finding | Revision result |
|---|---|---|
| Title and lead | Project introduction, blueprint purpose, and body core claims were repetitive | Condensed the lead, highlighting task feedback, Harness mutation, and capability delivery |
| Core claims | Already clearly expressed the user-approved research direction | Retained the claims and six action classes, without inventing extra slogans |
| ① Experiment spec | Starting point lacked a task list; end conditions were rather implicit | Added task list and stop conditions; the model uses "contract" to express verifiable fixed conditions |
| ② Plugin/Cordis | Easy to think every plugin must provide a service | Changed to providing services on demand, declaring dependencies, or responding to events; emphasized visible service dependencies |
| ③ Roles | The optimizer heading repeatedly described two parties; the experiment layer's position was not prominent | Clarified the three-layer responsibilities of optimizer, experiment system, and executor, with independent accounting |
| ④ Recovery branches | Only "pending scoring" and "continue research," missing scored and incomplete candidates | Scored goes directly to adjudication; existing candidates resume their original stage; new mutation is required to enter attribution |
| ⑤ First entry | Directly required analyzing high/low-score trajectories; the first round may have no trajectories | Clarified forming an initial baseline first; supplement with isolated reproduction when evidence is insufficient |
| ⑤ Attribution wording | "Context" did not state whether it is content actually visible to the model | Emphasized actually visible evidence; facts, correlations, and hypotheses recorded separately |
| ⑥ Research | Heading piled up source names; mechanism goal not prominent | Heading expresses the research purpose; body explains sources, versions, and applicable boundaries |
| ⑦ Mutation | Relationship between tool implementation and Schema, and between replacement and interface migration, was somewhat vague | Clarified the linkage of implementation/interface/caller, retaining space for whole cross-plugin changes and deletions |
| ⑧→⑨ | Entry arrow fell between two boxes, easily misread as parallel | Entry connects to construction, then a horizontal arrow enters acceptance |
| ⑨ Acceptance | Easy to interpret "pass" as an existing score-gain conclusion | Explicitly stated the difference between runnable and quality gain; expected sources kept independent |
| ⑩ Agent Loop | The continue-solving return line and the completion exit were not connected to the same observation node | Split continue/complete paths at the observation result; archive after completion |
| ⑪ Evaluation | Distinction between run status and business quality was not intuitive enough | Distinguish run failure, wrong answer, and scoring service anomaly; clarify full denominator and cost |
| ⑫ Feedback | Only the text "return," lacking a directly recognizable loop | Added a left-side feedback line connecting adjudication, lineage accumulation, and the next round of attribution |
| Stop exit | Stop conditions and release conditions merged | Seal progress after stopping; candidates pending release enter ⑬ separately |
| Support layer | Connected with downward arrows, easily read as post-stages that must execute in sequence | Removed sequential arrows; clarified support and extension throughout the whole process |
| Optimizer evolution | Meaning of G/H depended on reader guesswork | Stated optimizer G and executor H explicitly, maintaining equal-budget comparison and separate versioning |
| Research validation | Isolation between testing and the optimization loop was not clear enough | Explicitly stated isolated tests do not feed back into the same round's selection; regressions and costs disclosed separately |
| ⑬ Release | Only an artifact list, lacking an exit for insufficient evidence | Added frozen candidates, independent validation, release conditions, and retention of limitations and negative results |
| Layout | Local replacements caused two-column border misalignment | Re-checked single-column and two-column widths, connector lines, and complete code blocks |

The final diagram retains the complete flow and distinguishes three visual relationships: arrows indicate execution flow, left-side return lines indicate evolution feedback, and the independent support area indicates cross-stage capabilities. Framework, method, and implementation status are stated separately; when research evidence is insufficient, conclusions are not padded with packaging language.
