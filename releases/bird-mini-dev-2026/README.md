# BIRD Mini-Dev 2026 release

SparkVolve evolved a Text-to-SQL harness on BIRD Mini-Dev 2026 with the model weights fixed. This release contains the evolved executor plugin and the optimizer that produced it.

## Result

| Split | Tasks | H49 EX |
|---|---:|---:|
| Development | 300 | 91.67% (275/300) |
| Validation (not used in evolution) | 100 | 89% (89/100) |
| Test (not used in evolution) | 100 | 91% (91/100) |
| **All official tasks** | **500** | **91.0% (455/500)** |

Starting point H0 on the development set: 76.1%.

- Benchmark: [`birdsql/bird_mini_dev`](https://huggingface.co/datasets/birdsql/bird_mini_dev) @ `5b256b5a`, SQLite (CC BY-SA 4.0). Data and gold SQL are not redistributed.
- Model: `deepseek/deepseek-v4-flash-0731`, provider-default thinking, no weight updates.
- Execution: interactive native DSH agent, 300 s per task.
- Grader: official `calculate_ex`, executed unchanged.

## Contents

| Path | What it is |
|---|---|
| `h49/source/` | Evolved executor plugin H49: `guidance.md` (23 evolved SQL reasoning rules), `index.mjs` (60 s per-call bound for bash), configuration and lock file |
| `h49/bundle.tgz` | Installable package built from that source |
| `h49/build-receipt.json` | Source, lock and tarball digests |
| `optimizer/source/` | Optimizer plugin G (`813cfc0a`), the version that ran the final search: source, strategy and configuration |

## Use

Install the evolved capability into a native DSH profile; no optimizer is needed. See [Install a capability](../../docs/use-capability.md).

```bash
node examples/capability/install.mjs releases/bird-mini-dev-2026/h49/bundle.tgz
```

Verify the package:

```bash
shasum -a 256 releases/bird-mini-dev-2026/h49/bundle.tgz   # matches tarballDigest in build-receipt.json
```
