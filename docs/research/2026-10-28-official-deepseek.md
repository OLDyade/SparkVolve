# Official DeepSeek: Transport Localization, Native Protocol, and Semantic Corrections

With user authorization, an official DeepSeek provider was added. There is no fallback service, response patching, or automatic retry. The original Venus failure artifacts are retained; subsequent experiments use a new directory and a new contract.

## Transport-Layer Facts

The old Venus optimizer request completed TCP in about 70ms, completed authorized TLS and request writing in 212ms, and only returned HTTP 200 at 301132ms, then ended while missing `finish_reason`. Another task `ECONNRESET` during the TLS phase, and the local broker returned 502. The 600-second task deadline had not yet triggered; the existing logs cannot localize the specific remote failing component, and it cannot be claimed that all link issues have been fixed.

On 2026-10-28, a no-retry live test was performed against the official address:

| Path | Actual observation |
| --- | --- |
| `/models` | HTTP 200, returned `deepseek-flash`, display name DeepSeek-V4.1-Flash |
| Native Messages, first attempt | HTTP 200, about 693ms, actually returned an addition tool call, received `message_stop` |
| Native Messages, tool result continuation | HTTP 200, about 677ms, returned 95 and ended normally |
| Chat Completions | HTTP 200, about 1456ms, both `finish_reason=stop` and `[DONE]` present |

These tests prove that the official endpoint was available at that time; they cannot be used to infer the root cause of the old gateway failure, nor do they constitute a guarantee of long-term service reliability.

## Native Integration and Contract

- Locked to `@deepseek-ai/dsh-llm-deepseek-api-key@0.2.1-rc.4`, using the native `deepseek-official` service and Messages stream handling, retaining the DSH Agent Loop, tool execution, and context projection.
- The SDK Profile's connection plugin ID is `llm-deepseek`. The environment patch explicitly declares the model catalog, off reasoning, a 32768 output budget, a 600000ms stream idle limit, and zero automatic retries. Execution and optimization use the same official model contract.
- The official `/models` catalog for that day declares context 1048576, maximum output 393216, text/image input, system updates as in-history, and tool updates as addition-only. The server provides model aliases; freezing the client catalog does not equal freezing the remote weights.
- `forwardHeaders`, as part of the controlled egress contract, forwards only declared non-authentication protocol headers; overriding credentials, Host, transport, and length fields is prohibited, as are duplicate names. The real key is injected by a trusted broker, and the worker process holds only a placeholder value.
- The official documentation explicitly states that `anthropic-version` is currently ignored, and `anthropic-beta` is ignored except in the Files API image scenario. Retaining these headers is part of native request contract completeness and has not been identified as the cause of the old failure fix.
- The scenario preparer receives an explicit provider catalog. The researcher-provided `egress.mjs` is trusted configuration code, assembled after freezing; there is no guessing of providers by name, automatic switching, or backward-compatibility branch.

The actual DSH adapter → real broker → Messages HTTP fixture has covered two requests, native tool execution, result continuation, authentication injection, and protocol headers. This deterministic test is accounted for separately from real official calls.

## Semantic Errors and Attribution Boundaries

The two autonomous candidates in the first round of official experiments introduced a self-written formula interpreter. Independent synthetic workbooks compared against actual LibreOffice confirmed four categories of differences: ROUND, unselected IF branches, cross-sheet ranges, and exponentiation; two simple arithmetic controls passed. The baseline does not have this interpreter, so these counterexamples do not apply. The missing `resolve` for the baseline in the original failure report was merely a probe interface not being applicable, and is not counted as a baseline algorithm error.

Candidate 1's two tool parameter generations ended with `MALFORMED_RESPONSE`, and usage was unavailable; no JSON repair was used. The nested schema and the failure occurred simultaneously, and without a controlled comparison, it cannot be declared that nesting is a confirmed cause. Candidate 2 completed four questions, but the erroneous interpreter remained. The new draft subsequently left by the optimizer also retained this interpreter and was not released as a qualified capability.

The new round uses a frozen [development evidence brief](../experiments/2026-10-28-native-semantics-brief.md). It provides only synthetic counterexamples, tool declaration boundaries, and verified ecosystem materials, and does not contain validation answers. The optimizer autonomously selects tools, interfaces, and implementations; computation is required to follow the native engine, and heuristic formula rewriting and proving business correctness with self-filled expectations are not accepted. The task and scoring contracts remain independently unchanged.

## HOME Lifecycle of the Installation Helper Process

After the first installation, all four installation containers for business acceptance failed at the creation stage: the original helper process bound `/workspace` as read-only, so runc could not create the `.harness-home` mount point for the independent HOME tmpfs, and the number of model task executions was zero. This failure is fully retained.

Installation and integrity verification now each use an independent temporary working directory, and the delivery directory is not mounted into the helper process; the Profile, original archive, and file digest checks are retained. Other build, QA, scoring, and export installation paths have been checked item by item for their workspace mounts. The fix is verified through new installation acceptance, without relaxing the read/write boundaries of the original archive and actual delivery.

## Official Materials

- [DeepSeek model catalog](https://api-docs.deepseek.com/api/list-models/), [native Messages compatibility](https://api-docs.deepseek.com/guides/anthropic_api/), [Thinking and tool calls](https://api-docs.deepseek.com/guides/thinking_mode/)
- [DSH upstream source snapshot](https://github.com/deepseek-ai/deepseek-harness/tree/00d541438b9beabb4d876a14371aea69f58c397a/packages/llm): 0.2.2-alpha.2 already existed at research time; this experiment continues to lock the actually verified 0.2.1-rc.4, with no in-flight upgrade
- [LibreOffice parameters and independent user directory](https://help.libreoffice.org/latest/en-US/text/shared/guide/start_parameters.html), [openpyxl does not compute formulas](https://openpyxl.readthedocs.io/en/stable/simple_formulae.html), [Excel ROUND](https://support.microsoft.com/en-us/excel/functions/round-function)

Related searches on GitHub and X did not yield public incident evidence sufficient to localize this gateway failure; discussion volume is not counted as proof of a fix or performance.
