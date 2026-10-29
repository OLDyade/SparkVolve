# Security boundaries

## Reporting vulnerabilities

This repository is a public project. Please use GitHub's [private vulnerability reporting entry point](https://github.com/OLDyade/spark-harness-evolution/security/advisories/new) (Security → Report a vulnerability) to submit security issues; this feature was enabled on 2026-10-29 and confirmed via API read-back. Ordinary feature issues continue to use public Issues.

Please provide the affected commit or version, runtime environment, minimal reproduction, expected and actual permission boundaries, and scope of impact. Attach only redacted materials; do not submit real keys, customer inputs, private scoring answers, or other people's full model trajectories, and do not disclose exploitable details in public Issues.

Maintainers confirm impact, discuss fixes, and coordinate public disclosure through the same private report. Fix records should state the affected versions, fix commits, and known limitations; acknowledgments follow the reporter's wishes. There is currently no stable release or long-term support branch; security fixes on the development mainline are recorded as explicit commits, and no service response SLA that has not yet been established is promised.

## Execution boundaries

The runtime, non-root user, resources, and per-role network permissions are declared by a mandatory frozen isolation contract. Creation, restoration, and termination all verify the actual container settings and retain receipts that contain no environment variable values. For configuration and measured boundaries, see [Runtime isolation](docs/isolation.md).

| Principal | Accessible | Not mounted |
|---|---|---|
| Optimizer DSH | Drafts, authorized evidence API, read-only evidence snapshots, controlled model entry point | Database, scoring private directory, Docker socket, real upstream credentials |
| Executor DSH | Frozen candidate, that task's inputs, working directory, run trajectory | Scoring private directory, control database, Docker socket |
| Scorer | That task's inputs, frozen deliverables, that task's scoring materials | Model credentials, network, optimizer drafts |

The controller, experiment specifications, and egress broker are part of the trusted computing base; run them only on trusted workstations. Candidates are executable code. Containers use read-only root filesystems, capability dropping, and resource limits; this does not constitute complete protection against arbitrary malicious plugins, host administrators, or kernel vulnerabilities. Model providers can still see the task content sent to them.

Controlled execution uses a separate worker/broker network and frozen egress routes; the broker checks the target, address, and request contract before injecting real upstream credentials; the model process only receives client-side placeholder values. Control API routes use separate capability credentials, and the scorer has no network. For configuration, real requests, and recycling evidence, see [Controlled egress](docs/controlled-egress.md). Ordinary runc containers still share the kernel; when gVisor is declared, a missing runtime fails immediately; for unfinished items on MicroVM and persistent disk hard quotas, see [Implementation status](docs/completion.md).

Authorized file reads must be opened layer by layer from a trusted directory handle, rejecting symbolic links and special files; path string validation cannot replace this boundary. Binary evidence is fully published via private staging to the optimizer's read-only mount `/evidence`, and is not written by the host into the model-writable `/workspace`. This mechanism does not treat evidence content as trusted instructions, nor does it prove that candidate telemetry in the same process cannot be forged.

`/tmp` explicitly allows execution to support DSH native dynamic library caching; nosuid/nodev are retained. The scorer having no network does not mean formula files have no local attack surface; scoring images must be patched promptly.

Experiment credentials are injected only into the trusted broker and are not placed in model prompts or candidate code. The [independent capability entry point](docs/use-capability.md) is only for reviewed trusted Bundles; it passes model credentials directly to the container, where same-process plugins can read them; this experience entry point must not be used to run unreviewed candidates. Run trajectories may contain inputs, generated code, and tool output, and by default are private research materials; `export` generates a local archive and **will not be published automatically**.
