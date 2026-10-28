# Execution time budgets

New example contracts default each model task and autonomous code probe to **600 seconds**.
The shared default comes from `DEFAULT_TASK_TIMEOUT_SECONDS` in the framework contract.
The task deadline covers its container's full lifetime, including SDK startup and inference.

Both preparation commands accept the same optional trailing arguments:

```text
node examples/<spreadsheet|structured-data>/prepare.mjs \
  <dataset> <image-digest> <model.json> <spec-output> <isolation.json> \
  [task-seconds] [optimizer-seconds] [model-http-seconds] [probe-seconds]
```

HTTP and probe limits inherit the selected task limit when omitted. The selected HTTP
limit configures the egress route and DSH's Venus **provider** `timeoutMs` and
`streamIdleTimeoutMs`. For example, selecting 900 task seconds also sets both provider
limits to 900,000 ms. An explicitly supplied shorter HTTP limit remains shorter; launchers
do not clamp, extend, or retry it. These options generate a new explicit contract and
provider configuration; existing frozen experiments retain their original limits.

The optimizer's wall budget is separate from one task's deadline. Its default includes:

```text
authoring allowance
  + each candidate after H0 × (build + native QA + task/scoring waves)
  + every declared probe × (build + probe execution)
```

Spreadsheet and structured-data authoring allowances are 1,800 and 600 seconds,
respectively. `optimizer-seconds` overrides the complete total explicitly. Task waves
use the declared concurrency and repetitions; the declared build and evaluator deadlines
remain independent. The source helper is `examples/timeouts.mjs`.

Real-model feedback and optimizer-study drivers expose `--task-timeout-seconds`,
`--model-http-timeout-seconds`, and `--optimizer-seconds`. The optimizer-study driver also
exposes `--probe-timeout-seconds` and `--meta-optimizer-seconds`; its default meta budget
includes method preparation and complete nested development jobs. Materialization uses
the task and HTTP flags. Controlled-controller and native-egress accept the task and HTTP
limits after their evidence-directory positional argument. All selected values are
recorded in generated contracts or acceptance receipts.

Pure build, grading, Docker metadata/readiness, and installation operations keep their
own limits. Native-egress acceptance enforces its task deadline from Docker `StartedAt`
and kills the worker at expiry; its extra exit-collection allowance does not extend model
execution. Optimizer-study artifact installation reuses the shared installer with one
480-second total budget, including composition validation.
