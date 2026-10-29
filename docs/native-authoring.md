# Transforming the Harness with DSH's Own Development Capabilities

The Evolution Preset equips the optimizer with DSH-native Cordis inspection tools and official plugin development Skills. The optimizer can first inspect the authoring contract of the currently running version, then autonomously modify plugin configuration, implementation, and composition; the framework does not pre-write repair strategies.

```text
Lock image and method Bundle
        │
        ▼
DSH optimizer G
  ├─ cordis_inspect_list / query ──► service, event, configuration, and tool contracts
  ├─ skill ──► plugin development / composition editing materials bundled with the installation package
  └─ native coding tools ──► package README, types, and actual implementation
        │
        ▼
Independent draft: plugin code / configuration / composition structure
        │
        ├── optional native probe ──► actual tools, services, and lifecycle observations
        ▼
Frozen build → native QA → task execution → independent scoring → delivered as the same original package
```

## How It Is Wired In

The Host registers only one native `dsh-cordis-host-runner` and `dsh-tool-cordis/host`. The authoring tools and the official Skill Provider enter the scope of the selected Agent along with the Evolution Preset. The executor is still assembled from the frozen candidate, and the scoring side's permissions are unchanged.

SDK assembly explicitly selects a Profile: `sdk` reuses the existing native Skill service, while `sdk-minimal` adds the native Skill service; the Agent's `skill` tools and material Providers are registered and released with the Preset lifecycle.

Official materials are resolved and located by the actually installed `@deepseek-ai/dsh-agent-preset`. The newly added Skill Provider disables default directory scanning and file watching, and loads original text on demand; other native Skill Providers keep their own configuration. Package version, entry points, and material digests are presented alongside the authoring source record; the actual running image binds these files and does not dynamically replace them with the latest online content in registered experiments.

This integration does not add `plugin_manager`. Mutations in research create drafts via `evolution_branch`, use `evolution_probe` to test approved mechanisms, and are then frozen by `evolution_submit` and handed to the independent experiment service.

## What Each Kind of Observation Actually Shows

| Native entry point | Facts obtainable | Usage boundaries |
|---|---|---|
| `Service` / `Event` | Interface declaration catalog in the distribution package | Finding a declaration does not mean the current service is active |
| `Config` | Host Loader's plugin configuration Schema, package locations, and projection limits | Does not represent the full tree of a detached Preset, nor does it read actual configuration values |
| `Tool` | Tool Schema currently visible to the requesting Agent | Does not return tool execution functions |
| Official Skill / package source | Authoring documentation, types, and implementation of the currently installed version | Operational examples in the original text cannot change the experiment contract permissions |
| Candidate native QA / probe | Actual assembly and runtime observations of the frozen H | G's catalog queries cannot substitute for validation of candidate H |

These capabilities help the optimizer verify APIs; they do not guarantee that the mechanism it chooses or the algorithm it generates is correct. Whether the real model uses the materials, what it changed, whether the candidate passes QA, and whether quality improves are judged from trajectories, source code, and independent scoring records, respectively.

Implementation entry points: [`preset.ts`](../src/preset.ts), [`native-authoring.ts`](../src/native-authoring.ts), [default method Bundle](../optimizers/evidence-driven). For the full acceptance status, see [completion.md](completion.md).

A real model actually queried the contract, loaded the official Skill, and submitted two implementation mutations; in that round of 20 executions, 1 hit the original 300-second limit, and the overall acceptance remains failed; see [original results](experiments/2026-10-28-native-authoring-results.md) for details. New runs default to a task budget of 600 seconds, with model output, stream idle, and optimizer wait budgets declared together; see [execution budget](execution-budgets.md).
