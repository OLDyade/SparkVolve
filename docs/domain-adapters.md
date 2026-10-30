# Integrating a Task Domain

The domain owns tasks, capabilities, and judging; the framework owns candidate identity, experiment scheduling, feedback, selection, and artifact delivery. Integrating a new domain requires no task-specific branches in the controller.

```text
dataset/
├── inputs/<task>/       Task inputs the optimizer is permitted to read
├── evaluation/<task>/   Independent judge and required private materials
├── runtime/             Native Provider / environment Bundle
├── verification/        Researcher-maintained public operational constraints and synthetic tests (optional)
└── optimizer-bundle/    Optimization method Bundle
seed/
├── package.json         dsh.bundle.patch + license + runtime dependencies
├── cordis.patch.yml     Native plugin assembly
└── ...                  Capability implementation
```

1. **Define the task manifest.** Each task has a stable ID, task description, input path, and scoring material path. `inputDigest` / `evaluationDigest` are content hashes; public inputs and scoring directories must be separated. The manifest is not changed during experiment runs.
2. **Provide the runtime image.** Install the runtime tools required by the domain; pin them by image digest. The executor sees `/input` read-only, `/workspace` writable, and `/candidate` read-only, and uses DSH native models and tools.
3. **Provide the seed Bundle.** Register tools, services, or event capabilities through Cordis. The optimizer may change configuration, implementation, and composition; the package must not depend on repository absolute paths or undistributed source code.
4. **Define required QA.** Every candidate always undergoes the full native assembly check. `candidate.qa` fills in the independent test's `{directory, digest, entry}`, or is set to `null` to explicitly add no domain checks. The directory belongs to the dataset, and its content identity enters the experiment contract; the entry point exports `async probe({agent,ctx,call,workspace})` and is executed through the actual Agent's tool pipeline. The optimizer views `/verification` read-only and may change implementation and composition, but cannot modify the operational semantics declared for this round. QA has no network, no model credentials, and no task or evaluation materials; a failure is recorded as `qa_failed`, and the candidate's tasks are not started. Table instance checks cover explicit writes, preservation of source files and non-target data, and no partial commits for invalid edits. Full business correctness remains with the independent judge. See [Independent Domain QA](domain-verification.md).
5. **Provide an independent scorer.** The network-disabled container mounts `/input`, `/delivery`, and `/evaluation` read-only; writes `Grade` to `/workspace/result.json`. The judge program and private materials are not provided to the optimizer.
6. **Freeze the contract.** Validate with the `Experiment` schema, specifying the primary metric, constraints, failure score, full denominator, repetition count, concurrency, budget, and model. `constraints: []` explicitly indicates no additional result constraints. Run with `init → evolve`.

Scoring output:

```json
{"score":0.8,"metrics":{"preserved":1},"feedback":"specific diagnostics permitted for the optimizer"}
```

`feedback` is fed back to the optimizer; the adapter should specify the scope that may be made public and must not return unauthorized answers. `metrics` reports auxiliary metrics separately; only metrics explicitly declared in [constraints](constraints.md) before the experiment participate in constraint adjudication, and candidates that satisfy the constraints are still strictly ranked by the primary score. Missing constraint observations are not imputed. Abnormal exits are scoring faults and may be explicitly re-scored after delivery is preserved; silently converting service failures into valid business scores is prohibited.

The community benchmark adapter explicitly use `constraints: []`, following the default policy of ranking by primary correctness and reporting auxiliary metrics. Domain QA checks tool operational semantics, the scorer computes business results, and additional result constraints are chosen by the researcher before the experiment; the three bear responsibility separately. Semantics required by the task itself, such as deduplication, should be covered by the scorer and must not be penalized again to add a threshold. When there are genuinely inviolable domain requirements, declare the corresponding observations and constraints in a new contract; do not modify old experiments, and do not hard-code retention, latency, or cost thresholds in the framework.

## Community benchmark modules

The default adapter is [SpreadsheetBench 2](../benchmarks/spreadsheetbench2/README.md). Replace it with `npm start -- --benchmark path/to/index.mjs` without changing the controller.

Export `benchmark` with a unique name, Dockerfile, seed source and registered mutation spaces, plus `async prepare({root, inputs, image, isolation, model, provider, method, run, taskSeconds})`. Return:

```js
{
  splits: {
    development: {specification, dataset: {directory, digest}},
    validation: {specification, dataset: {directory, digest}},
    test: {specification, dataset: {directory, digest}}
  },
  provenance,
  boundary
}
```

Paths are relative to the trusted `inputs` directory. Specifications share the frozen model, runtime, evaluator, primary metric and isolation contract. The loader verifies dataset digests and input separation before inference. Group related tasks by their underlying source family; record overlap with prior public experiments explicitly.

Optional `hostSearchProtocol.screening` selects a fixed subset of development task IDs and a minimum mean-score delta against H0 on exactly those tasks. H0 runs the complete development set. A screened-out candidate has no full-panel score; a passing candidate executes only its remaining tasks. This screen requires full authorized development feedback, has no access to validation or test, and cannot change during a search.

The startup driver pre-registers the mutation spaces, freezes selected candidates, selects against independent validation with H0 winning ties, then installs the original H0 and selected archives for fresh test execution. Test outcomes never select or mutate a candidate.

Historical synthetic cases remain in `tests/fixtures` for deterministic regression testing. Their [archived observations](acceptance-structured-data.md) document engineering behavior; they are excluded from the community benchmark and the current Quick Start.
