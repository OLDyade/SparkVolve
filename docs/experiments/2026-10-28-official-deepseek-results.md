# Official DeepSeek: Autonomous Modification, Independent Validation, and Original-Package Reuse

On 2026-10-28, the real DSH optimizer completed a plugin implementation modification, independently validated and installed the same archive; then, in four clean Profiles, it installed the original package and executed four categories of business tasks. All seven checks of the native development acceptance passed. This document distinguishes the autonomously generated original candidate, the maintainer-corrected version, and the actual scores of each independent execution.

## Fixed Contract and Service Investigation

- DSH `0.2.1-rc.4`, Cordis `4.0.5`; official `deepseek-official/deepseek-flash`, reasoning off, actual output budget 32,768. The official catalog showed DeepSeek-V4.1-Flash that day; the alias backend weights cannot be locked locally.
- Tasks, native QA, behavior probes, and model requests: 600 seconds; the optimizer derives 7,140 seconds from the full plan. Four tasks run concurrently, scored independently, and original attempts are not re-run after reaching a terminal state; no provider switching or automatic retries.
- Mirror `sha256:8bc3300c7e6fb329d1e03417a82bb1306c865f76b7b490803f2ad811b67bb2af`. Credentials exist only in a private file outside the repository and in the trusted egress proxy; the executor receives local placeholder values.
- Four task categories: result normalization, weighted combination, debt roll-forward, scenario valuation. Development and validation use different input instances of the same task family; all are synthetic engineering acceptance and cannot be claimed as unseen-domain transfer.

Previously, the relay service returned a stream without an end marker about 301 seconds after TCP/TLS succeeded, and another connection hit ECONNRESET during TLS, upon which the egress proxy returned 502. The available evidence cannot determine which remote component was interrupted. The 600-second task budget was not exhausted, so this cannot be attributed to a local task timeout.

The official service actually returned normal termination markers for `/models`, Messages tool calls and tool-result replay, and Chat Completions. Messages took about 693/677 ms twice, Chat about 1,456 ms, with zero retries. Integration uses the DeepSeek adapter bundled with DSH. Protocol headers are forwarded explicitly; the official documentation states that some headers are ignored, and this was not claimed as the root cause of the earlier stream interruption. For the basis, source versions, and boundaries, see [integration research](../research/2026-10-28-official-deepseek.md).

## Full Experimental Results

| Stage | Actual Result | Verdict |
| --- | --- | --- |
| Official first search | H0 81.25%, H1 50%, H2 75%; 18 of 20 slots scored, 2 tool-parameter JSON invalid | Original acceptance failure retained, H0 retained; model JSON not patched, not resampled |
| New development evidence contract | Frozen generic formula-semantics counterexamples; the optimizer autonomously read the official plugin development Skill, invoked inspection, and modified the Python/JS plugins | 3 autonomous probes: fail/fail/pass; source, logs, and probe failures retained |
| Autonomous search | H0 56.25% → H1 81.25% → H2 100%; 12/12 scored | Strict selection chose H2 |
| Independent validation | H0 81.25%, H2 100%; 8/8 scored | All seven native development acceptance checks passed |
| Execution after autonomous original-package install | 4 clean DSH Profiles; all four tasks 100%; 4/4 scored | Original tarball install, provenance resolution, before/after file integrity, and real business execution passed |
| Independent validation of maintainer-corrected version | All four tasks 100%; 4/4 scored | Uses the corrected version's own digest, does not inherit the parent candidate's scores |
| Execution after maintainer-corrected original-package install | Normalization 25%, the other three tasks 100%; mean 81.25%, 4/4 scored | Install-execution contract passed; business regression explicitly retained, cannot be stated as all business tasks correct |

Autonomous H1 `f031f90e…` introduced real LibreOffice recalculation and the tool interface; H2 `f4686d66…` only adjusted tool descriptions relative to H1, and has implementation modifications relative to H0. There were no autonomous complex assembly-topology changes. The H2 original archive digest is `ac305a51e28c9f0d68c7f80df6b7e3c6eb9fc3fa3cacd25458a2ff2fdb3b12c7`.

## Semantic Defects, Fixes, and Failed Results

1. The first-round autonomous formula interpreter disagreed with the actual engine on ROUND ties, unselected IF branches, cross-sheet SUM, and power associativity rules. The new development evidence contains only generic counterexamples, not validation answers; the optimizer adopted the native engine on its own. The missing H0 `resolve` in the counterexample record means the interface is not applicable and cannot be counted as an H0 calculation error.
2. The native-engine candidate still had optional delivery-path defects: saving a `data_only=True` workbook erases formulas; judging errors by the `#` prefix falsely flags ordinary text. Actual file counterexamples were reproduced. The maintainer corrected this to copy the engine's original XLSX and judge errors by OOXML error type, and additionally added explicit date serialization, atomic publishing, stdin error propagation, and a 600-second engine budget, and removed ineffective compatibility parameters. The corrected version is at [`native-engine`](../../examples/spreadsheet/native-engine/PROVENANCE.md), explicitly marked as a maintainer-derived version.
3. Real DSH regression covers ROUND, IF, cross-sheet references, power, `#literal`, real errors, dates, 7 formulas and cache retention, unchanged source bytes, and failed operations not destroying existing deliverables. No model or guess-based result remediation is used.
4. The normalization error after installing the corrected version came from the model writing a reversed tax-item formula. The trajectory proves it read the original annotation via shell, then explicitly submitted the formula; a recalculation returning normal values does not mean the business semantics are correct. This result was not deleted or re-run as-is, and no task-coordinate patch was added.
5. The first-round install helper container failed because the read-only working directory lacked a HOME mount point, and none of the four tasks reached model execution. It was changed to an independent writable helper working directory, and actual deliverables are not mounted to the install helper; subsequent install acceptance succeeded. The original zero-execution failure is archived separately.
6. The JS AST classification of the old run was interrupted by Babel `range: undefined` metadata, and evidence of Python implementation differences remains. The classifier now excludes location fields and adds import/shorthand regression; the original report is not rewritten, and the AST summary itself does not prove behavior is correct.

Corrected-version source digest `6b31d303711ca2bbb7816038e716b39d2d7c035dc623fa12c4870a49decd0114`; its original archive digest `4afd2f35f497848f82b1ea8047974a1821b0e49ddaa4cf27952a169d65089fb8`. The public catalog corresponds to the frozen content of this independent validation. It covers only the tested scalar-formula XLSX contract and does not promise macros, external links, or all Excel features.

## Requests and Usage

The accounting unit is the DSH adapter stream attempt; zero retries are configured, and hidden server-side behavior is not inferred. Duration is the sum of request durations and cannot be treated as whole-round wall-clock time; cost is left blank because there is no price evidence.

| Stage | started/result/failed/unfinished | Input/output tokens | Sum of request durations |
| --- | --- | --- | --- |
| First-round search and validation | 313 / 311 / 2 / 0 | 251,233 / 91,968 | 752.385 s; 2 failures missing usage |
| Baseline install execution after helper-directory fix | 23 / 23 / 0 / 0 | 11,582 / 5,866 | 47.708 s |
| Autonomous semantic-modification search and validation | 205 / 205 / 0 / 0 | 161,885 / 48,690 | 427.432 s |
| Autonomous original-package install execution | 29 / 29 / 0 / 0 | 13,322 / 5,975 | 51.649 s |
| Independent validation of maintainer-corrected version | 25 / 25 / 0 / 0 | 20,003 / 5,118 | 45.211 s |
| Maintainer-corrected original-package install execution | 26 / 26 / 0 / 0 | 11,956 / 5,233 | 45.679 s |

The full denominator, per-task scores, usage, package identity, counterexamples, and raw-file SHA256 are in the [evidence catalog](../evidence/official-deepseek-20261028/sources.json). The public summary does not include keys or the full private model conversation; the local original report, failures, and full trajectories are retained. The reproduction entry point is in [official integration](../../examples/deepseek/README.md), and development evidence is in the [frozen semantics brief](2026-10-28-native-semantics-brief.md).

**This run completed the engineering loop of real autonomous modification → independent validation → original-package install reuse. A single four-task increase has not yet proven stable gain, mechanistic causality, cross-domain transfer, or Spark model adaptation effects.** Maintainer fixes and autonomous evolution are accounted separately, and the project overview is still verified item by item according to [implementation status](../completion.md).
