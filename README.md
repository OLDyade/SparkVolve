<div align="center">

<img src="docs/assets/brand/logo.png" alt="SparkVolve — an evolving double helix around a spark" width="112" height="112">

# SparkVolve

**Evolve the Harness, Not the Model.**

Keep model weights fixed. Let the harness evolve through real tasks.

**Evolve capabilities. Evolve the way they evolve. Ship both as plugins.**

[![CI](https://github.com/OLDyade/SparkVolve/actions/workflows/verify.yml/badge.svg?branch=main)](https://github.com/OLDyade/SparkVolve/actions/workflows/verify.yml) [![License: Apache-2.0](https://img.shields.io/badge/License-Apache--2.0-202124?style=flat-square)](LICENSE) [![DSH](https://img.shields.io/badge/DSH-Native_plugins-DDEAF5?style=flat-square&labelColor=202124)](docs/components.md)

[English](README.md) · [中文](README.zh-CN.md) · **[Live tour ↗](https://oldyade.github.io/SparkVolve/)** · [Quick start](#quick-start) · [Blueprint](11.md)

</div>

A plugin-based harness evolution framework: agents use real task feedback to reshape their capability structure and turn useful improvements into reusable plugins.

> We used to equip agents with capabilities. Now agents can decide which capabilities they need, which to change, and which to create.

![SparkVolve: fixed model weights, evolving plugin code, configuration and composition, reusable capabilities](docs/assets/readme/hero.webp)

## 🧬 Three core designs

| Plugins are the genes of evolution | Evolution is a plugin | Evolution results are plugins |
|:---|:---|:---|
| **From manual assembly to autonomous restructuring.** Evolve plugin code, configuration and composition together. | **Equip an existing harness with the ability to evolve.** Research, coding and experiments run inside native DSH / Cordis. | **From benchmark scores to installable capabilities.** Carry improvements forward with Bundles, lineage and reproducible evidence. |

**Enable · Disable · Tune · Replace · Compose · Create**

![Six plugin mutation operations chosen from task evidence: enable, disable, tune, replace, compose and create across code, configuration and composition](docs/assets/readme/plugin-mutations.webp)

## 🔁 A harness that evolves harnesses

**The executor can evolve its capabilities. The optimizer can evolve its own approach.**

![Two levels of native Harness evolution: an optimizer changes executor plugins; a separate Optimizer Study compares optimizer candidates through matched searches. Independent evaluation and an experiment controller keep rules fixed.](docs/assets/readme/two-level-evolution.webp)

| Evolution target | What can change | What decides |
|:---|:---|:---|
| **H · Executor Harness** | Business tools, plugin code, configuration and assembly | Independently graded task deliveries |
| **G · Optimizer Harness** | How it investigates, develops plugins and conducts experiments | The H candidates it produces from the same H0 under matched budget caps |

**Discover → Adapt / Author → Compose → Evaluate → Ship**

| 🔎 Discover | 🧩 Compose | 📦 Ship |
|:---|:---|:---|
| Official DSH, community markets, local Bundles and research assets | Exact dependencies, native Bundle layers and observed Cordis service bindings | The evaluated package, its real ancestry and independently checked delivery |

The optimizer chooses what to reuse, change or create. A frozen capability catalog keeps those choices reproducible; native resolution turns them into editable candidates. [Explore Capability Evolution →](docs/capability-evolution.md)

Both run on **DeepSeek Harness / Cordis**. The Controller owns experiment rules, version identity, budgets and records; the Grader evaluates deliveries. Optimizer evolution runs as a separate **Optimizer Study**.

[Native plugin authoring](docs/native-authoring.md) · [Behavioral probes](docs/behavioral-probes.md) · [Optimizer Studies](docs/optimizer-studies.md) · [Architecture](docs/architecture.md)

## 📦 Take the capability with you

**Install it. Inspect its history. Run it on your tasks.**

![Three reusable outputs: Capability Bundle, Evolution Lineage and Evidence Package. A separate Optimizer Study can additionally deliver an Optimizer Bundle for future searches.](docs/assets/readme/evolution-deliverables.webp)

| Deliverable | Inside | Put it to work |
|:---|:---|:---|
| **Capability Bundle · H\*** | Original `bundle.tgz`, source, assembly and capability card | [Install into a fresh DSH Profile](docs/use-capability.md) |
| **Evolution Lineage** | Candidate ancestry, source diffs, proposals and selection decisions | [Inspect a real mutation](docs/experiments/anatomy-of-a-mutation.md) |
| **Evidence Package** | Scores, failures, usage, trace inventories and independent validation | [Audit and reproduce](docs/experiments/README.md) |
| **Optimizer Bundle · G\*** | Selected optimizer source and frozen artifact, from a **separate study** | [Reuse an optimization method](docs/optimizer-studies.md) |

Installed capabilities run in the native Agent Loop. Using them does not require running the evolution process again.

<a id="quick-start"></a>

## 🚀 Start evolving

| Explore an experiment | Run your own |
|:---|:---|
| **[Open the live tour ↗](https://oldyade.github.io/SparkVolve/)** — source diffs, task results and downloadable records. No setup or API calls. | **[Prepare your environment](docs/quick-start.md#preparation)** — clone the repo; Node.js 24, Python 3, Docker, an official DeepSeek key and a reserved private network pool. |

```bash
npm ci
npm start -- --env-file /absolute/private/deepseek.env
```

**One entry: autonomous development → independent validation → original-package installation → fresh reuse.** Defaults: official DeepSeek, structured-data tasks, **600 seconds per task**. Keep credentials outside the repository. First launch builds images; model calls use your provider quota.

**Bring your domain:** 🗂 Tasks + ⚙️ Runtime + 🧩 Seed plugins + ⚖️ Grader.

![Different task domains connect through inputs, runtime, seed plugins and a grader to the same SparkVolve evolution engine](docs/assets/readme/bring-your-task.webp)

Use `--recipe` to select a task setup; implement and validate an adapter for a new domain. [Structured data](docs/structured-data.md) and [Excel](examples/spreadsheet) are examples. Runtime integration is native to DSH / Cordis.

[Full quick start](docs/quick-start.md) · [Add a domain](docs/domain-adapters.md) · [Install a capability](docs/use-capability.md)

## 📊 From source change to shipped capability

A real official DeepSeek run added **`workbook_recalculate`**, backed by LibreOffice, to a read/write plugin. The next candidate refined its tool descriptions.

| Autonomous development | Independent validation | Original-package reuse |
|:---:|:---:|:---:|
| **56.25% → 81.25% → 100%** | **81.25% → 100%** | **4 / 4 tasks passed** |
| H0 → H1 → H2 | Fresh H0 vs. H2 execution | Unchanged archive, clean Profiles |

**[Read the actual source diff →](docs/experiments/anatomy-of-a-mutation.md)** · [Explore every phase](https://oldyade.github.io/SparkVolve/#experiment)

Recorded synthetic-task results. Stable gains, cross-domain transfer and optimizer superiority remain open research questions.

<details>
<summary><strong>Research ledger — results, regressions and remaining work</strong></summary>

| Record | What it establishes |
|:---|:---|
| [Executor evolution](docs/experiments/2026-10-28-official-deepseek-results.md) | Real plugin implementation changes, independent validation and unchanged-archive reuse. This case did not change plugin topology. |
| [Optimizer evolution](docs/experiments/2026-10-28-optimizer-study-results.md) | G1 was autonomously authored, built and run. It tied G0; G0 was retained. Added tools recorded zero native calls. |
| [Mutation-space comparison](docs/experiments/2026-10-29-closure-study-results.md) | Three arms, six searches, twelve patches, 124 task scorings. Five searches retained H0; one candidate passed validation and reuse at 100%. No demonstrated method advantage. |
| [One-command startup](docs/experiments/2026-10-29-official-closure-results.md) | Structured-data search, independent validation and original-package reuse completed; H0 was retained. |

Native dependency composition and real community-package adoption now have behavioral acceptance, including original-package reuse. Stronger autonomous structural-evolution and quality evidence remain open. [Capability integration](docs/experiments/2026-10-30-capability-evolution.md). [Implementation status](docs/completion.md) · [All experiments](docs/experiments/README.md) · [Research protocol](docs/research-protocol.md)

</details>

## 🧭 Build on SparkVolve

| Understand | Extend | Research | Ship |
|:---|:---|:---|:---|
| [Blueprint](11.md)<br>[Architecture](docs/architecture.md)<br>[Components](docs/components.md) | [User journey](docs/user-journey.md)<br>[Domain adapters](docs/domain-adapters.md)<br>[Compatibility](docs/compatibility.md) | [Experiment protocol](docs/research-protocol.md)<br>[Optimizer Studies](docs/optimizer-studies.md)<br>[Evidence index](docs/experiments/README.md) | [Install Bundles](docs/use-capability.md)<br>[Releasing](docs/releasing.md)<br>[Contributing](CONTRIBUTING.md) |

Bring a new domain, a mutation mechanism or a reproducible failure case. [Contribute](CONTRIBUTING.md) · [Open an issue](https://github.com/OLDyade/SparkVolve/issues) · [Security](SECURITY.md)

---

Built on **DeepSeek Harness / Cordis** native plugins. [Apache-2.0](LICENSE) · [Attribution](NOTICE) · [Citation](CITATION.cff). Development version; registry publication and versioned releases are managed separately.
