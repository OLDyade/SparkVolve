# Independent Domain Operation Constraints

The optimizer can create and recombine capabilities; the researcher defines the operational commitments that a capability must fulfill. Domain QA's test source is separated from the candidate source, and the content hash, entry point, and data permissions are all frozen before the experiment begins.

```text
Researcher-synthesized tests ── content hash / entry ── experiment contract
                      │
Optimizer read-only view         │             autonomous modification of plugin implementation / configuration / assembly
                      ▼                            │
           independent network-disabled container: native assembly ← frozen build artifact ──┘
                      │
         actual Agent → tools / services → independent assertions
                      │
           pass: formal task      fail: qa_failed + raw observations
```

Contract example:

```json
"qa": {
  "directory": "verification",
  "digest": "<directory content SHA256>",
  "entry": "check.mjs"
}
```

`directory` is relative to the dataset, and `entry` is relative to the test directory. The controller verifies the content at startup, before running candidate QA, and before the optimizer starts; the tests are mounted read-only at `/verification`. The directory must not overlap with private scoring materials. It uses the same `probe` interface as native behavior experiments, but the source and purpose differ: here it is an admission constraint declared in advance by the researcher; [behavior experiments](behavioral-probes.md) are written autonomously by the optimizer, provide diagnostic evidence, and do not determine admission. The previous command-array contract has been replaced by the independent source contract; new experiments do not accept the old array format; historical records are preserved as-is.

QA does not request model inference, does not inject model credentials, and does not access task inputs or the independent judge. `call()` returns a native ToolResult object; when a tool returns an error, the test still asserts whether it matches expectations. Actual observations are saved in `qa/<candidate>/work/native/behavior.json`. Any uncaught exception or non-zero exit places the candidate into `qa_failed`, and checks are not silently ignored.

The tests and the candidate interact within the same native Agent process; independence refers to the test's authorship, content identity, and modification permissions; it cannot defend against arbitrary malicious code forging behavior within the process. Final scoring is still handled by a separate process, private evaluation mounts, and real delivery checks. This mechanism also does not prove test completeness or semantic correctness.

## Table Instance

`tests/fixtures/spreadsheet/prepare.mjs` copies and freezes the public synthetic tests. Verify using the existing `workbook_write` interface:

- Explicit formulas for adjacent but different operations are preserved verbatim, including absolute references; the same `value` interface allows writing another explicit formula or a zero value onto an existing formula, and explicit clearing is preserved as requested by the caller.
- The original file bytes are unchanged; non-target values, styles, and comments in the fixture are preserved.
- Duplicate targets and unknown worksheets explicitly return native tool errors, and existing delivery files are not partially overwritten.
- Targets outside the working directory are rejected, and no files are produced.

These are the API behaviors declared by this instance. The framework has no Excel, coordinate, or formula branches; cross-file and cross-plugin implementations are allowed. If the research goal requires changing the public API, a separate contract and acceptance should be established, preserving the existing experiment identity.

The independent capability review on 2026-10-28 found that a candidate whose task score was on par with the baseline only accepted `value` formulas on blank targets, but required another field on existing formulas, violating the same write interface. The synthetic fixture therefore added existing formulas as input: the original frozen baseline passes, and that frozen candidate explicitly fails. The test snapshots and results of existing experiments remain unchanged, and subsequent contracts freeze new test hashes; this regression does not read benchmark answers and does not add a business accuracy threshold.

A native Bundle can be independently accepted before a formal model task:

```bash
node tests/fixtures/spreadsheet/verify-contract.mjs \
  <immutable-image-id> isolation.json examples/venus/model.json \
  examples/venus /absolute/built-bundle /absolute/new-evidence-directory
```

This command fixes the SDK Profile and patch name for this example; the general controller uses the actual Profile, patch, and entry point from the contract. The command does not read credentials and does not rewrite the Bundle; on failure it leaves the original logs, isolation receipt, synthetic source files, and deliverables.
