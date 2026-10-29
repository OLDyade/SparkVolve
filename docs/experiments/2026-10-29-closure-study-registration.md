# Native Closure and Mutation-Scope Replication

Registered before the new study's first inference. The earlier [mutation-space study](2026-10-29-mutation-space-results.md) remains intact; this run uses the corrected native literal-text prompt slot and adds installation reuse to every search selection. It is not a retry of failed tasks or a selection of the best historical score.

The same frozen G and H0 are used in prompt-only, single-plugin and open-plugin arms, with two independent searches per arm, at most two mutations per search, four public development tasks, four independent validation tasks, and four new reuse instances. Each task has 600 seconds; at most two searches run concurrently. Quality alone selects H* within each search, including H0 on ties. No candidate is chosen using validation or reuse scores.

The search/validation allocation remains at most 104 executions. Installation reuse adds at most 24, for a **128-execution ceiling**, plus optimizer, build and assembly calls. Every complete search selection is exported and installed unchanged through native DSH `plugin add` into a clean Profile per reuse task. Identical H0 selections are retained as separate registered observations. Missing selections and failed installations remain explicit; no replacement or task retry is permitted.

The original generator, evaluator, source, build, image and model identities are frozen in `research-registration.json`. Reuse changes numeric inputs within the same public task families and is not hidden data or cross-domain transfer. The model is the official `deepseek-flash`; G/H share its non-thinking configuration and the native DSH 0.2.1-rc.4 / Cordis 4.0.5 runtime. A server-side model alias is not immutable weights.

Report all six searches, actual source changes, independent quality, installation identity, reuse scores, failures, requests, reported tokens and elapsed time. Installation success establishes distributability; semantic acceptance requires inspecting the actual code and behavior. No semantic inference, silent fallback or source-specific answer patch becomes acceptable because its test score is high. Group differences from H0 selections cannot be attributed to plugin mutation. Two searches per arm do not support a significance or general superiority claim.

The structured-data `npm start` acceptance is separate: three public task types across search, validation and reuse, with at most one autonomous mutation. It must complete before this study starts, avoiding simultaneous model workloads from the two acceptance paths. The core claim remains **Evolve the Harness, Not the Model.**

API verification: [DeepSeek model documentation](https://api-docs.deepseek.com/quick_start/pricing) and [official Anthropic interface](https://api-docs.deepseek.com/guides/anthropic_api), checked through Context7 on 2026-10-29. This run changes neither provider nor runtime to recover failures.

## Separate Autonomous-Archive Delivery Check

Registered at 2026-10-29 06:29 UTC, after the first open search completed and before any installation reuse: the original H1 of that search, source `33fd6cce66a3e06fe9f2140f0209cabe91eb96f9c77b3e5f30d867c65539133b`, will also be exported unchanged and installed for four reuse tasks. H0 and H1 tied at 100% in this search and H0 remains selected. This selection of H1 is for engineering path coverage of an autonomously modified package; it is not a method winner or a new quality-selection rule.

The additional four executions use the already-frozen reuse contract, begin after the main study's reuse phase, and have their own registration and evidence root. There is no rebuild, source repair, retry or incorporation into the three-arm means. The original study ceiling remains 128; this separate delivery check adds at most four. All reuse scores and semantic defects are reported, including regressions. Installing an experimental rejected artifact in isolation does not release or recommend it.
