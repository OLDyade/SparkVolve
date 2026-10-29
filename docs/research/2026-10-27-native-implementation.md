# DSH Native Implementation Verification and Engineering Decisions

This record supports the code implementation; the project's core ideas follow the original wording of [`11.md`](../../11.md). Historical experiment scores were not used to substitute for acceptance of the new implementation.

## Version Facts

| Object | This Verification | Decision |
|---|---|---|
| DSH GitHub source | `22ddee3792402c3e70ec5f86a63c3e3e895a2f60` | Reference a fixed commit to avoid drift with main |
| npm `@deepseek-ai/dsh-sdk-client` and native plugins | `0.2.1-rc.4`, released 2026-10-26 | Actual execution follows the lockfile and npm release artifacts |
| Cordis / Schemastery | `4.0.5` / `3.18.5` | Use native plugin registration, dependencies, and disposal |
| Node / npm | `24.16.0` / `12.2.0` | Cross-platform native tests; Docker base image pinned by digest |

API differences exist between GitHub HEAD and the npm release artifacts. For example, the split tool execution package in the source has no corresponding npm release artifact; the actual rc.4 `dsh-tools.ToolRuntime` provides the execution entry point. The repository does not splice together interfaces from different versions.

Primary sources: [DSH fixed source](https://github.com/deepseek-ai/deepseek-harness/tree/22ddee3792402c3e70ec5f86a63c3e3e895a2f60), [npm SDK](https://www.npmjs.com/package/@deepseek-ai/dsh-sdk-client/v/0.2.1-rc.4), [model adapter source](https://github.com/deepseek-ai/deepseek-harness/tree/22ddee3792402c3e70ec5f86a63c3e3e895a2f60/packages/llm/llm-pi-ai). The types, implementation, and native process of the actually installed package were jointly verified.

## Facts Affecting the Architecture

| Mechanism | Verification Result | Corresponding Implementation |
|---|---|---|
| Profile / Bundle | Profile is assembled by layers; Bundle declares `dsh.bundle.patch` in package.json | Evolution packages and candidates are both native Bundles; after export, verify with `dsh plugin --profile … add` |
| Provider configuration | The default SDK Profile already has `llm-pi-ai`; override the providers configuration of that node | The Venus environment uses `id: llm-pi-ai` configuration override to avoid mounting the same plugin twice |
| Tool registration and execution | `ctx.tools.register(defineTool(...))`; output render returns content blocks | Evolution tools go through the native model schema and the native tool execution chain |
| Lifecycle | Cordis Fiber manages disposal, `ctx.fiber.dispose()` can revoke registration | Native tests verify registration, execution, and disposal; uninstall does not claim to revoke external file side effects |
| SDK | Manages the DSH subprocess and JSON-RPC; a returned result does not necessarily mean success | Additionally check the root `turn/end`; model errors and exit codes enter the failure state |
| Restart | Session recovery is not equivalent to external task recovery | SQLite stages, unique container names, and frozen deliverables are reconciled together; missing executions are not re-sampled |
| Telemetry | `llm/stream` can observe the native adapter stream; vendor-internal retries cannot be fully known | Each stream call records UUID, request, result, usage, and duration; missing usage is listed separately |
| Model contract | provider/model and reasoning tier are the adapter's exact routing | Fixed configuration; unknown routes, missing credentials, and absence of completion events fail immediately |

Community [#10826](https://github.com/deepseek-ai/deepseek-harness/discussions/10826) reports that hot updates during runtime may form a lifecycle deadlock with the Agent Loop's idle wait. This is an external issue report; this project does not claim to have reproduced it based on it. It supports the current choice: drafts are modified offline, and candidates are loaded by a new process after being frozen.

## Actual Boundaries of Containers and Excel

- The DSH native module loader copies dynamic libraries to a temporary cache. Container `/tmp` prohibits `failed to map segment from shared object` at execution time; after using an explicit `exec,nosuid,nodev` temporary mount, acceptance was passed through a real container. [Docker tmpfs official documentation](https://docs.docker.com/engine/storage/tmpfs/)
- openpyxl's `data_only` reads existing cached values and cannot compute formulas itself. Business acceptance is performed by reading after recalculation in an independent LibreOffice container; the scorer for public synthetic cases is not mixed with the original SpreadsheetBench official judge. [openpyxl official documentation](https://openpyxl.readthedocs.io/en/stable/tutorial.html)
- openpyxl does not guarantee complete preservation of all Excel objects. The current examples cover values, formulas, text, and comments; macros, shapes, complex charts, and third-party extensions require separate capabilities and acceptance, and cannot be extrapolated from the basic examples.
- The Venus model snapshot and protocol come from user-specified configuration; real request verification has been performed. The gateway's internal vendor routing is not locked down by this repository, and the logical model ID is not claimed to be a fully fixed physical backend.

## Engineering Quality Basis

[OpenSSF Best Practices](https://www.bestpractices.dev/en/criteria/0) provides a quality reference for verifiable builds, tests, dependencies, and security disclosure. The repository fulfills these requirements with lockfiles, Actions SHA, type checking, state machine tests, native SDK tests, container tests, and real model acceptance, without substituting badges or lines of code for evidence.

The first dependency audit found known issues in zod, undici, MCP client, fflate, and yaml. Based on the official fix scope, explicit version overrides were adopted, a clean reinstall was performed and native acceptance was run, and the audit returned to zero. This involves the [zod advisory](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5), [undici advisory](https://github.com/advisories/GHSA-xjj6-f33q-929c), and [MCP advisory](https://github.com/advisories/GHSA-6prh-2h8m-c8cw). The override list is in package.json; re-verify when updating.

## Use of Community and X Signals

- [DSH stability and duplicate tool call discussion](https://x.com/xiaomovps/status/2113570114083893470): used to remind us to record real requests and the full cost of failures; it cannot be used to infer this project's benefits.
- [Petri / Cordis combination practice](https://x.com/AmoebaFarm/status/2114977001907818688): used as a clue for reuse in the native ecosystem; specific interfaces are still verified against source and actual calls.
- [Plugin extension propagation case](https://x.com/GithubProjects/status/2106678219412038141): explains the direction of ecosystem attention; not used as evidence of methodological novelty or effectiveness.

Research conclusions must continue to distinguish: native wiring passing, real model completing the closed loop, quality changes on fixed tasks, independent re-verification, and migration. These four cannot substitute for one another.

## Supplementary Verification During Operation: Budget, Installation, and Dependencies

- Native `SystemPrompt.context()` updates dynamic facts at assembly / admission refresh; this framework uses it to present the execution budget, without adding an Agent Loop, forced continuation rounds, or a save gate.
- Force-terminating a container does not execute JavaScript `finally`. Call statistics are generated by the host re-reading persistent stream events, with incomplete requests listed separately. Real timeout acceptance has exposed and covered this path.
- pnpm updated to `12.15.0` verified against the registry. The install script is responsible for installing the platform binary to the command entry point; blocking the script causes DSH's `spawn('pnpm')` to return `ENOEXEC`. The project only authorizes verified exact dependency versions, and Docker runs from the command path installed by the project.
- DSH package installation and Bundle activation are two separate states. For dependencies left behind after an install script failure, repeating `add` does not necessarily re-enable them; the upstream update operation preserves the disabled choice. The first installation of a clean Profile and actual model tool calls have been verified separately; availability cannot be claimed based solely on the package manager exit code.
- When the host installs the Bundle itself, the host's lockfile and install script authorization are still managed by the host; this project's npm overrides are not propagated as a global policy for all consumers.

Sources: [DSH Profile and plugin management](https://github.com/deepseek-ai/deepseek-harness/tree/22ddee3792402c3e70ec5f86a63c3e3e895a2f60), the actually installed `dsh-system-prompt@0.2.1-rc.4` types, `dsh-plugin-manager@0.2.1-rc.4`'s `reconcile()` / `setBundleEnabled()`, `pnpm@12.15.0/install.js`, [pnpm install script authorization](https://pnpm.io/cli/approve-builds), and [configuration documentation](https://pnpm.io/settings).

## Parameter DSL Issues Found During Installation Acceptance

Real model installation acceptance found that the early Excel example wrote `parameters.edits.items` as a raw JSON Schema. The DSH rc.4 authoring interface requires a unified ValueSchemaSpec: nested objects explicitly declare `additionalProperties`, required is marked on each property's `required: true`, and arbitrary JSON values use `type: 'json'`. An incorrect interface causes the entire plugin initialization to fail, and previously registered tools are also released along with the Fiber.

DSH outputs a warning by default for initialization failures of non-essential plugins, and the SDK can still complete Agent tasks. Therefore, although the real model completed the workbook in the early experiment and the independent score was full marks, the actual requests did not include the spreadsheet plugin tools, so it cannot be concluded that the plugin took effect or that the mutation was effective. The old experiment and original report are fully preserved, and a separate experiment is opened to verify the fixed baseline.

The current example QA directly activates the candidate entry point through native Cordis, SystemPrompt, and ToolRuntime, replacing merely executing `node --check`. Regression tests simultaneously verify that the correct tool can be registered and that the original erroneous schema fails explicitly; real tasks then check the schema actually received by the model and the tool calls. The general experiment contract still allows domains to provide their own QA commands, without hardcoding a spreadsheet tool list for all tasks.

Basis: [official tool DSL](https://github.com/deepseek-ai/deepseek-harness/blob/22ddee3792402c3e70ec5f86a63c3e3e895a2f60/docs/subsystems/tools.md), the actual `dsh-tools@0.2.1-rc.4`'s `runSchemaCompiler()`, and `dsh-app-boot@0.2.1-rc.4`'s `auditStartupEntries()`.

