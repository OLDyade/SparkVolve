# Launch a Real Evolution Run

[Back to README](../README.md#quick-start) · [Bring your tasks](domain-adapters.md) · [Experiment protocols](optimizer-studies.md)

The default setup uses the official DeepSeek API and three public synthetic structured-data tasks: event merging, request-log aggregation, and dependency-manifest matching. Replace the task adapter to use the same evolution controller in another domain.

## Preparation

Install Node.js 24.16.0 or later, npm, Python 3, and Docker. Start the Docker daemon. The host must support Unix directory file descriptor operations. The default runtime is Docker's runc; existing gVisor deployments can select `--runtime runsc`. See [runtime isolation](isolation.md).

1. Clone `https://github.com/OLDyade/spark-harness-evolution.git` and enter the repository directory.
2. Set `DEEPSEEK_API_KEY` in a private environment file outside the repository and set its permissions to `0600`. You can also set the variable directly in your shell environment.
3. Set `HE_EGRESS_POOL` to a reserved private IPv4 CIDR that does not overlap your host, LAN, or VPN networks. Each model execution uses two `/29` subnets. The default three executors plus one optimizer require at least a `/26` pool. See [network configuration](isolation.md).

```bash
npm ci
npm start -- --env-file /absolute/private/deepseek.env --pool "$HE_EGRESS_POOL"
```

The entry point uses `deepseek-flash` through the official Anthropic-compatible API. Only the trusted egress proxy receives credentials. See [DeepSeek configuration](../examples/deepseek/README.md). Real model calls consume your account quota.

## What the command does

```text
Task recipe + model Provider
       │
       ▼
Build runtime image → discover DNS / host addresses → freeze task, model, and isolation contract
       │
       ▼
Run H0 → DSH optimizer reads evidence → autonomously modifies plugins → independent build and scoring
       │
       ▼
Save reports, traces, and failures → export the selected candidate's original Bundle
```

Each task defaults to 600 seconds, adjustable explicitly with `--task-seconds`; the optimizer's total budget is computed from the full plan. Addresses and DNS are read from the actual Docker deployment, and `--dns` can explicitly specify a deployment-approved resolver. Runtime ports are allocated automatically and persisted.

Output is located in `.evolution/<recipe>-<time>/`:

| Artifact | Content |
|---|---|
| `startup.json` | Startup phase, configuration identity, and failure reasons |
| `spec.json`, `search/` | Frozen contract, event ledger, candidates, trajectories, and per-task deliverables |
| `report.json` | Actual scores, verdicts, and model usage |
| `capability/bundle.tgz` | Raw build package of the selected candidate |
| `command-logs/` | Per-phase logs, preserving original failures |

Startup prints a command for watching events. Failures report an error and preserve the run directory; use the [native CLI](events.md) for recovery. The entry point never resamples failed tasks. The selected candidate may still be H0: completing a run does not establish a quality gain. This entry completes the development-task loop with independent grading. Method comparisons use a separate validation set and a [pre-registered protocol](experiments/2026-10-29-mutation-space-registration.md).

## Bring your tasks

Pass `--recipe path/to/recipe.json` to select another domain. Its generation command runs inside the image, with the recipe directory mounted read-only at `/recipe` and output written to `/workspace/dataset`. The preparation script receives the dataset, image, model, contract output path, isolation settings, Provider directory, and per-task time budget, then creates a generic Experiment contract.

| Recipe Field | Purpose |
|---|---|
| `name` | Run name |
| `dockerfile` | Domain dependency image; `null` uses the generic runtime image |
| `generate` | argv of the data generation command, no shell concatenation |
| `prepare` | Domain contract preparation script |
| `seed` | Starting capability Bundle |
| `preflight` | Optional domain runtime environment validation script |

All file paths are relative to the directory containing the recipe. See the [structured data recipe](../examples/structured-data/recipe.json) and the [spreadsheet recipe](../examples/spreadsheet/recipe.json). The Excel example only requires adding `--recipe examples/spreadsheet/recipe.json`, which automatically installs the required LibreOffice and Python dependencies. You can use `--image sha256:...` to specify an already-built corresponding domain image, or `--provider` to select another native Provider configuration; the model will not be switched automatically.

Use the public examples to try autonomous plugin modification and artifact delivery. For formal research, supply your own task manifest, independent validation set, and repeated-search protocol. See [domain adapters](domain-adapters.md).
