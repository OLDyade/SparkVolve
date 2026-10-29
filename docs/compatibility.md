# Compatibility

All experiments pin the actual running versions; upgrading dependencies requires passing native and container acceptance again.

| Layer | Current implementation |
|---|---|
| Node | Acceptance tested on 24.16.0; package requires ≥24.11.0, covering native SQLite and development tool dependencies |
| npm / pnpm | 12.2.0 / 12.15.0; npm manages this repository, DSH native commands use pnpm to manage Profiles |
| DSH | Exactly pinned to `0.2.1-rc.4`; uses `sdk` / `sdk-minimal` Profiles |
| Cordis | `4.0.5`; plugin registration, service dependencies, and lifecycle are handled by the native implementation |
| Model | Quick start uses Venus `deepseek/deepseek-v4.1-flash-1017`; Provider configuration and model contract are frozen separately |
| Container | Full-chain tested with runc (OrbStack daemon) and gVisor 20261019.0/systrap (dedicated Debian 13 daemon, ARM64); public Linux x86_64 CI at `48e835c` passed 23 full regression items each for runc/gVisor, per-version results in [public acceptance records](experiments/2026-10-28-public-ci-and-delivery.md) |
| Excel | Example image provides openpyxl / LibreOffice; independently recomputes and verifies formulas and values |

DSH's Profile selects application assembly, Bundle provides distributable patches and plugins, and Cordis manages services and lifecycle. The optimizer and executor each run the native SDK; this project does not implement another Agent Loop.

The SDK selection bridge and installation configuration for the Evolution Preset are in [presets.md](presets.md). The current experiment contract's `optimizerHarness.composition` points to the native plugin entry manifest; the old root `patch` method contract is incompatible, and new experiments must be generated via the current prepare command. Historical contracts, logs, and scores are kept as-is and are not rewritten and rerun.

The general image does not include Excel dependencies; spreadsheet tasks and spreadsheet graders must use the extended image built with `examples/spreadsheet/Dockerfile`. The `verify-image.mjs` in the [startup guide](quick-start.md) actually checks openpyxl, LibreOffice recomputation, the independent grader, and raw value preservation before paid model runs, outputting raw logs and isolation receipts. Test fixture inputs and delivery directories are writable during the preparation phase; this acceptance does not replace the read-only mounts or business accuracy evaluation of formal scoring.

When integrating other models, provide a native Provider patch, update the `Model` contract and its environment variable list, and complete real tool-call acceptance. There is no implicit model switching. Dependencies after installing a Bundle are managed by the target Profile; this repository's npm overrides do not become a global policy for consumers.

The first installation may require authorizing pnpm to run build scripts for exactly pinned native dependencies. Only packages that are actually needed and verified are allowed; errors are kept and handled directly, and a disabled plugin must not be treated as a successful installation.

The target Profile of the current distribution test explicitly allows the following builds in `pnpm-workspace.yaml`; when used with different versions, the installation output must be re-verified:

```yaml
allowBuilds:
  '@deepseek-ai/dsh-subprocess-local@0.2.1-rc.4': true
  '@google/genai@2.21.0': true
  'koffi@3.1.1': true
  'node-pty@1.2.0-beta.15': true
  'protobufjs@7.6.6': true
```

`npm pack --json` returns an object keyed by package name in npm 12; this repository's installation test parses by pinned version and does not introduce a legacy-format compatibility layer.

Verification entry points: [current native implementation research](research/2026-10-27-native-implementation.md), [DSH pinned source](https://github.com/deepseek-ai/deepseek-harness/tree/22ddee3792402c3e70ec5f86a63c3e3e895a2f60).
