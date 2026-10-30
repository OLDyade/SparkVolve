# Capability Evolution

**Discover → Adapt / Author → Compose → Evaluate → Ship**

SparkVolve evolves native DSH Bundles. An optimizer can acquire an existing capability, adapt its implementation, or author a new plugin. The controller resolves exact sources and records the resulting composition; actual task delivery determines selection.

```text
                      Frozen experiment contract
                  model · H0 · tasks · catalog · budget
                                  |
              +-------------------v-------------------+
              | Discover                              |
              | Official DSH · Community indexes      |
              | Local Bundles · Authorized archives   |
              +-------------------+-------------------+
                                  | exact capability IDs
              +-------------------v-------------------+
              | Resolve                               |
              | Native DSH installation               |
              | Manifest + dependency lock + tarball  |
              +-------------------+-------------------+
                                  | editable child of a recorded parent
                 +----------------+----------------+
                 |                |                |
               Reuse            Adapt            Author
                 +----------------+----------------+
                                  |
              +-------------------v-------------------+
              | Compose                               |
              | Native Bundle layers → DSH Profile    |
              | Cordis providers, consumers, scopes  |
              +-------------------+-------------------+
                                  |
                 Build + native behavior + task delivery
                                  |
              Independent grading → version selection
                                  |
              Original Bundle + lineage + evidence
                                  |
                     Fresh Profile installation
```

## The starting point is explicit

H0 comes from the recipe's `seed`, its package manifest and lockfile, its declared Bundle patches, and the experiment's pinned runtime and environment. A catalog entry is only a possible acquisition: discovering it does not load it into H0.

The structured-data example starts with its read/write tools and system prompt. The spreadsheet seed provides `workbook_inspect` and `workbook_write`; it does not calculate formulas. The native engine Bundle is available separately in its local catalog. Neither example silently installs every market package.

Each candidate's native QA records `harness-inventory.json`: loaded plugin state, actual provider-to-consumer bindings and Agent-visible tool schemas. Task sessions record their own inventory. These observations distinguish declared capabilities from loaded capabilities; task traces establish which tools actually ran.

## Four sources, one frozen catalog

| Source | Frozen identity |
|---|---|
| Official DSH catalog | The installed DSH release's native catalog, package name and exact version |
| Configured community index | Native format-1 index bytes, URL, observation time and every published version |
| Local Bundle | Source tree hash, manifest and native compatibility result |
| Authorized research archive | Verified archive identity, source tree and original research provenance |

Example recipe:

```json
{
  "capabilities": {
    "configuration": "capabilities.json",
    "resolutionLimit": 3
  }
}
```

Catalog configuration, with paths relative to that configuration file:

```json
{
  "official": true,
  "indexes": ["https://dshopen.org/index.json"],
  "local": [],
  "archives": [],
  "registry": "https://registry.npmjs.org",
  "timeoutSeconds": 600
}
```

`npm start` snapshots this catalog before optimization and binds its digest into the search contract. A custom experiment can use `sparkvolve capabilities --spec <configuration.json> --output <new-directory>` and bind the returned digest through its `capabilities` field. Set the recipe field to `null` to run without external acquisition.

The example index is community-operated. DSH does not require this index. Retrieval preserves all exact versions and uses literal query terms; the optimizer evaluates semantic fit using source evidence. Popularity and compatibility metadata never substitute for task validation. Seed-only comparison protocols reject catalogs containing research archives, matching the existing research-library boundary.

## Native optimizer interface

| Tool | Result |
|---|---|
| `evolution_discover` | Search and page through the frozen catalog |
| `evolution_capability` | Inspect one exact record, including source and provenance |
| `evolution_resolve` | Queue acquisition of ordered capability IDs into a new draft derived from a recorded parent |
| `evolution_resolution` | Read the persistent resolution outcome |
| Existing draft, authoring, probe and submission tools | Adapt or author code, test mechanisms, submit and evaluate |

Resolution reserves its budget and draft name atomically. Duplicate requests identify the same operation; failures retain their original evidence and do not automatically retry. Installing a dependency changes a draft, not the incumbent champion.

## Dependency-aware composition

1. Install selected exact packages through native `dsh plugin add` in a credential-free isolated Profile. Local sources are built and packed first.
2. Check the actual installed manifest and runtime compatibility. Retain the native installation lock digest.
3. Vendor the resolved package bytes into the draft, update its lockfile and add its declared Bundle patches in the selected order. The parent layers follow; the optimizer can explicitly replace, tune or remove them.
4. Build the frozen candidate. Bind its artifact to a native Profile dependency graph so bare module names resolve through DSH's own resolver. A private, empty-patch binding Bundle registers dependencies without applying candidate plugins twice.
5. Let Cordis activate plugins and connect their injected services. Native QA observes actual bindings; independent behavior probes and task grading exercise the result.

SparkVolve does not synthesize a second service resolver. Incompatible versions, unresolved services, conflicting registrations, invalid patches and failed behavior surface as failures. No automatic interface rewrites or conflict repairs are applied.

## Evidence and reusable delivery

| Artifact | Meaning |
|---|---|
| `search-data/dataset/capabilities/catalog.json` and index/source files | Authorized discovery snapshot |
| `search/resolutions/<id>/` | Original request, execution, logs and frozen resolved source |
| Draft `capability-resolution.json` | Exact records, installed manifests, selected patches and vendored tarball hashes |
| Operational trace manifest | Regular file hashes and exact symbolic-link metadata; links are never followed |
| Candidate report `mutation` | Per-parent file/mode changes, dependency and Bundle-layer differences, native inventory |
| Exported research record | Candidate ancestry and host-recorded resolution provenance |
| `capability/bundle.tgz` | Original evaluated build package; no export-time rebuild |

Action labels remain optimizer claims. Reports preserve actual file and assembly differences rather than guessing which action a change represents. Imported historical scores never enter a new candidate's evaluation.

## Verified scope

The [acceptance record](experiments/2026-10-30-capability-evolution.md) separates:
- deterministic cross-plugin dependency composition and same-package service reuse;
- real community package acquisition and actual Office tool execution after clean installation;
- official DeepSeek autonomous search, independent validation and installed reuse.

Engineering acceptance does not establish accuracy gains from discovery or composition. The larger [flagship experiment](research/2026-10-30-flagship-evolution-design.md) requires its own frozen task roster and controlled comparisons.

## Native references

Implementation is pinned to DSH `0.2.1-rc.4` and Cordis `4.0.5`. Current ecosystem research was cross-checked against [DSH source at ce7073d](https://github.com/deepseek-ai/deepseek-harness/tree/ce7073d51254c26cd63b22a60835b8f948deb447) and the installed packages; newer release source is not treated as the running implementation.

- [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness): Profile installation, Bundle layers, market parsing and compatibility.
- [DSH community index](https://dshopen.org/index.json): configured discovery source.
- [dsh-office-tools](https://github.com/kw78/dsh-office-tools): real adoption acceptance. Its Excel tools provide file operations; formula recalculation is not claimed.
- [Native authoring](native-authoring.md), [behavioral probes](behavioral-probes.md), [research assets](research-assets.md), [original-package use](use-capability.md).
