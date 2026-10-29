# Behavioral Harness Comparison: Real Assembly Mutations and Failure Mechanisms

This round completed 64/64 independent scorings with zero execution failures. The search with the behavioral harness disabled yielded one local gain; all three mutations in the enabled group fell below their own baseline. **This round did not demonstrate that the behavioral harness improves accuracy, nor did it demonstrate a stable evolutionary benefit.** At the same time, real evidence of cross-plugin assembly mutation was obtained, and an unacceptable automatic formula rewrite was confirmed via an independent native counterexample.

[Pre-registered contract](2026-10-28-native-probe-spreadsheet-control.json) · [Per-sample scores, invocation costs, and counterexamples](../evidence/2026-10-28-native-probe-spreadsheet-control.json)

## Full Results

Four public synthetic Excel development tasks, each candidate run twice per task; each group contains a baseline and three mutations. The same source baseline, model, image, tool Schema, and optimization method were used; only the behavioral harness authorization differed. The tasks had been observed in prior development and are not an independent test set or the official SpreadsheetBench.

| Group | Baseline | Mutation 1 | Mutation 2 | Mutation 3 | This round's selection |
|---|---:|---:|---:|---:|---|
| Behavioral harness disabled | 78.125% | 68.75% | 51.875% | 81.25% | Mutation 3, local increase of 3.125 pp |
| Behavioral harness enabled | 90.625% | 78.125% | 68.75% | 68.75% | Retain baseline |

Each cell is the mean of 8/8 samples, with no supplementary tasks, task retries, or mixed versions. Two independent runs of the same source baseline differed by 12.5 pp; the difference between the two groups' highest scores cannot be attributed to the behavioral harness. The enabled group additionally received six experiment credits, and total compute was not balanced; shared hosts and model services may also have had an effect. Independent replication and equal-budget studies remain to be completed.

| Account | Disabled group | Enabled group |
|---|---:|---:|
| Optimizer started / result | 154 / 154 | 236 / 236 |
| Optimizer input / output Token | 347,639 / 76,683 | 470,073 / 78,229 |
| Optimizer billed seconds | 903.468 | 1,013.536 |
| Optimizer + executor started / result | 451 / 451 | 515 / 515 |
| Total input / output Token | 656,970 / 140,552 | 813,804 / 148,085 |
| Sum of request durations (seconds) | 1,348.112 | 1,504.001 |

Neither group's ledger has failed/unfinished entries; the counts above refer to the DSH adapter stream, and provider-internal retries may not be visible. The sum of concurrent request durations is not wall-clock time; no reliable unit price was obtained, so costs are not estimated.

## Cross-Plugin Mutation Did Occur

Disabled-group mutation 3 (`4a60fb2b…`) autonomously added `recalc.mjs/recalc.py` by the optimizer, while modifying the original tool implementation and `cordis.patch.yml`:

```diff
 - insert:
     - name: ./index.mjs
+    - name: ./recalc.mjs
```

The native QA's `composition.json` records that both plugins were active; the native `tool/call` event (seq 52) of task `9365249f…` actually invoked `workbook_recalculate`. This is evidence that code and assembly changed together; no causal benefit is claimed on this basis for service interface migration, complex scope refactoring, or topology changes. This candidate is only a local selection from the development search and has not been distributed as a capability that passed full acceptance.

## Why the Behavioral Harness Did Not Provide Effective Checks

| Registered experiment | Actual result | Supportable conclusion |
|---|---|---|
| First two | Treated `probe.mjs#probe` as a file path; module loading failed | Entry point used incorrectly; no business assertions were run |
| Third | `probe()` directly `return 1`; observation was empty, exit succeeded | Only verified that the module loads; did not verify plugin behavior |
| Last three | Executed `JSON.parse` on the full native ToolResult object, reporting a `[object Object]` parse error | Result read incorrectly; expected assertions were not completed |

All six registrations retain the original source, build, logs, and state. There was additionally one preparation failure that treated a file as a suite directory, which was not registered as an executed experiment; it is not mixed into the six-run statistics. `passed` only indicates that the author-provided program returned normally; an empty test cannot be treated as valid evidence.

The current fix directly targets the interface problems: check the draft/test directory and the actual entry file before registration; the tool parameters explicitly specify the directory, module file, and fixed `probe` export; clarify that `call()` returns an object, requiring checks of `isError` and `content`. Do not guess the entry point, do not append extensions, do not automatically parse arbitrary return values, and do not force the optimizer to invoke the behavioral harness. 37 unit tests, 8 native integration tests, and the real-container behavioral harness passed. The first container acceptance command omitted the required `SPARKVOLVE_TEST_RUNTIME` and failed explicitly before startup; it passed after adding the explicit `runc`; the original failure is retained and does not involve model task retries.

## Independent Counterexample: Explicit Formula Overwritten

Enabled-group mutation 3 (`81a5790b…`) treats consecutive adjacent formulas as the same template, automatically shifting the first formula and ignoring the values explicitly submitted afterward. Its implementation also includes automatic shared-formula repair, which does not comply with this round's contract prohibiting automatic repair.

Using the same frozen image, actual build artifacts, native DSH `workbook_write`, and a container with no model/network, two adjacent formulas with different operations were independently constructed:

| Caller submission | Baseline actually saved | Mutation 3 actually saved |
|---|---|---|
| `B1 = A1+10` | `=A1+10` | `=A1+10` |
| `B2 = A2*20` | `=A2*20` | **`=A2+10`** |

The baseline assertion passed and the mutation assertion failed. The counterexample source, identity, and actual observations are in the machine evidence; the original directory is `.evolution/explicit-write-counterexample-20261028`. The frozen candidate and task scores were not modified; the quality screening had already rejected this candidate, and its undeliverable reason is additionally made explicit here. This counterexample only proves that the tool contract was violated; it does not explain the entire score decline.

Going forward, the operation semantics explicitly promised by the domain should be written as domain QA independently maintained by researchers and frozen before the experiment, with the general engine continuing to invoke it per the contract; it does not generate formula answers and does not intrude on the domain logic of the general framework. After changing the method or acceptance contract, a new experiment must be created and cannot overwrite this round's results.
