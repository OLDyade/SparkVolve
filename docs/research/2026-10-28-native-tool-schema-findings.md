# Native Tool Contract: Why a Real Mutation Did Not Enter Task Execution

Review date: 2026-10-28. Scope is the native assembly failure of the first paired block of the [registered feedback study](../experiments/2026-10-28-feedback-study-registration.md). The study continues to use the original frozen version; this page does not modify candidates, scoring, or subsequent arms, nor does it draw quality conclusions in advance.

## Official Contract and Actual Version

Documentation was discovered via Context7, then the fixed commit [`22ddee3792402c3e70ec5f86a63c3e3e895a2f60`](https://github.com/deepseek-ai/deepseek-harness/tree/22ddee3792402c3e70ec5f86a63c3e3e895a2f60) of the official DeepSeek Harness `master` was read. The [Tools subsystem](https://github.com/deepseek-ai/deepseek-harness/blob/22ddee3792402c3e70ec5f86a63c3e3e895a2f60/docs/subsystems/tools.md) and the [tool authoring guide](https://github.com/deepseek-ai/deepseek-harness/blob/22ddee3792402c3e70ec5f86a63c3e3e895a2f60/docs/cookbook/adding-a-tool.md) clearly distinguish the `ParameterSchemaSpec`／`ValueSchemaSpec` used by authors from the compiled model JSON Schema.

| Contract authors must follow                                              | Actual behavior of the currently installed version                                                                           |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Parameter root is a property map; required properties are written in `required: true`, optional properties omit that key | `runSchemaCompiler` of `@deepseek-ai/dsh-tools@0.2.1-rc.4` rejects `required: false`              |
| Explicit object nodes declare the boolean `additionalProperties`               | The compiler rejects missing fields and schema object values; the schema-valued form of general JSON Schema cannot be carried directly into the author DSL |
| Nested objects, arrays, and scalars each follow their corresponding node rules                    | The fix must land on the node corresponding to the error path; adding fields to other layers cannot fix the original node                                   |
| `execute` returns the canonical JSON value declared by `output.schema`               | `output.render` handles display; successful assembly still requires an actual call to verify business behavior                                 |

Local verification locations are `node_modules/@deepseek-ai/dsh-tools/lib/index.js:603` and `:699`; file SHA-256: `1e53932e7c4213ea24a7d87f06960b7a7702cb21f8a5741c97242b4a470a442a`. The above contract is evidenced by both official documentation and the dependencies of this round's run, and does not rely on impressions of standard JSON Schema.

## What Actually Happened

Full-0 autonomously added `workbook_verify`, with the goal of letting the executor observe the native recomputed value before independent scoring. In candidate `ba1a581e…`, `parameters.cells.additionalProperties` was written as `{ type: 'array', items: ... }`, and native assembly rejected it outright. The subsequent candidate `6c291d78…` modified fields near the array elements but still retained the same illegal `additionalProperties` object; both assemblies therefore produced the same error:

```text
parameters.cells.additionalProperties must be explicitly true or false
```

Actual report of the second failure:

```text
.evolution/feedback-study-live-paired-20261028/study/children/
3635b67d52b6c76bcf3efb5b88f34908e09652bc880f2c517fa936707a7339d8/
qa/6c291d7866c7517162b456c5987f7d3b207c24aefd409b99fbda71784ae5218f/
work/native/composition.json
SHA-256: 6d8d19d60a6c00c1ed6d4f4ed37ef0c48860942ef84cfb158bc29ef67aae5181
```

Neither candidate entered task execution. The "expected to pass QA" and business benefits written in the candidate proposals are optimizer assumptions; they cannot be used to claim that the tool has been used or that formula quality has improved. Mechanical-0 also experienced a failure where an optional parameter was written as `required: false`, and the subsequent candidate passed assembly; both kinds of errors should be classified as native interface usage problems.

## Implications for Implementation and Methodology

Native QA accurately exposed the unloadable tool here, and there is no evidence to support relaxing the DSH contract, automatically rewriting the Schema, or remediating on behalf of the candidate. The testable follow-up question is: does the optimizer read and correctly apply the exact version of the author contract, and can it complete the correction of the corresponding node based on the explicit error? Code being installable, the tool actually being called, and task quality improving require separate evidence.

This finding supports improving plugin author documentation and research attribution; it cannot yet prove that the added explanation will increase the mutation success rate, nor can it attribute the quality difference of the entire round to this class of interface error. The candidate budget, feedback permissions, and raw failure records of the current study remain unchanged.
