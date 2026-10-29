# Optimizer Self-Evolution: Independent G/H Versions and Same-Budget Experiments

Status: **protocol implemented, real-model study completed, distribution wrap-up accepted separately**. This document corresponds to the "Optimizer Self-Evolution · Extended Mode" of `11.md`, and records the design rationale and implementation boundaries; the native interface, persistent coordination, recovery, cancellation, and evidence reading have passed targeted acceptance. The real G0/G1 development scores were tied, and G0 was ultimately retained; the new tool registration did not translate into actual use, and a G self-evolution benefit has not yet been demonstrated. Study verification date: 2026-10-28. For the public interface see [Optimizer Studies](../optimizer-studies.md); for raw results and defects see the [actual study report](../experiments/2026-10-28-optimizer-study-results.md).

Optimizer G studies and modifies executor H; G's own research and validation plugins can also become evolution targets. G/H are frozen as separate versions, and the H ultimately found by the old and new G are compared from the same starting point and budget; evolutionary results continue to be delivered using native DSH plugins and the assembly mechanism.

## Current Implementation and Gaps

| Mechanism | Reused Capability | Current Implementation |
| --- | --- | --- |
| `src/optimizer.ts`, `src/preset.ts` | Native DSH sessions, plugin composition, candidate submission, and controlled experiment tools | `optimizer-harness.ts` unifies source builds and frozen artifact import; runtime loads only verified build packages |
| `src/build.ts` | Source, lock, bundle, tarball identity, and build verification | G/H share the actual Bundle build protocol; the same G imports the original artifact in each search arm without rebuilding |
| `src/controller.ts` | H candidate scheduling, task isolation, scoring, and persistence | `optimizer-study.ts` schedules existing searches on the trusted host, and `optimizer-study-runner.ts` runs the native DSH meta-optimizer |
| `src/validation.ts` | Paired validation under the same contract for a fixed H and the full denominator | `validateFrozenArm` accepts the original frozen H*; the Study pairs by complete search instance, and after development selects G, feedback is closed before final validation |
| `src/contracts.ts` | Per-experiment candidate count, optimizer time, task timeout, concurrency, and network contract | `optimizer-study-store.ts` reserves budget and descendant identity before launch; cancellation reclaims along registered executions and is recoverable |

The existing generic domain interface continues to carry each task domain. Ordinary task containers receive only inputs, candidates, workspace, and traces, and the grader is independently network-isolated; they do not have the host permissions needed to schedule inner-layer research. Putting the Controller directly into a domain plugin would force ordinary candidate code to touch scheduling permissions, model credentials, or private evaluation materials.

Therefore, nested research is carried by the **trusted host-side `OptimizerStudy` coordination capability**, reusing the existing Controller, optimizer, build, and validation. Inner-layer tasks still run through native DSH, without adding a second AgentLoop, and without exposing the Docker socket to ordinary candidates. The host defines resource and data boundaries, and the optimizer autonomously decides how to research, modify plugins, and organize capabilities.

## Complete Experiment Path

```text
Freeze G0, H0, data partitions, and the research contract
                 │
        Native DSH meta-optimizer session
  Approved traces / development feedback / failures / cost
  Autonomously modify G's plugin code, configuration, and composition
                 │
       G1 build, native QA, independent freeze
                 │
       Trusted OptimizerStudy coordinator
                 │
    ┌────────────┴────────────┐
    │                         │
 Frozen G0                   Frozen G1
 Same H0                     Same H0
 Same search data            Same search data
 Same budget cap             Same budget cap
    │                         │
 Native DSH searches H       Native DSH searches H
    │                         │
 Select H* from dev feedback Select H* from dev feedback
    └────────────┬────────────┘
                 │
       Freeze H*, score on independent validation side
                 │
     Search-instance paired report, complete failures and cost
                 │
      Select G at round boundaries per the research contract
```

Here, building, isolation, and scoring are performed by the experiment system, and the model is not required to follow hard-coded research steps. G1 must retain real generation traces, source code, and assembly differences; a manually pre-written method that the model merely restates cannot count as autonomous improvement.

## Same Budget and Independent Evidence

Whether feedback improves mutation and whether G self-evolution improves search are two questions that must be tested separately. The [feedback causal comparison plan](2026-10-28-feedback-causal-protocol.md) records the rationale for fixed comparison arms, feedback views, and search-instance-level analysis; that plan has not yet been admitted, and the current real synthetic Study still belongs to mechanism acceptance.

- **Common starting point**: each paired search instance uses the same H0, task contract, data, and resource cap. A new instance does not secretly inherit the previous instance's champion.
- **Explicit budget**: compare the same allocation cap and record actual consumption. Candidate, probe, build, task, and optimizer costs are accounted separately; G1 meta-optimization cost is listed separately. A single `maxTokens` does not equal a whole-round token budget, and without an implemented cumulative limit, no equal-token experiment is claimed.
- **Independent selection and validation**: each G selects H* based on approved development feedback, then freezes H* and hands it to independent validation. That round's validation materials and results do not flow back into the current search and meta-optimization sessions. Development selection and final validation of multiple G candidates should also be kept separate.
- **Effective experimental unit**: the primary comparison unit is the complete search instance; each instance records the G build identity, H0, contract, data, repetition number, and H*. Multiple problems within the same search cannot be treated as multiple independent G experiments.
- **Complete results**: failed and incomplete instances are retained and enter the report per pre-registered rules, without discarding or resampling. The report covers final validation quality, paired differences, regressions, and cost, distinguishing a single valid experiment from a reproducible benefit.
- **Discriminative tasks**: prioritize pre-registered multi-domain tasks and repeated pairing. If the baseline is already at full score, the task can validate the process but cannot prove an optimization benefit; changing tasks requires re-registration, and favorable samples cannot be selected after seeing G's results.

## Landing Interfaces and Acceptance

1. **Frozen method reference**: bind G's source code, build receipt, and composition together, verify at runtime, and load from the frozen artifact; G/H are versioned separately, and active sessions are not hot-modified.
2. **Research contract and coordinator**: register comparison arms, common H0, data partitions, search budget, and result selection rules. Sub-experiments receive only their own restricted control capability, and private validation materials remain on the independent scoring side.
3. **Research lifecycle**: persist resource reservations before sub-experiment launch; handle all descendants when the parent study is cancelled; recovery reuses the original study and attempt identity. G load or QA failures are exposed directly and retained, without silently falling back to G0.
4. **Search paired report**: reuse the existing fixed-H validation, then aggregate the H* found by each G's search; save installable G/H artifacts and lineage, and do not merely output higher numbers.

Deterministic and native acceptance covers: frozen artifact identity, budget overruns rejected before launch, termination/recovery not duplicating sub-experiments, parent-child permission isolation, validation materials unreadable by G, and loading of G plugins in real DSH sessions. The real closed loop has run "meta-optimizer generates G1 → G1 searches H → independent comparison"; in this round the G1 tools were not actually invoked, and loading, usage, and quality benefit are reported separately.

## Verified Ecosystem Evidence

| Source and Pinned Version | Verification Conclusion and Adoption Boundary |
| --- | --- |
| [DSH composition guide](https://github.com/deepseek-ai/deepseek-harness/blob/22ddee3792402c3e70ec5f86a63c3e3e895a2f60/packages/preset/agent-preset/skills/editing-cordis-compositions/SKILL.md), [preset mount check](https://github.com/deepseek-ai/deepseek-harness/blob/22ddee3792402c3e70ec5f86a63c3e3e895a2f60/packages/preset/agent-preset-registry/src/mount.ts) | Distinguish host services from preset-scoped contributions; service providers and consumers need a consistent isolate realm. Adopt native assembly and lifecycle; the project-pinned `0.2.1-rc.4` differs in version from this HEAD, and integration follows the actually pinned source. |
| [VERSE meta_teacher.py](https://github.com/wzekai/VERSE/blob/d8ff0adab0cf82e13d7878f84ff84f823cb2f6c9/verse/evolution/meta_teacher.py) | Distinguish H search from G self-modification; method documents, tools/hooks can evolve, and mechanical health acceptance is performed at round boundaries; a single round's H score is insufficient to attribute G modifications. Borrow independent versioning and controlled budget; its fail-open path of continuing after some exceptions and unloading invalid hooks is not introduced into this project. |
| [AutoSaddler optimizer invariants](https://github.com/microsoft/AutoSaddler/blob/e841543ce6cf6bdf690e65134b12a829ec9f66d1/src/autosaddler/v2/prompting/methodology/system/optimizer-invariants.md), [method prompt](https://github.com/microsoft/AutoSaddler/blob/e841543ce6cf6bdf690e65134b12a829ec9f66d1/src/autosaddler/v2/prompting/methodology/prompts/evolve-method.md) | The engine handles sampling, scoring, policy, persistence, and recovery; candidates are immutable, and training/development/holdout materials have clear boundaries. Adopt these experimental foundations. Meta-ARE in the repository is a GAIA2 task adaptation and cannot be interpreted by name as optimizer self-evolution. |

The above three HEADs have been checked via the GitHub API; the DSH documentation was also verified via the official Context7 library. This X search over the specified date window returned no matching results, so there is no new popularity evidence. Community discussion is used to discover directions, while source mechanisms and experimental results respectively provide implementation and benefit evidence.
