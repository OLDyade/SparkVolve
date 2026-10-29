# Native Domain Operation Contracts: From Confirmed Counterexamples to Independent Acceptance

## The Actual Problem

The [behavioral testbench comparison](../experiments/2026-10-28-native-probe-spreadsheet-results.md) found that the optimizer-generated `workbook_write` replaced the caller's explicit formula with the shifted formula of a neighboring-cell template. The native counterexample confirmed that `=A2*20` was saved as `=A2+10`. A newly added tool being assemblable does not mean it fulfills the public operation contract; the author's own empty test did not verify this either.

Previously, domain QA was an arbitrary command array, lacking an independent identity for the test source code. Now `{directory,digest,entry}` is used to bind researcher-maintained native tests: the content enters the contract, is read-only for the optimizer to understand, and is run after the actual candidate is assembled, with no credentials, no network, and no problem or scoring materials. The general engine does not write table rules.

## Verified Sources and Version Boundaries

On 2026-10-28, the latest official documentation was queried via Context7, then checked against the current GitHub commit and the installed package:

- The [DSH tool system](https://github.com/deepseek-ai/deepseek-harness/blob/22ddee3792402c3e70ec5f86a63c3e3e895a2f60/packages/core/tools/README.md) has adopted batch execution; programmatic calls can hold an Agent scope, and no model root call event is generated when there is no model step log.
- This project installs `@deepseek-ai/dsh-tools@0.2.1-rc.4`; `ToolExecutionInput` and `execute(exec)` of `lib/types/index.d.ts` are single calls, including `callId/name/arguments/agent/signal`. It reuses the already-tested native observation plugin and saves ToolResult directly; it does not copy the latest batch interface or simulate the Agent Loop.
- The upstream practices and community leads for the behavioral experiment follow the [verified research](2026-10-28-executable-probes.md). This work is driven by a definite operation counterexample and does not use popularity or third-party implementations as evidence of correctness.

## Implementation Trade-offs

Tests can check tools, services, and combinations, and the interface is consistent with the `probe` written by the optimizer itself. The authorship, identity, and admission rights of the two types of tests are kept separate: researcher tests are fixed in advance; optimizer tests are used for autonomous diagnosis. A domain contract can specify the semantics of one public API, while the plugin can still be refactored across files and services; changing the API contract requires starting a new experiment.

Researcher tests and the candidate interact in the same process, so they cannot serve as security isolation for a malicious candidate or as a complete proof of correctness. Real delivery is still scored by an independent judge. Passing tests does not generate or fix business formulas.

## Acceptance

The same frozen image and three historical build artifacts were verified in a new network-disabled container: the original baseline passes; the composite candidate that autonomously added `recalc.mjs` passes; the candidate that automatically shifts the explicit formula fails at the independent assertion. The original candidate and original scores are unchanged; the failure log is retained. See the machine record in [acceptance evidence](../evidence/2026-10-28-domain-verification.json).

Controller container acceptance confirmed: the researcher directory is read-only, model credentials and private scoring mounts are absent, native tool errors are fully observed, domain assertion failures enter `qa_failed`, and repeated pump does not start a task. After the frozen tests are modified, the controller refuses to start.

A subagent review found that the independent re-verification preparation script did not hand over the newly added test directory. It was fixed to copy the original frozen QA and verify the identity of the source and the copy; the newly added tests actually execute `prepare → validation → Controller.start`, and handover is refused when tampering with the original QA is confirmed, without regenerating tests. This verification does not call a model and does not produce a quality score.
