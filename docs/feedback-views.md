# Compare the effect of feedback while keeping the same optimizer

To study whether feedback helps plugin evolution, the same G, a shared H0, and the search budget must be frozen, and the host must control the evidence the model can see. Merely asking the Prompt to ignore scores cannot isolate scoring, trajectories, and champion-selection information.

The host protocol has passed same-G two-arm acceptance with real Docker/native DSH, as well as the original fixed three-arm regression. [Machine evidence](evidence/2026-10-28-feedback-views.json) records the frozen image, request ledger, original failures, and terminal-state re-entry checks; the model uses deterministic fixtures, and the method's benefit still awaits real research.

```text
                 frozen G / H0 / task / budget
                              │
                 ┌────────────┴────────────┐
                 ▼                         ▼
         full + seed-only          mechanical + seed-only
         raw task feedback visible     public inputs, source visible
         build and assembly results visible   build and assembly results visible
                 │                         │
         each mutation forks from H0         each mutation forks from H0
                 │                         │
                 └────────────┬────────────┘
                              ▼
                 host full accounting, common-rule selection of H*
                              │
                 same frozen artifact → independent task evaluation
                              │
                 paired by full search instance, report cost
```

## Frozen research conditions

Each new `Experiment` must explicitly fill in `hostSearchProtocol`; there are no implicit defaults:

```json
{
  "hostSearchProtocol": {
    "ancestry": "seed-only",
    "feedback": "mechanical"
  }
}
```

| Field      | Values and meaning                                                                     |
| ---------- | -------------------------------------------------------------------------------------- |
| `ancestry` | `unrestricted` allows selecting a parent version among experiment-authorized candidates; `seed-only` only allows forking from the registered H0 and submitting  |
| `feedback` | `full` opens the task feedback authorized by the experiment; `mechanical` opens only the information needed for task inputs, candidate programming, and mechanical acceptance |

`mechanical` must be paired with `seed-only`. `seed-only` experiments jointly disable the research asset library, behavior probes, and domain QA: `researchLibrary`, `probes`, and `candidate.qa` are all `null`. Native assembly QA is retained to confirm that code can load, dependencies can resolve, and tools can register.

The above restrictions apply to this controlled study. Ordinary autonomous evolution explicitly uses `unrestricted + full`, continuing to support multi-generation forking, asset reuse, and authorized behavior experiments.

## Model view and raw ledger

The host retains complete scoring, trajectory, delivery, and selection records. The feedback protocol controls the model view of the native evolution tools and their HTTP interfaces; host scheduling and research reports read the trusted ledger and do not infer whether a task has ended through the restricted model interface.

| Entry                          | `mechanical` requirements                                                           |
| ------------------------------ | ----------------------------------------------------------------------------- |
| Status, submission receipts, and duplicate submissions       | Does not return scores, champions, promotion/elimination status, or constraint rulings; submitted candidates uniformly present the necessary lifecycle status |
| Events and waiting                     | Uses the model view's own continuous cursor, without exposing raw scoring events or their sequence gaps                    |
| Inputs                           | Reads public inputs by registered task id, without first obtaining a hidden run id                          |
| Evidence manifests, file reads, raw-byte materialization | Shares authorization rules; task delivery and trajectories cannot bypass restrictions through another read form                      |
| Forking and parent version declaration               | Checks H0 in both places; selection results cannot be obtained by requesting the current champion as the parent version                     |
| Ending and resumption                     | The ending receipt keeps the same view; resumption checks the frozen contract and does not reselect the feedback policy                    |

The model event cursor is `{ experimentId, viewDigest, sequence }`. `viewDigest` binds the experiment and feedback view; cross-experiment, cross-view, or ahead-of-sequence cursors are all rejected. The host read-only CLI retains raw event sequence numbers; the two kinds of cursors are not interchangeable.

Public inputs are read through `evolution_input`, or a reference from `evolution_materialize` can be passed directly to the file tool:

```json
{
  "kind": "task",
  "id": "<registered-task-id>",
  "area": "input",
  "file": "<input-relative-file>"
}
```

Materialized files remain in the experiment's own read-only `/evidence` mount. A previous optimizer session under the same contract can be used for continuation; changing the policy requires creating a new experiment and cannot reuse another group's session, materialized files, or registration directory.

## The same G can become two research arms

Each arm of the fixed comparison explicitly registers `method` and `hostSearchProtocol`. G's source, build, and assembly identity remain independent; the experiment arm identity is jointly determined by this method identity and the host protocol. The same G with different protocols can be compared; repeated use of the same G with the same protocol uses `repetitions`.

Sub-searches use the frozen protocol of the corresponding arm, and all arms share an independent assessment contract. Reports retain the arm id, G identity, protocol, full search repetitions, failures, independent scores, and actual cost. The control baseline points to the registered arm and is not swapped for a better-performing method based on results.

Contract changes do not automatically rewrite historical registrations or historical results. Old contracts missing required fields cannot be directly resumed with the new executor; the original terminal-state records and corresponding code commits remain preserved. Do not add fields to old JSON and then pass it off as the original experiment identity.

## What can be answered

This comparison measures **the effect of trusted host task feedback**. G still has the same Shell, source, and public inputs and can write its own tests; therefore the mechanical group has not lost all autonomous verification capability. Lifecycle timing and resource contention may also provide side information, so interface isolation must not be described as eliminating all information pathways.

Deterministic model fixtures only validate wiring, permissions, denominators, and resumption. The method's benefit still requires real model search, independent evaluation, and full search repetitions to prove; identical allocation caps do not mean identical actual Tokens or costs. For the research basis and the not-yet-registered scale, see [feedback causal protocol](research/2026-10-28-feedback-causal-protocol.md).
