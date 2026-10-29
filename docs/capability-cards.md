# Deliver Capabilities Together with Evidence

`export` generates `CAPABILITY.md` for terminal candidates, organizing purpose statements, version identity, scores, failures, usage, and runtime conditions from the actual ledger. The card and machine records are placed alongside the original Bundle; there is no repackaging, source modification, or change to the accepted tarball.

```text
export/
├── CAPABILITY.md             Capability and evidence summary that installers read first
├── research-record.json      Original hypothesis, contract, lineage, and evidence index
├── experiment-report.json    Full denominator at export time and per-request accounting
├── source/                   Original frozen source and dependency lock
├── artifact/                 Original build artifact (when the build succeeded)
└── bundle.tgz                Original package actually run (when the build succeeded)
```

The normal export command automatically generates these files:

```bash
node dist/cli.js export --root /absolute/experiment \
  --candidate <candidate-digest> --output /absolute/new-export
```

| What the installer needs to know | Basis for the card |
|---|---|
| What version this package is | Source, build, lockfile, and tarball identity, plus the SHA-256 of the two exported JSON files |
| What it was originally meant to solve | Researcher objective and optimizer hypothesis, each labeled as a claim |
| What was actually validated | Original contract purpose, full task denominator of the current candidate, scores, failures, and domain constraints |
| How many resources were spent | Execution usage of the current candidate and optimizer usage shared across the whole experiment are listed separately; missing values remain unknown, and cost is null |
| Where it has run | Original model, DSH Profile, image, and execution isolation contract; permissions of a new environment are not inferred |
| How to continue using it | Points to the original package, build manifest, dependency lock, and native installation guide |

An export can occur when one candidate is terminal while other candidates are still running. The card is therefore an export snapshot with original event positions and does not automatically represent the final search report. Search results do not automatically become independent validation; a validation contract also does not automatically prove transfer to unknown tasks. Model text uses literal data blocks, and HTML or Markdown content must not be interpreted as card structure.

A build-failed candidate has only source and research records, and the card explicitly states that there is no installable package. QA-failed or rejected candidates remain labeled as research artifacts even if a tarball exists. The card does not change champion selection, installation authorization, or public release boundaries.

For design references and pinned source, see [Recent Ecosystem Review](research/2026-10-28-ecosystem-delivery.md). Actual installation and tool invocation of the original Bundle continue to be accepted according to the [Capability Usage Guide](use-capability.md).
