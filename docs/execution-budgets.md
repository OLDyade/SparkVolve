# Execution Budgets and Timeouts

The default for a single task is **600 seconds**. This is the runtime budget for the entire task container, including DSH startup, model waiting, tool execution, and delivery. Explicit experiment configuration can adjust it; the resolved actual value is written into the frozen contract, and resuming a run does not apply a new default value.

```text
Experiment contract timeoutSeconds (default 600)
  ├─ Total task container time limit: jointly observed by the host during execution and resume
  ├─ SDK initialization/protocol requests: use the task budget, with no fixed 60-second initialization cutoff
  └─ Example model configuration
       ├─ HTTP egress requests: default 600 seconds, explicitly configurable
       └─ Provider stream idle: default 600 seconds, explicitly configurable

Optimizer total budget
  = implementation and attribution time
  + build, QA, task batches, and scoring waits for authorized candidates
  + build and execution waits for authorized behavior probes
```

The budget is an allowed upper limit; the run ends immediately upon completion. Enlarging the time limit does not increase the number of candidates, questions, or retries. `optimizerSeconds` includes the time spent waiting for experiments while the optimizer is alive, so when enlarging the per-question budget, its full plan must be accounted for at the same time; the real acceptance driver writes the budget components into the pre-registration.

Native development acceptance can be set explicitly with `--task-timeout-seconds 600`. The current plan of 3 candidate slots and 3 optional probes derives a 7,140-second optimizer upper limit from the original build and scoring budgets, of which 1,200 seconds are reserved for implementation and attribution time; the task execution limit remains 20.

| Time limit | Meaning and handling |
|---|---|
| Total task time limit | Wall-clock budget for a single execution; on timeout it still fails explicitly and preserves the original artifacts |
| Model HTTP | Deadline for a single request and response transfer, independent of the whole task; a shorter explicit value ends the request earlier |
| Model stream idle | Inactivity deadline for waiting on provider data; continuous streaming returns differ from total elapsed time |
| SDK requestTimeoutMs | SDK protocol request deadline; cannot replace the total task budget |
| Native behavior probe | The example full run and QA use 600 seconds; custom probes declare their budget explicitly, and purely mechanical tests may use a shorter time |
| Build, scoring, installation | Each has its own explicit contract; installation stages share the total remaining budget, avoiding hidden short gates per stage |
| Bash tool | The DSH native default may move long commands to the background; the foreground wait window must not be treated as task termination |
| Event long polling, cancellation, and cleanup | Independent observation or resource management operations; keep short time limits and do not expand them in bulk with the task budget |

Any custom provider, tool, or plugin can still declare its own time limits; the framework does not silently override them. When inspecting a new runtime, check the frozen task contract, model egress configuration, and actual provider configuration, rather than looking at only one `timeoutSeconds` field.

## Basis for This Investigation

Checked the DSH official [timeout documentation](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/util/timeout/README.md), as well as the project-locked `0.2.1-rc.4` SDK, `dsh-llm-pi-ai`, and the Bash provider implementation. Found that the original example simultaneously had independent limits of 300 seconds for the task, 300 seconds for egress, 300 seconds for provider idle, and 60 seconds for initialization; the real acceptance outer layer also had a wait window shorter than the task budget.

The previous round of [native development acceptance](experiments/2026-10-28-native-authoring-results.md) retains the original 300-second contract and failure conclusion. The last request took about 284 seconds without obtaining an upstream HTTP status; raising the time limit cannot directly prove that the network or model service failure has been resolved. The new budget applies to newly registered runs; historical results will not be rewritten.

## Verification Results

[Original byte evidence and summary](evidence/execution-budgets-20261028/index.json): 236 unit tests, 24 native tests, and 2 container regressions passed; the 2 subsequently added StartedAt deadline tests passed independently. The new image precheck and real model task passed, with both model requests completed, 0 failures, and 0 incomplete. The task completed in about 4 seconds and was used to verify configuration and real call wiring; the deadline semantics beyond 300 seconds are verified by deterministic tests, and a short task passing is not called a measured long response.

The actual npm tarball of clean commit `136f4ab` has passed native DSH installation and capability invocation, with archive SHA256 `648db5046a0298c211120f915c9280a6c081a437a3ba0c7969c37148aeadb059`. The GitHub-hosted run `40620133728` did not execute any steps due to account payment/quota limits; local acceptance does not replace cloud results.
