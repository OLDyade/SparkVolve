# Repository collaboration guidelines

## Working baseline

- `OLDyade/spark-harness-evolution` is the primary repository for subsequent design and implementation. Use root `11.md` as the target blueprint and follow the user's latest decisions. The original `spark-harness` directory is a source of historical evidence and implementations to evaluate.
- Preserve the user-defined core ideas. The three core designs and six stated principles are open-ended guidance, not an exhaustive requirements list. Proactively complete the architecture, interfaces, experiments, operations, and delivery details.
- Retain the complete workflow, branches, feedback loops, and technical detail. Explain the evidence and tradeoffs behind design changes; distinguish goals, implemented behavior, hypotheses, and verified results.
- English is the repository's working language: documentation, code comments, examples, CLI messages, diagrams, and generated pages. Root `README.md` and `README.zh-CN.md` are the bilingual entry points; Chinese is confined to these files. Preserve the original Chinese core statements in `README.zh-CN.md` and their meaning in the English blueprint.
- Follow the user's language preference in conversation. Communicate concretely and concisely, without excessive sectioning or unrequested contrastive framing.

## Research and implementation

- Verify unfamiliar, uncertain, or potentially outdated concepts against current official documentation and the actual version's source. Consult GitHub implementations and verifiable community signals; record sources and applicability limits.
- Reuse the native DSH plugin ecosystem. Support enabling, disabling, tuning, replacing, composing, and authoring plugin configuration, implementation, and composition, including joint mutations across plugins.
- Separate generic evolution mechanisms from domain adapters. Excel is the first example; never hardcode task banks, coordinates, or answers into the framework.
- Expose problems early. Do not conceal them with silent degradation, speculative postprocessing, or answer patches. Keep acceptance proportionate to actual risks; additional checks do not replace capability improvements.
- The optimizer autonomously selects problems, parents, and mutations from evidence. The experiment system protects scoring, data access, version identity, and execution records. Plugin scopes do not replace process or system isolation.

## Historical material and commits

- `docs/research/archive/` and `docs/prd/DIAGNOSIS-*` contain historical evidence. Their old monitoring, retry, model, and stage instructions are not active execution policy. Never use them to resume the Jev project or old controllers.
- The original documentation baseline excluded evaluation datasets, answers, credentials, runtime artifacts, and original experiment code. Review boundaries for each subsequent migration and retain provenance and license information.
- Use repository-local GitHub identity `OLDyade <18738624249@163.com>`. Before each commit or push, verify the remote, effective author and committer, and environment overrides. Do not change company-wide Git configuration.
