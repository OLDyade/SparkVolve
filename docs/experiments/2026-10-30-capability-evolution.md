# Capability Evolution Acceptance

[Capability architecture](../capability-evolution.md) · [Machine evidence](../evidence/2026-10-30-capability-evolution.json) · [Experiment index](README.md)

**Discover → Adapt / Author → Compose → Evaluate → Ship** now has native acquisition and composition implementations. Three different checks establish engineering behavior and preserve the limits of the model evidence.

## What ran

| Check | Actual result | Interpretation |
|---|---|---|
| Cross-plugin dependency fixture | Consumer declared before provider; Cordis binds the service; fixture delivery scores 0 → 1; the original package installs and the service executes in a clean Profile | Deterministic integration test, not a model quality result |
| Community Office acquisition | Exact `dsh-office-tools@1.0.8` discovered, resolved, composed and built; four real Excel tool calls before and after original-package installation | Real third-party package integration; maintainer selected the package |
| Official DeepSeek closure | Autonomous source modification, native probes, six search scorings, six independent validation scorings, three installed reuse scorings | 15 fresh task scorings; no demonstrated evolution gain |

Runtime: DSH `0.2.1-rc.4`, Cordis `4.0.5`. The real model used official DeepSeek `deepseek-flash`, thinking off, 32,768 maximum output tokens and a 600-second task budget. Runtime image identity is recorded in the machine evidence. No model tasks were retried or combined across attempts.

## Community adoption

Source: [community index](https://dshopen.org/index.json), [Office Tools repository](https://github.com/kw78/dsh-office-tools).

The resolver invoked native DSH installation in an isolated Profile, retained the exact installed manifest and dependency lock digest, vendored the resolved package bytes into a parent-derived draft, and composed its native Bundle layers with the parent.

Actual tool sequence in both the built candidate and fresh installed package:

```text
excel_create → excel_read → excel_update → excel_read
```

The check preserved a zero value and an explicit formula, changed the selected cell, and opened the resulting XLSX file. **Formula recalculation was not tested or provided by this package.**

Original evaluated and installed package SHA-256:

```text
999f63031ac2975d75fa96e82dd077d76025548fa4dedd3f40007fa4b4b635ac
```

The native Profile must resolve the candidate's dependencies. Directly loading the candidate twice produces duplicate registrations. The implemented binding Bundle contributes an empty patch and a dependency edge to the immutable artifact; explicit candidate layer ordering is applied once. DSH owns module resolution and Cordis owns service activation.

Reproduction entry: `scripts/verify-capability-adoption.mjs` takes an explicit experiment spec, dataset, seed, exact package name/version, probe and image. The Office probe is in [examples/community-office](../../examples/community-office/probe.mjs). This is an engineering check, outside experimental quality means.

## Autonomous model behavior

The optimizer chose direct authoring. It added a spec-driven transform and append mechanism, submitted one changed candidate, and preserved one failed and one passing native probe. H0 and H1 each scored 100% on the three search tasks. Strict selection retained H0.

| Stage | H0 | Selected | Result |
|---|---:|---:|---|
| Search | 100% | H1: 100% | Tie; H0 retained |
| Independent validation | 91.67% | 100% | Both arms are the **same H0 and build** |
| Original-package reuse | — | 100% | Three new reuse instances, same archive |

The apparent validation difference is stochastic variation of the same candidate. It provides no evidence of an improved Harness. The original comparison is retained; the reporter now records candidate/bundle identity separately and prevents identical candidates or identical executable Bundle trees from receiving `strictImprovement: true`.

The real optimizer made **zero discovery and zero resolution calls**. Task traces show shell/file tools and no calls to its newly authored transform or append tools. This run therefore verifies native autonomous authoring and the full delivery path; it does not establish autonomous market adoption or benefit from the added tools.

Search request accounting, including G and H: **145 started / 145 results / 0 failed / 0 unfinished**, 127,757 reported input tokens and 58,386 reported output tokens. These are DSH adapter attempts, not a claim about provider-internal HTTP attempts. Per-arm validation and installed-reuse usage are included in the machine record.

## Failures retained and repaired

- A separate earlier official-model run failed with HTTP 502. Its artifacts remain separate.
- The first community attempt lacked the candidate's native dependency graph. The next attempt exposed duplicate activation. Both original failures remain.
- This completed search could not export its trace because native Profiles contain symbolic links to immutable packages. Operational manifests now record exact link paths, targets and digests without following links; byte access retains its no-follow rule.
- Clean distribution installation exposed required boot peers missing from the package manifest. Explicit runtime dependencies were added; native installation, the installed CLI, optimizer tools and a real native tool invocation then passed.
- A maintainer continuation used the dataset parent directory and failed before model execution. The corrected continuation completed validation and installed reuse from the existing frozen search artifacts. Original startup and continuation receipts were preserved.

The repaired path did not rebuild or mutate the selected Bundle and did not repeat search tasks.

## Next research boundary

This closes the implemented acquisition and native composition mechanisms. It leaves a distinct research question: when an optimizer can discover, adapt, author and compose capabilities, does that freedom improve quality on challenging independent tasks?

The [flagship design](../research/2026-10-30-flagship-evolution-design.md) defines multi-generation lineage, richer tasks and controlled comparisons. Its large benchmark study is not represented as completed by these engineering checks.
