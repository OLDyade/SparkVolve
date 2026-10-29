# Make QA Accept the Full Plugin Composition

After the generic native assembly QA passed, the table example previously created a separate Cordis Context containing only SystemPrompt and Tools, and loaded `/candidate/index.mjs` in isolation. This extra check had no business-behavior assertions, yet it implicitly prescribed the candidate entry point and dependency structure: a legitimate cross-plugin service provider would not load, and a renamed entry point could not pass the check. This compresses the real search space.

The current contract explicitly separates acceptance into two layers:

```text
Frozen candidate artifact
    │
Actual Profile + environment patch + candidate patch
    │
Create native Agent → service dependencies / lifecycle / Preset / tool schema audit
    │
candidate.qa = command → additional domain behavior check; non-zero exit means qa_failed
candidate.qa = null → explicitly no additional domain check
    │
Task execution → independent scoring
```

Full assembly always runs. The table example removes the duplicate single-entry check and explicitly uses `null`; there is no automatic guessing, backward compatibility with the old entry point, or path that skips failures. The additional check may read `/workspace/native/composition.json`, but it must not use this to treat successful native activation as business correctness.

## Verification Basis

- Official [service injection documentation](https://github.com/deepseek-ai/deepseek-harness/blob/22ddee3792402c3e70ec5f86a63c3e3e895a2f60/docs/user/develop/framework/service.md): after declaring `inject`, consumers wait for the service to become available.
- Official [assembly syntax](https://github.com/deepseek-ai/deepseek-harness/blob/22ddee3792402c3e70ec5f86a63c3e3e895a2f60/packages/preset/agent-preset/skills/cordis-composition-reference/SKILL.md): Profiles layer patches, and plugins can be composed through groups, configuration, and service scopes.
- Actually locked `0.2.1-rc.4`, and checked the [auditRows implementation](https://github.com/deepseek-ai/deepseek-harness/blob/22ddee3792402c3e70ec5f86a63c3e3e895a2f60/packages/preset/agent-preset-registry/src/mount.ts): waits for the plugin tree to converge and records load failures and missing dependencies. This mechanism is used to check the actual assembly.

Native regression covers the original table Bundle, renamed entry points with joint cross-plugin service/configuration changes, missing services, and invalid schemas. The initial test fixture used `settings` row IDs, which collided with the SDK Profile's native rows; this failure exposed a real assembly difference, so the fixture was changed to independent `workbook-settings` IDs, and the failure report was retained. DSH was not modified and assembly failures were not hidden.

This item is engineering acceptance; it proves that joint mutations can enter real assembly and subsequent evaluation. Whether real models autonomously choose joint mutations and whether they obtain reproducible benefits is still to be answered by subsequent research experiments.

Final acceptance: 31 unit tests and 8 native tests passed; 6 actual container tests each for runc and `sparkvolve-runsc-20261019` passed. The explicit domain command deliberately exits with failure after native assembly passes; the candidate remains `qa_failed`, no task is created, and rescheduling does not rerun it. The first-round container fixture omitted a required build declaration; after fixing the fixture it was re-verified, and the original failure record was retained. The final review by the read-only subagent passed. Image and source hashes and the evidence directory are in the [machine record](../evidence/2026-10-27-composable-qa-acceptance.json).
