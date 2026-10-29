# From Search Results to Trustworthy Conclusions

Search finds candidates; independent validation tests them. When publishing results, distinguish run-chain pass, development-set improvement, validation gain, and cross-domain transfer.

## Frozen Comparison Protocol

Before starting, fix the tasks, repetition count, model, image, metrics, failure rules, and candidate selection method. Baseline and candidates use the same task contract; each comparison group re-runs the full task set and must not mix in old scores from the search. Model temperature and backend service fluctuations may affect results; retain every repetition.

A completed search may use newly generated public tasks to prepare validation. The following commands run at the repository root; `<digest>` is the completed mutation selected before the search ended.

```bash
# New task directory; development and validation generate different values
docker run --rm \
  --mount type=bind,src="$PWD/examples/spreadsheet",dst=/example,readonly \
  --mount type=bind,src="$PWD/.evolution/business",dst=/workspace \
  sparkvolve-spreadsheet:local \
  python3 /example/research.py /workspace/validation-data validation

node examples/spreadsheet/validation.mjs \
  .evolution/business/search <digest> .evolution/business/validation-data \
  .evolution/business/validation-plan 2

node --env-file=/absolute/private/venus.env dist/cli.js validate \
  --root .evolution/business/validation-study \
  --spec .evolution/business/validation-plan/spec.json \
  --dataset .evolution/business/validation-plan/dataset \
  --arms .evolution/business/validation-plan/arms.json
```

`registration.json` is written before task execution; `comparison.json` contains the full denominator for each group, per-task per-repetition pairing, mean difference, sample standard deviation, and failure count. Execution order is recorded in the report; no claim is made that time-period confounding has been eliminated. Sample standard deviation is not a confidence interval; repetitions share tasks and cannot be treated as a count of independent tasks.

Each arm registers `source`, source `digest`, the `artifact` path, and the full `build` identity. Validation directly copies the package already frozen at search time, verifies the original lock, artifact tree, and tarball hashes one by one, and runs the same artifacts. Validation does not execute build scripts; even if a build script contains time or random output, it cannot change the selected version. Modifications after source import constitute a new search candidate.

`validation` does not enable the optimizer API. Re-running the command on the same study only resumes the original execution and does not sample additionally. A scoring failure that leaves the report incomplete does not implicitly discard failed tasks. If a new round of search uses these results, the data must be marked as seen and a separate follow-up validation set must be created.

## Research Assets and Reuse

A search may explicitly authorize [native behavior probes](behavioral-probes.md): the optimizer tests draft tools/services in an isolated environment without accessing independent scoring materials. At pre-registration, freeze both the probe count and the timeout budget; when comparing different optimizers, count each one's full experimental overhead. Passing a self-written probe does not mean independent validation passed, nor does it produce an official task score.

```bash
node dist/cli.js remember --root .evolution/business/search \
  --candidate <digest> --library .evolution/library
node dist/cli.js library --library .evolution/library --query "spreadsheet"
node dist/cli.js import --root <another-initialized-search> \
  --archive .evolution/library/<archive-id> --draft imported-mechanism
```

The archive contains the frozen Bundle, lineage, contract, results, events, and usage evidence. The same candidate from different experiments is stored separately; negative results are equally queryable. Imported drafts must be resubmitted and validated, and do not carry old scores as current gains.

## Comparing Optimizers Themselves

`optimizerHarness` is an independent native Bundle that can change the research method implementation and composition. When comparing optimizer versions, search separately under the same initial capability, development tasks, model, and total budget, then place each one's pre-selected candidate into the same independent validation. The entire search cost and all failed candidates must be reported; comparing only the best run is not allowed. The current CLI provides these run and validation components; a research strategy that automatically selects the next-generation optimizer requires separate validation and has no gain conclusion yet.

## Minimum Evidence for Publication

Submit the version, DSH/model/image identity, data sources and permissions, pre-registered protocol, all paired results, costs and failures, ablations, and reproduction commands. Historical SpreadsheetBench results are cited separately from this repository's new acceptance. A perfect score on synthetic cases only indicates that this task group passed; public materials do not claim to reach the upper bound of general commercial spreadsheet quality.
