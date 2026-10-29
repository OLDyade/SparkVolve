# Second Domain: Structured Events and Logs

This adapter reuses the same DSH optimizer, experiment contract, frozen build, native assembly QA, independent scoring, and Bundle distribution. The controller adds no domain branches. Input is JSON / JSONL, delivery is JSON, and no Excel or LibreOffice is required.

```text
Events / logs / manifests → native data tool Bundle → DSH executor → result.json
                            ▲                              │
                            │                              ▼
                      optimizer autonomous mutation ← existing experiment controller ← network-isolated independent judge
                            │
                            └── same frozen artifact → native installation and reuse
```

## Tasks and Scoring

| Public synthetic task | Business mechanism verified |
|---|---|
| revision-events | Event deduplication, merging by version, deletion and restoration, preserving null and empty strings |
| request-logs | Composite grouping, server-side error definition, zero latency, mean and nearest-rank quantiles |
| dependency-join | Multi-field exact join, exact exception matching, unmatched records |

The seed provides only `data_read` raw-text reading and `data_write` explicit JSON writing. The optimizer may add general operations, modify the implementation, or modify the assembly on its own; no mutation answer is presupposed. Each round's budget includes the baseline, for two candidates total; each candidate gets three tasks, one attempt per task, for at most six task executions; failures are retained and not redrawn.

The scorer only parses delivered data and does not execute programs supplied by candidates. For each task, the three top-level result fields each count as one item, and the top-level field set counts as another item, for four equally weighted items; nested array order and content are compared according to task rules. Numbers are compared by exact value, and booleans are independent; duplicate JSON keys and non-standard NaN / Infinity are rejected. Missing or incorrect delivery is a business zero score, and corrupted scoring materials cause direct failure. Feedback only states whether each item matches and does not return expected values.

The generator and answer algorithm are public development samples, so these tasks **are not part of an unseen test set**. This experiment verifies cross-domain integration, real autonomous mutation, and the delivery chain; ties and regressions are retained as-is, and no claim of stable cross-domain gains is made on this basis.

## Running

Run from the repository root; dependency versions and credential configuration follow the main README. The image directly uses the generic base image and does not install spreadsheet dependencies.

`HE_TEST_DNS` uses the IPv4 resolver list confirmed by the deployer; for the discovery method and the actual resolution acceptance boundary, see [Egress DNS](isolation.md#egress-dns).

```bash
npm ci
npm run check
docker build -t harness-evolution:local .
mkdir -p .evolution/data
node examples/isolation.mjs runc "${HE_EGRESS_POOL:?Set a reserved private IPv4 CIDR}" \
  "${HE_TEST_DNS:?Set approved comma-separated IPv4 DNS servers}" > .evolution/data/isolation.json
python3 examples/structured-data/generate.py .evolution/data/dataset
node examples/structured-data/prepare.mjs .evolution/data/dataset \
  "$(docker image inspect harness-evolution:local --format '{{.Id}}')" \
  examples/venus/model.json .evolution/data/spec.json .evolution/data/isolation.json examples/venus
node dist/cli.js init --root .evolution/data/search \
  --spec .evolution/data/spec.json --dataset .evolution/data/dataset \
  --seed examples/structured-data/seed
node --env-file=/absolute/private/venus.env dist/cli.js evolve \
  --root .evolution/data/search --host 0.0.0.0 --port 18949 \
  --endpoint "http://${HE_CONTROLLER_IP}:18949"
node dist/cli.js report --root .evolution/data/search --output .evolution/data/report.json
```

`HE_CONTROLLER_IP` must be an explicit IP reachable by the proxy container; you can read Docker's configured host mapping via the README's `scripts/controller-address.mjs`, or specify a configured reachable interface. The data directory, contract, and report all require new paths; after stopping, resume the original experiment with the same `evolve` command, and do not rebuild the directory to disguise a retry. After outputting a frozen candidate via `export`, you can install it using the [native capability entry](use-capability.md), replacing the workbook input with the corresponding JSON data and tasks.

## Implementation Basis

- Python official [`json` documentation](https://docs.python.org/3/library/json.html): default decoding merges duplicate members and accepts non-standard constants; this judge explicitly rejects them with `object_pairs_hook` / `parse_constant`, and `parse_float=Decimal` prevents numeric rounding from becoming a hidden scoring condition. Only interfaces supported by the currently running version are actually used.
- DSH `0.2.1-rc.4` native `defineTool`, SDK Profile, Cordis `inject=['tools']`, and Bundle patch; the new domain does not implement another Agent Loop.
- The seed lockfile uses the same Zod `4.6.7` as the main repository, avoiding the verified [GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5), with zero dependency audit warnings.

The real experiment is complete: [results and independent review](acceptance-structured-data.md). The baseline passed all three tasks; the mutant passed two tasks and timed out on one execution, and was rejected under the full denominator; native installation and real tool invocation of the exported baseline package were verified. Negative results and algorithm counterexamples are fully retained.
