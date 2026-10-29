# Native Evolution Preset Verification and Implementation

Verification date: 2026-10-27. Official master as actually inspected is `22ddee3792402c3e70ec5f86a63c3e3e895a2f60`; the runtime package is pinned to `0.2.1-rc.4`.

| Native mechanism | Source conclusion | Project implementation |
|---|---|---|
| SDK Session | server explicitly uses host-plane, with no SDK Preset parameter | explicit SDK bridge plugin; no fabricated parameters and no SDK fork |
| Agent creation | queued input is released only after serial `agent/created` fully completes; failure rolls back creation | native `select` is called before the first request |
| Session restore | `agentPreset` projection includes the initial identity and subsequent selections; `select` is forbidden for Sessions with history | restore calls `mount` to reinstate the identity in the record, without appending fabricated selections |
| Preset definition | native declaration plugin creates a shared revision and a scoped Loader tree; retired versions are disposed after all references are released | the six tools and the research methods live in the same Evolution Preset and are invisible to ordinary sessions |
| Method composition | native Include supports file entries, relative modules and lifecycle | the contract fixes the `composition` manifest; the entire method plugin tree is loaded in the Preset scope |
| Distribution | Bundle patch can insert declarations, and later patches can replace the complete configuration | the evolution facility Bundle provides the Preset; the method Bundle explicitly replaces its sub-plugin manifest |

The SDK standard coding tools are still provided by its official Profile. This project adds scoped evolution capabilities and does not claim that every host capability is isolated by the Preset. The executor's and optimizer's files, model configuration, containers and accounting are each governed by the experiment contract.

Verification found that SDK `RunResult.events` covers only the current activity interval, and the Preset selection made at creation need not appear in that array. Restore and identity acceptance therefore read the actual registry/Session projection and check the next real model request, avoiding mistaking the event interval for a complete log.

Tests include same-process scope isolation, restoration of the original Session after a process restart, rejection before the first request when a definition is missing, installation of the standalone method package, and a real optimizer container calling the control service. The test Provider is a protocol fixture and produced no quality conclusions. The first container fixture run exposed a missing task directory and undeclared reasoning support; both were fixed in the fixture and the failure output was retained; the quality experiment was not re-sampled.

Distribution acceptance also found that Include's relative `config.path` is resolved from the Profile directory, and it cannot be assumed to move with the method Bundle. The standalone method package now registers its implementation via an explicit package export; the frozen method manifest inside the container is still passed to native Include via an absolute mount path. The actual child session of the native spawn has been verified to inherit the Preset, the methods and the six capabilities; it completed after executing the real control API and was disposed of by the native manager.

Final acceptance: `npm run check` (18 unit + 8 native), 3 real container tests, and native installation of both the evolution facility and method packages all passed. The container image identity is `sha256:b5ef3b023a9ef576fe946bdb7dfac233fe2b6bdf3fd6dae188058a2692163cea`. Installation took 71.096 seconds; the container suite retains the original logs, Sessions, build and scoring artifacts. This is local acceptance and does not replace cloud CI, which is still limited by GitHub account billing.

## Original sources

- [SDK server Session creation and restore](https://github.com/deepseek-ai/deepseek-harness/blob/22ddee3792402c3e70ec5f86a63c3e3e895a2f60/packages/sdk/server/src/server.ts#L481)
- [Agent creation lifecycle](https://github.com/deepseek-ai/deepseek-harness/blob/22ddee3792402c3e70ec5f86a63c3e3e895a2f60/packages/core/agent/src/index.ts#L552)
- [Preset Registry scope, restore and boundaries](https://github.com/deepseek-ai/deepseek-harness/tree/22ddee3792402c3e70ec5f86a63c3e3e895a2f60/packages/preset/agent-preset-registry)
- [Complete sub-plugin composition of the official Web Standard Preset](https://github.com/deepseek-ai/deepseek-harness/blob/22ddee3792402c3e70ec5f86a63c3e3e895a2f60/packages/bundle/web-app/presets/standard.patch.yml)

The README and implementation of the corresponding locally installed packages were checked item by item separately; native Bundle and Preset are not equivalent to a container security boundary.
