# Launch a Real Evolution Run

[Back to README](../README.md#quick-start) · [Bring your tasks](domain-adapters.md) · [Experiment protocols](optimizer-studies.md)

The default setup uses the official DeepSeek API and three public synthetic structured-data tasks: event merging, request-log aggregation, and dependency-manifest matching. Replace the task adapter to use the same evolution controller in another domain.

**Explore first:** the [online experiment tour](https://oldyade.github.io/SparkVolve/) shows real source changes, per-task results and original-package identity without installing anything or calling a model.

## Preparation

Install Node.js 24.16.0 or later, npm, Python 3, and Docker. Start the Docker daemon. The host must support Unix directory file descriptor operations. The default runtime is Docker's runc; existing gVisor deployments can select `--runtime runsc`. See [runtime isolation](isolation.md).

1. Clone `https://github.com/OLDyade/SparkVolve.git` and enter the repository directory.
2. Set `DEEPSEEK_API_KEY` in a private environment file outside the repository and set its permissions to `0600`. You can also set the variable directly in your shell environment.
3. Set `SPARKVOLVE_EGRESS_POOL` to a reserved private IPv4 CIDR that does not overlap your host, LAN, or VPN networks. Each model execution uses two `/29` subnets. The default three executors plus one optimizer require at least a `/26` pool. See [network configuration](isolation.md).

```bash
npm ci
npm start -- --env-file /absolute/private/deepseek.env
```

The entry point uses `deepseek-flash` through the official Anthropic-compatible API. Only the trusted egress proxy receives credentials. See [DeepSeek configuration](../examples/deepseek/README.md). Real model calls consume your account quota.

### Time, resources and cost

The first launch downloads dependencies and builds container images, then runs the optimizer and the task executions declared by the recipe. It can take substantially longer than one 600-second task budget. Keep Docker running with enough capacity for the recipe's declared concurrency; image size and peak memory depend on the domain adapter. Container-build logs, phase timing and model usage are retained in the run directory. API cost depends on your provider, task lengths and search budget; the online tour makes no API calls. No background evolution starts when you only install dependencies.

## What the command does

```text
Task recipe + model Provider
       │
       ▼
Build runtime image → discover DNS / host addresses → freeze search / validation / reuse tasks
       │
       ▼
Run H0 → DSH optimizer reads evidence → autonomously modifies plugins → independent build and scoring
       │
       ▼
Freeze H* from search scores → independently assess H0 and H* on validation tasks
       │
       ▼
Export the original Bundle → native install into fresh Profiles → execute and grade reuse tasks
```

Each task defaults to 600 seconds, adjustable explicitly with `--task-seconds`; the optimizer's total budget is computed from the full plan. Addresses and DNS are read from the actual Docker deployment, and `--dns` can explicitly specify a deployment-approved resolver. Runtime ports are allocated automatically and persisted.

Output is located in `.evolution/<recipe>-<time>/`:

| Artifact | Content |
|---|---|
| `startup.json` | Startup phase, configuration identity, and failure reasons |
| `registration.json`, `*-data/spec.json` | All three frozen task splits, model and runtime identities, selection rule |
| `search/` | Event ledger, candidates, trajectories, and per-task deliverables |
| `report.json` | Actual scores, verdicts, and model usage |
| `validation/comparison.json` | Fresh independent H0/H* scores and paired differences |
| `installed/acceptance.json` | Original-package installation, per-task execution, grading, identity checks and usage |
| `capability/bundle.tgz` | Raw build package of the selected candidate |
| `command-logs/` | Per-phase logs, preserving original failures |

Startup prints a command for watching events. Failures report an error and preserve the run directory; use the [native CLI](events.md) to inspect or recover the original controller. The entry point never resamples failed tasks. The selected candidate may still be H0: completing the loop does not establish a quality gain. Validation and reuse scores never change the selected version. Default synthetic splits vary inputs within the same task families; they do not establish cross-domain generalization. Task counts, concurrency and deadlines come from the recipe's contract. `SPARKVOLVE_EGRESS_POOL` supplies the network pool; `--pool` explicitly overrides it.

## Bring your tasks

Pass `--recipe path/to/recipe.json` to select another domain. Each split's generation command runs inside the image, with the recipe directory mounted read-only at `/recipe` and its own output directory at `/workspace/dataset`. The preparation script receives the dataset, image, model, contract output path, isolation settings, Provider directory, and per-task time budget. The launcher derives validation-only contracts for the two independent splits. Identical task input digests across splits or differences in frozen model, runtime, scoring or isolation settings are rejected before inference. These checks establish separation and identity, not statistical independence or hidden-data provenance.

| Recipe Field | Purpose |
|---|---|
| `name` | Run name |
| `dockerfile` | Domain dependency image; `null` uses the generic runtime image |
| `generate` | Explicit `search`, `validation`, `reuse` command argv; no shell concatenation |
| `prepare` | Domain contract preparation script |
| `seed` | Starting capability Bundle |
| `preflight` | Optional domain runtime environment validation script |

All file paths are relative to the directory containing the recipe. See the [structured data recipe](../examples/structured-data/recipe.json) and the [spreadsheet recipe](../examples/spreadsheet/recipe.json). The Excel example only requires adding `--recipe examples/spreadsheet/recipe.json`, which automatically installs the required LibreOffice and Python dependencies. You can use `--image sha256:...` to specify an already-built corresponding domain image, or `--provider` to select another native Provider configuration; the model will not be switched automatically.

Use the public examples to try autonomous plugin modification and artifact delivery. For formal research, supply your own task manifest, independent validation set, and repeated-search protocol. See [domain adapters](domain-adapters.md).
