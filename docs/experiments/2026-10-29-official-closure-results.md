# Official DeepSeek Entry: Complete Native Closure

[Machine evidence](../evidence/closure-20261029/startup.json) · [Autonomous source diff](../evidence/closure-20261029/structured-h1.patch) · [Native counterexamples](../evidence/closure-20261029/structured-counterexamples.json)

The public `npm start` entry now completes the entire engineering path in one invocation: freeze three task splits, run autonomous plugin development, independently validate the search selection, export its original archive, install it into clean native DSH Profiles, and execute new reuse instances. Task recipes replace the domain without changing the controller. The default provider is official DeepSeek and each task receives 600 seconds.

```text
One command + private credentials + explicit deployment network
                              |
              Freeze search / validation / reuse
                              |
     Real DSH optimizer -> source mutation -> native probes
                              |
              Independent task scoring -> strict selection
                              |
            Frozen H0 / H* independent validation
                              |
       Original bundle.tgz -> native plugin add -> clean Profile
                              |
             Fresh tasks -> isolated grader -> evidence
```

## Observed Results

Run: 2026-10-29 06:05:17–06:17:35 UTC; official `deepseek-flash`, reasoning off, DSH 0.2.1-rc.4. The exact driver, image, recipe, dataset, source and build identities are in the machine record. The raw local directory is `.evolution/official-closure-20261029`.

| Stage | Registered executions | Mean score | Outcome |
|---|---:|---:|---|
| Search H0 | 3 | 100% | Retained |
| Autonomous H1 | 3 | 91.67% | Rejected |
| Independent H0 validation | 3 | 100% | Complete |
| Independent selected-H validation | 3 | 100% | Same H0 source and build |
| Original-package reuse | 3 | 100% | Clean installation and integrity checks passed |

All **15 task executions** completed and were independently graded, with no task retry. The baseline already scored 100%, so no candidate could exceed it on this search batch. The selected and installed package is explicitly **H0**, not the rejected mutation. The pipeline is verified; this run does not demonstrate an improvement in accuracy.

The exported archive, all three native installations and post-execution integrity checks share SHA-256 `8d601c638fab194035fa40e5c49bad89de6789ea0108e38d3accca7e7a6d702c`. Validation and reuse use separately generated public instances, preserving zero latency, null and empty values, tombstones, and exact-name/version joins. These checks do not establish transfer to unknown task families.

## Autonomous Development and Failure Evidence

The optimizer authored a structured-data plugin with byte/digest receipts, declared-shape inspection and exact literal replacement. It wrote four native behavior probes, retained three failures, and removed a scheduler interception after observing that it had no effect. The final source diff reconstructs the frozen candidate digest `fc07b38d059417da824c44e608dcc5d37c9a47789be76bbef72ec52bd6eb2506` exactly; the maintainer did not repair this candidate and then present it as autonomous output.

The proposed guidance text was absent from all three first executor requests. The candidate accesses `systemPrompt` without declaring the service dependency and catches registration errors. This directly limits the intended guidance mechanism; it does not explain every quality result. Real executor traces invoked `data_verify` once and `data_write` once, but not `data_replace`.

The lower score came from omitting an entity whose valid value was an empty string. A separate network-disabled native test of the unchanged rejected artifact also reproduced two general counterexamples:

| Explicit input / contract | Observed response |
|---|---|
| JSON array `[{"amount":7}]`, declared root kind `object` | Reports `rootType: object`, `valid: true`, inspecting the first element |
| Object `{"amount":7}`, exact expected keys `["different"]` | Reports `keySetMatches: false` together with `valid: true` |

The [counterexample source](../evidence/closure-20261029/structured-counterexamples.mjs) is separate from the original evaluator. Its `passed` status means that these defects were reproduced, not that the candidate passed semantic acceptance. Scores and the rejection remain unchanged.

## Usage and Scope

Across optimizer, search, validation and reuse: **312 adapter requests started / 312 returned / 0 failed / 0 unfinished**, with **208,897 reported input tokens** and **63,077 reported output tokens**. All observed requests reported usage. The summed request duration is 739.315 seconds and includes concurrent activity; it is not elapsed wall time or a monetary bill.

The entry uses the existing DSH runtime, experiment controller, independent grader and native installer. No second Agent Runtime, automatic output repair, hidden task replacement or forced promotion is introduced. The mutation-space comparison runs separately under its [preregistered protocol](2026-10-29-closure-study-registration.md).
