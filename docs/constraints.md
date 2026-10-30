# Researchers declare constraints; the judge provides observations

The primary metric answers whether candidate performance improved; explicit constraints define what results this experiment accepts. The `constraints` in the contract is required, and `[]` indicates that auxiliary metrics are reported only. The framework has no built-in Excel retention-rate threshold, and historical experiments are not retroactively re-judged.

```text
Before experiment: primary metric + constraints + failure budget ──freeze──► same experiment identity
                                                    │
plugin mutation → independent execution → independent scorer score / metrics ────┤
                                                    ▼
                         full denominator + primary score comparison + per-item constraint observations
                                                    │
               primary score strictly improves ∧ failure budget satisfied ∧ all constraints pass
                                                    ▼
                                promote / reject + complete adjudication record
```

For example, the researcher requires that non-target content be fully preserved on every task:

```json
{
  "constraints": [
    {"id":"retain-content","metric":"preserved","aggregation":"each","operator":"gte","threshold":1}
  ]
}
```

| Field | Contract semantics |
|---|---|
| `id` | Unique constraint ID within this contract |
| `metric` | Numeric field in the independent scorer `Grade.metrics`; model self-evaluation is not read |
| `aggregation` | `each` requires each task and each repetition to satisfy it separately; `mean` requires the equally weighted average over the complete task set and all repetitions to satisfy it |
| `operator` / `threshold` | `gte` or `lte`, a finite numeric threshold; equality at the boundary satisfies it |

Each item outputs `passed`, `violated`, or `unavailable`, which together with the task, repetition index, actual value, total denominator, and missing reason enter `candidate.decision`. Failed tasks or missing metrics are not zero-filled, not excluded, and do not borrow an old attempt. When mean observations are incomplete, the mean is not computed; when a per-item constraint already has evidence of violation, the violation is reported while missing items are retained. Only when all `passed` is promotion allowed.

Means are computed exactly on the normalized decimal representation of parsed finite values, comparing against the threshold using integer numerators/denominators, with no epsilon added. The report `aggregate` stores the reduced string `numerator` / `denominator`; for example, the mean of 0.1 and 0.2 is `3/20`. The scoring interface still uses JSON number and does not restore precision already lost before the input was parsed as a Number; this rule only eliminates rounding error newly introduced by framework aggregation.

The failure budget controls the acceptable number of execution failures; explicit result constraints additionally require the necessary observations to be complete. Therefore, after declaring a result constraint covering all tasks, even if execution failures do not exceed the budget, a missing constraint observation for that task still prevents promotion. This rule is visible before the experiment starts.

The initial seed is likewise subject to constraint review; if it is not satisfied, its original score is recorded and the no-champion state is maintained. The optimizer can still continue mutating from a rejected seed, and the first candidate that conforms to the contract establishes a feasible champion. After that, primary metrics are compared strictly. Scores are not changed, deliverables are not automatically repaired, and tasks are not rerun because a constraint failed.

Paired re-validation uses the same function and separately reports each arm's constraint observations and raw score difference. When the candidate violates a constraint, `strictImprovement` is false; whether the baseline itself is feasible is still listed in the results, and the score difference is not hidden. The report is a descriptive re-validation and does not prove statistical significance or causal benefit.

`tests/fixtures/spreadsheet/prepare.mjs` generates `constraints: []`, continuing the sample's policy of "primary accuracy adjudication, retention-rate reporting". The researcher may edit the generated experiment JSON before `init` while keeping the objective and constraints consistent. Any contract change requires a new experiment directory; old contracts are not automatically backfilled with fields or migrated.

Mechanism reference and measurements: [research notes](research/2026-10-27-outcome-constraints.md).
