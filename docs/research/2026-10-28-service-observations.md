# Make service and scope mutations leave inspectable behavioral evidence

## Basis and scope

Existing behavioral experiments save tool receipts, but the results of directly reading services, inspecting isolated scopes, and waiting for unload can only remain in test assertions. After assertions pass, researchers cannot reconstruct these intermediate states from structured artifacts. This weakens attribution for cross-plugin interfaces and assembly mutations.

On 2026-10-28, DSH official documentation was checked via Context7, and `context.ts`, `registry.ts`, and `fiber.ts` of the installed `@deepseek-ai/cordis@4.0.5` were verified item by item. The current GitHub main branch is [22ddee3](https://github.com/deepseek-ai/deepseek-harness/commit/22ddee3792402c3e70ec5f86a63c3e3e895a2f60); this repository still uses the locked DSH `0.2.1-rc.4` and does not mix in main-branch interfaces.

| Official mechanism | Actual verification |
|---|---|
| [`ctx.isolate`](https://deepseek-harness.github.io/deepseek-harness/en/reference/cordis-api/context) creates an independent scope for a specified service | Same-named services at parent, left, and right output 4, 6, and 10 respectively; changes on the left do not affect the other two |
| The service of `ctx.provide` belongs to the lifecycle of the plugin that provides it | After unloading the left Provider, the Consumer in that scope becomes pending, and the derived service disappears |
| [`fiber.dispose`](https://deepseek-harness.github.io/deepseek-harness/en/reference/cordis-api/fiber) recursively unloads and waits for asynchronous cleanup | An explicit Promise controls cleanup completion; it was observed that the parent plugin unload had not yet completed, and after release both child plugins were reclaimed; sleep was not used to guess timing |

Scopes only control service visibility; the above verification does not represent container, disk, or network isolation. Industry behavioral experiment design and community leads follow the [verified first-hand implementation](2026-10-28-executable-probes.md); this time no new Runtime is added based on popularity.

## Implementation

The behavioral experiment adds `await observe(label, jsonValue)`. Test authors explicitly select actual service values and lifecycle states; the runner records immutable snapshots, incrementing sequence numbers, and pass or fail terminal states. Tool receipts and explicit observations are distinguished using `kind: tool/value`, and serial writes prevent concurrent receipts from overwriting newer terminal states.

The native test simultaneously replaces the left Provider's interface, Consumer implementation, and parameters: `apply(number)` becomes `evaluate({operand})`, and the output changes from 6 to 25. There is no compatibility adapter, and this preset architecture is not written into the production optimizer. It proves that these mutations can be checked by native experiments; it has not yet proven that the optimizer can autonomously discover the same refactoring or improve task scores.

Independent review found that `canonical(new Array(1))` once turned a sparse array into an empty array. Sparse arrays are now explicitly rejected, preserving the real failure; both top-level and nested counterexamples are included in regression tests. Non-finite numbers, undefined, functions, and class instances also cannot silently enter JSON observations.

## Measured results and failures

Machine evidence: [service-observations.json](../evidence/2026-10-28-service-observations.json). The final image `sha256:09e0019870b05c7b49def84d54c0e30a14d2e2449ec0d964aa04ba98f26f998b` passed 12 runc container tests; 55 unit tests, 10 native tests, formatting, and type checks passed. The native lifecycle has five real state records, and the container test preserves 8 for the correct service and 12 for the incorrect implementation; the latter remains readable after an independent assertion failure.

Real-model acceptance had another clear failure: the model recorded two `d(5,5)=0` using the new interface, but chose a diagonal property that the incorrect subtraction implementation also satisfies. The Probe returned normally, so the independent acceptance that required capturing a counterexample failed. There was no second sampling, no assertion was changed to let it pass, and the model's self-report was not treated as successful detection. The actual source code and observations are preserved in the machine evidence.

This run verified that the new observation interface can be written and used by a real model, and also showed that **executable experiment capability does not guarantee that an experiment is discriminating**. The native independent counterexample proves the failure-recording path; this model run did not cover that path, so it cannot be jointly claimed that model counterexample acceptance passed.

In addition, three old live test entry points were found not to have synchronized the controlled egress contract: host aliases were explicitly rejected, and the model egress declaration was missing. They now uniformly reuse the Venus routing recipe delivered with the project, and the environment hash is frozen after configuration; the controller address is explicitly specified by the required `HE_TEST_CONTROLLER_IP`, with no direct-connection fallback. The first incorrect image ID and the address contract failure are both preserved, and both occurred before the model task.

The final image also passed two real-model regressions: normal continuation after waiting for a host commit event, and autonomous retrieval, reading, and import of authorized historical negative-result assets. Neither ran task scoring; acceptance records and per-run usage are independently saved in the machine evidence and do not change the above conclusion that counterexample acceptance failed.

## Follow-up research

The next step is to test, in preregistered independent experiments with the same budget, how the optimizer selects experiments that can distinguish mechanisms, and then observe cross-plugin joint mutations and task quality. The hand-written scope migration here cannot be treated as an autonomous evolution result, nor can a single ineffective counterexample be inferred as the model's capability ceiling. The full research and system delivery gaps are still in [completion.md](../completion.md).
