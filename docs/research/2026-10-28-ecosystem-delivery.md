# From Research Results to Usable Capabilities: Recent Ecosystem Review

Review date: 2026-10-28. Scope covers two implementations directly relevant to current delivery; the project's core ideas, promotional positioning, and `11.md` remain unchanged.

## Borrowed Practical Mechanisms

| Project and pinned version | Verified implementation | This project's decision |
|---|---|---|
| [Hermit](https://github.com/Infini-AI-Lab/hermit/tree/6957141db1bda07877e0b989bea375eaf9b7cec2) | [Capability card](https://github.com/Infini-AI-Lab/hermit/blob/6957141db1bda07877e0b989bea375eaf9b7cec2/hermit/trainer/card.py#L8-L41) lists source, training, evaluation, and usage scope from run records | Deliver readable capability cards together with machine research archives; place them alongside the frozen Bundle without repackaging or altering the accepted capability |
| Hermit same version | [Evolver interface](https://github.com/Infini-AI-Lab/hermit/blob/6957141db1bda07877e0b989bea375eaf9b7cec2/hermit/evolver/base.py#L56-L114) expresses workspace, tools, cancellation, session recovery, and results | Native G/DSH already has corresponding entry points; continue using the existing runtime; do not add a parallel Trainer or outer adapter system |
| [ActiveSaddler](https://github.com/microsoft/AutoSaddler/tree/30f6e53e44d844c6adedad9cbcb03f26bead11fa) | [Curriculum selection](https://github.com/microsoft/AutoSaddler/blob/30f6e53e44d844c6adedad9cbcb03f26bead11fa/src/autosaddler/v2/core/curriculum.py#L406-L416) records the training case support set and this round's priorities; [configuration](https://github.com/microsoft/AutoSaddler/blob/30f6e53e44d844c6adedad9cbcb03f26bead11fa/configs/v2/meta_are_activesaddler_full.yaml#L63-L89) separately declares selection, acceptance, evaluation, and budget | May later serve as a native G research-method plugin to select diagnostic targets; the formal full problem set and final evaluation remain fixed by contract. This feedback comparison does not add the curriculum mechanism at the same time |

The above ActiveSaddler code is on the `feat/activesaddler` branch; at review time AutoSaddler main was `e841543ce6cf6bdf690e65134b12a829ec9f66d1`. A research branch must not be written up as a released mainline capability.

Do not copy Hermit's lossy output options and missing-cost defaults; this project continues to preserve raw evidence, unknown usage, and unknown cost. ActiveSaddler's [decision-failure default branch](https://github.com/microsoft/AutoSaddler/blob/30f6e53e44d844c6adedad9cbcb03f26bead11fa/src/autosaddler/v2/core/curriculum.py#L557-L565) is also not ported; failures must be preserved and exposed.

## Capability Card Delivery Conventions

Capability cards are deterministically generated from real export records, helping installers directly answer: where this package came from, under what contract it runs, what was actually tested, and what boundaries remain. Model-generated purposes or assumptions retain source attribution and are not restated as verified functionality.

- Bind source code, build, dependency lock, and original tarball; do not alter capability package bytes.
- Preserve the full task denominator, failures, and current experimental purpose; search scores do not automatically become independent validation or installation recommendations.
- Show unknown when the raw call ledger is missing; the optimizer cost of the entire search must not masquerade as the inference cost of a single capability.
- Build-failure candidates may still deliver research archives, but must not display an installable package that does not exist.
- Model text is presented as data; it must not be allowed to break card structure or become execution instructions.

Cards are a developer deliverable; they do not constitute a new quality gate and do not change version selection strategy. Their implementation and acceptance are recorded separately.

## Use Community Signals and Research Conclusions Separately

[Hermit official release](https://x.com/InfiniAILab/status/2114763933064089697) and [author introduction](https://x.com/haizhong_zheng/status/2114769723879464983) were the discovery leads for this review; an actual GitHub check showed 247 stars / 18 forks, while the search cache still showed 140 stars, indicating popularity data goes stale. Interactions and star counts are not used as evidence of method benefit.

[ActiveSaddler author introduction](https://x.com/sunghopark20124/status/2107493614364631136) focuses on what should be diagnosed next; its value should be further verified with the original code and frozen experiments. [Evaluation research author discussion](https://x.com/yikewang_/status/2107150404819812399) indicates that feedback, inference budget, and task partitioning must be checked; based on this, this project retains [host feedback comparison](2026-10-28-feedback-causal-protocol.md) and independent evaluation. None of the above community opinions enter this project's results table.
