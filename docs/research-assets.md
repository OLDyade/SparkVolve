# Make one evolution the starting point for the next research

```text
Completed candidates: success / regression / QA failure
       │ export / remember
       ▼
Research archive: source + build identity + hypothesis + negative results + lineage
       │ researcher authorization, written into a new experiment contract and frozen
       ▼
evolution_library → evolution_asset → optimizer decides whether to reuse
                                        │
                                evolution_import
                                        ▼
                         new draft + persistent provenance record
                                        │ autonomous modification of code / config / composition
                                        ▼
                        current experiment build → QA → full scoring
```

Three native tools provide retrieval, viewing and import; selection and modification are left to the DSH optimizer. Retrieval is by original text, not automatic selection by historical score; failed archives are equally discoverable. Import does not execute plugins, does not install plugins into the optimizer, and does not inherit old scores or champion eligibility.

## Authorization and usage

1. Use `harness-evolve remember --root <old experiment> --candidate <digest> --library <directory>` to collect terminal-state archives. Each subdirectory is named by archive ID.
2. Select the archives the optimizer is allowed to read and copy them to `research-assets/` of the **new experiment dataset**. Review the access permissions of the source code, task descriptions and feedback within.
3. Use `harness-evolve digest <dataset>/research-assets` to obtain the directory digest, and declare it in the new experiment contract:

```json
"researchLibrary": {
  "directory": "research-assets",
  "digest": "<SHA-256 digest of the directory>"
}
```

When not authorizing, explicitly fill in `"researchLibrary": null`. `init` freezes the dataset; the controller verifies the snapshot at startup and on every library access. The optimizer cannot specify host file paths, nor expand the asset scope mid-experiment. The research library is provided by the host API by ID and is not mounted to the optimizer as an entire filesystem.

`evolution_library` returns the ID, research objective, mechanism hypothesis and historical results; `evolution_asset` returns the complete research record and the list of source files, and returns raw base64 bytes when a file is specified; `evolution_import` copies the selected source code to `/workspace/<draft>`. A subsequent `evolution_submit` attaches `origin` to the new candidate, which then goes through the current contract's independent evaluation again.

## Identity and interruption semantics

| Identity | Meaning |
|---|---|
| archiveId | Composite identity of the original experiment UUID, the full experiment spec digest, and the candidate source digest |
| recordDigest | Digest of the complete research record content, including the specific version of historical feedback |
| sourceCandidate | Digest of the directory of the actually copied source code |
| researchLibrary.digest | The complete asset snapshot the optimizer is allowed to read this time |

Digests prove content correspondence, not author identity, research conclusions, or the truth of scores. The current local authorization model does not claim SLSA signature certification. After viewing old tasks or feedback, that data has already entered the optimizer's visible scope and can no longer be called unseen evaluation.

Import first writes a `pending` intent, copies and verifies in staging inaccessible to the optimizer, then publishes the draft and commits the `ready` provenance record. `pending` drafts prohibit candidate submission. Repeating the same import after an interruption resumes it; a completed import returns the original draft and does not overwrite subsequent modifications. Changing the source of a draft with the same name reports an error directly. An interrupted private staging is kept for diagnostics and is not used as a candidate.

The original contract, original scores and old lineage are used to explain provenance; the new selection state accepts only the actual build, execution and scoring of this round. Independent re-validation experiments do not open the optimizer API.

## Acceptance

Unit acceptance covers unauthorized rejection, private directory overlap, path traversal, metadata/source tampering, provenance following the commit, and the three interruption points: before copy, after publish, and response loss. Native tool registration, container task recovery, and real-model retrieval import are verified separately; real-model tests use explicitly synthesized historical archives and cannot count as quality gains.

```sh
HE_TEST_IMAGE=sha256:<runtime image digest> node --env-file=/secure-directory/venus.env \
  --import tsx --test tests/live/library.test.ts
```
