# Full Native Plugin Assembly QA

While reviewing `11.md`, we found that the original example QA only loaded the plugin entry in an independent Cordis Context. It could check the tool schema, but did not verify the services, nested composition, disabling, and replacement relationships declared by the candidate patch.

This time we added an independent native assembly stage:

```text
Frozen candidate + fixed Profile + fixed environment Bundle
                  │
          DSH SDK native startup
                  │
       Create actual Agent (no model request sent)
                  │
   Loader native audit + Preset diagnostics + tool schema
                  │
          Domain-synthesized business QA
                  │
           Formal execution and independent scoring
```

Uses the native `DeepSeekHarness.start()`, `HarnessSession.getWorkingDirectory()`, `auditRows()`, and `agentPresets` APIs of the installed version `0.2.1-rc.4`. Creating an Agent triggers native scope and lifecycle initialization, and the QA observer collects the actual assembly state at `agent/created`. No `run()` was called and no model prompt was sent.

All enabled rows must be able to activate; intentionally disabled plugins are expressed by the Loader's disabled state. Missing services, import failures, configuration failures, and broken Presets cause QA to fail, preserving native logs and any obtainable `composition.json`. This gate verifies whether the program is runnable; it does not judge business answers or force the model to perform additional checks. The synthesized business QA and the official quality scoring are kept separately.

The QA container reuses the fixed execution image, loads the environment and candidate patch in the original order, and has networking disabled. Credentials are provided to native Provider initialization only through the environment variables declared by the fixed model, and are not written into configuration or reports. The report retains modules, lifecycle states, and tool schemas, and does not serialize Provider configuration. Formal execution keeps the existing native flow.

Verification this time: 17 unit tests, 6 native tests, 1 real container integration test, and 1 native package installation test passed; type and format checks passed. The new native tests cover the standard SDK and minimal SDK, nested plugin service binding, missing services, and import failures. The container test actually goes through the new QA before executing tasks, interruption recovery, independent scoring, and packaging; the installation test installs from the distribution package via native DSH and then calls tools. Protocol fixtures are used for engineering acceptance and are not counted as real model quality results.

The container image ID this time is `sha256:1c16914bb5b293bab1891f8763841625acfc017c82052dbccb24577df74e095f`, and the raw container evidence is kept locally at `he-container-oxNNJc`. The independent direction review passed; the build lifecycle and dedicated Preset are still incomplete.

Sources:

- [DSH SDK startup and Session operations](https://github.com/deepseek-ai/deepseek-harness/blob/22ddee3792402c3e70ec5f86a63c3e3e895a2f60/packages/sdk/client/src/api.ts)
- [Preset native assembly and auditRows](https://github.com/deepseek-ai/deepseek-harness/blob/22ddee3792402c3e70ec5f86a63c3e3e895a2f60/packages/preset/agent-preset-registry/src/mount.ts)
- [Preset registration and lifecycle](https://github.com/deepseek-ai/deepseek-harness/blob/22ddee3792402c3e70ec5f86a63c3e3e895a2f60/packages/preset/agent-preset-registry/src/index.ts)

Full assembly QA is not equivalent to a candidate build system, nor does it prove improved model quality. The remaining panorama gaps are recorded separately in [Implementation Status](../completion.md).
