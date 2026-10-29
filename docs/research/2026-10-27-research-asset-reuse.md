# Authorized Research Asset Reuse: Design Rationale and Acceptance

## Primary Sources and Scope

- [OCI Descriptor](https://github.com/opencontainers/image-spec/blob/main/descriptor.md): the digest identifies the exact content, and the receiver recomputes and verifies it. This borrows the content-binding principle, without passing off a local archive as an OCI registry.
- [SLSA 1.2 artifact verification](https://slsa.dev/spec/v1.2/verifying-artifacts): signature trust root and subject digest matching are distinct checks. The current library is locally authorized and frozen by the researcher; verifying a digest is not equivalent to completing signature authentication, nor does it authenticate historical scores.
- [Node 24 fs](https://nodejs.org/docs/latest-v24.x/api/fs.html): the errorOnExist/force of recursive cp control file overwriting, and do not provide a joint transaction for database provenance records and directory publication. We adopt persistent import intent, private staging, commit admission state, and same-intent recovery.
- Native tools reuse the actual DSH `0.2.1-rc.4`'s `defineTool` and the Cordis lifecycle. No new Agent Loop was created, and no research library, database, or scoring private directory was mounted for the optimizer.

## Specific Changes

The new contract field `researchLibrary` explicitly authorizes directories and digests, with null for unauthorized. Search includes failed records; view provides exact source code and record digests; import copies source code and registers the origin. New candidates are always re-scored, and import does not carry over old mean, TaskRun, or champion. Authorized library changes, wrong IDs, out-of-bounds paths, and source/artifact mismatches fail directly.

A read-only subagent identified and we fixed the interruption window of "publishing the draft before recording the source". Now a pending import intent is written first, and ready is committed after copy verification; candidate submission rejects pending, and same-intent recovery does not clear subsequent modifications to an already completed draft. Fault injection covers before copy, after publication but before record commit, and response loss after record commit, with SQLite reopened for verification.

24 unit, 8 native, and 3 real container tests pass. [Real model acceptance](../evidence/2026-10-27-library-acceptance.json) selected relevant assets from two synthetic negative-result archives, checked records and implementation, then imported: 3 searches, 3 asset views (including the original index.mjs), 1 import, all 10 model requests returned, container 22.618 seconds. Draft naming was chosen by the model, source digests matched, and no irrelevant items were imported; 0 candidates, 0 evaluation runs, no champion. This demonstrates autonomous tool use and provenance passing, but still does not demonstrate that reuse improves task scores.

The native call trace also shows the model attempting to find assets from `/workspace/library`, where the actual library was not mounted; it then completed the read through the authorized tools. The two synthetic archives share the same minimal source code, and the model proactively noted this boundary in its stop reason, distinguishing relevance based on research records; this is not a complex code retrieval benchmark.
