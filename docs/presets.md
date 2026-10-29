# Evolution Preset: Putting Evolution into Native Sessions

```text
SDK Profile: Agent Loop / Model / Files / Shell / Native Compression
                         │ Shared runtime foundation
                  Agent Preset Registry
                    ┌────┴────┐
             evolution       Other Presets
             Evolution tools  Their own capabilities
             Frozen research method  No evolution tools, no research method
                    │
         Native model request → Tool execution → Independent experiment API
```

`evolve` automatically assembles the `evolution` Preset. The `optimizerHarness` in the contract specifies the source and the `composition` native entry list; `optimizers/evidence-driven/plugins.yml` is the default implementation. The method is first prepared as a verified frozen build package, and the list is loaded by native Include within the Preset scope. The executor continues to use its frozen candidate, separate from the optimizer's method and control permissions.

| Input type | Required identity | Preparation behavior |
|---|---|---|
| `kind: source` | `source: {directory, digest}`, `composition`, `build: {image, timeoutSeconds}` | Freeze source, lock dependencies, actual build, native QA |
| `kind: artifact` | `source: {directory, digest}`, `artifact: {directory, identity}`, `composition` | Verify and import the original build package, native QA; do not rebuild |

`PreparedOptimizer` fixes the source digest, the complete `BuildIdentity`, and the assembly entry point, located in the experiment's `optimizer-harness/prepared.json`. Recovery reuses the original preparation intent and build container; if an existing artifact is missing or modified, it fails directly. The active session mounts the build package as a read-only directory and does not load mutable input source.

## Installing in an Existing DSH

Package this repository and install it using the native `dsh plugin --profile <target Profile> add <tarball>`. Before starting, set `SPARKVOLVE_ENDPOINT` and `SPARKVOLVE_TOKEN` to point to an actual `search` experiment control service. Installation provides a native Preset named **SparkVolve** with ID `evolution`; deployments with a Preset registry and selection UI can select it directly. Evolution tools are not registered to all sessions.

Tool installation only completes native registration. When self-hosting the optimizer, you must also establish a mount contract between its working directory and the control service: the experiment's `drafts/` is mapped writable to `/workspace`, `materialized/` is mapped read-only to `/evidence`, and the method and validation directories declared in the contract must also be mounted at the corresponding read-only paths. The API returns optimizer runtime environment paths, not download URLs; merely connecting to the HTTP API does not transfer or create these mounts. It is recommended to use the implemented isolated launch path via `evolve`, which automatically establishes and verifies these mappings and does not expose the database, scoring materials, or Docker socket to the optimizer.

The research method can also be packaged and installed independently:

```bash
npm pack ./optimizers/evidence-driven
dsh plugin --profile <target Profile> add ./sparkvolve-optimizer-evidence-driven-0.1.0.tgz
```

The method Bundle's patch fully replaces the Evolution Preset's sub-plugin list. The installation order is evolution infrastructure Bundle → research method Bundle; per native semantics, a replacement list does not automatically merge future versions' default sub-plugins.

## Explicit SDK Integration

In the locked DSH `0.2.1-rc.4`, `sdk` / `sdk-minimal` have no Preset registry, and the high-level SDK has no session Preset parameter. The independently installed SDK uses the following native patch and loads it in `DeepSeekHarness({ patches: [...] })`:

```yaml
- insert:
    - id: agent-preset-registry
      name: '@deepseek-ai/dsh-agent-preset-registry'
      config:
        default: evolution
    - id: evolution-sdk-preset
      name: '@sparkvolve/dsh-bundle/sdk-preset'
      config:
        preset: evolution
```

New root sessions of this SDK process explicitly select this Preset. Sessions with existing native assembly and sub-Agents retain their original binding; recovery reads the Preset identity from the session projection. A missing definition or recovery record errors directly. The bridge plugin uses only native lifecycle and registry, does not replace the Agent Loop, and does not modify the SDK.

Profiles that already provide a registry, such as Web, **do not load this SDK patch** and use the deployment's own native session selection. The Preset manages registration visibility, while system security isolation is still handled by independent processes, containers, and permission contracts.

## Acceptance Boundaries

- Actual SDK subprocess: evolution tool invocation, no leakage into ordinary sessions in the same process, research method isolation, native spawn sub-Agents inheriting and invoking evolution tools, recovery after process restart, missing Preset failing before the first model request.
- Actual optimizer container: frozen method → Preset → native model tool request → real control service → search end record.
- Clean Profile: actually install the packaged evolution infrastructure and method Bundle, and check the first model request and real tool receipts.

The above uses a deterministic Provider validation protocol and cannot be used to claim accuracy improvements; research results from real model searches are recorded separately.
