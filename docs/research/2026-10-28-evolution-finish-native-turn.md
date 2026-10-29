# Ordinary Search Termination: Host Conclusion Aligned with Native Turn End

After the real-feedback research concluded, a wiring omission in the ordinary search tool was discovered: `evolution_finish` had successfully registered the host conclusion, yet DSH still generated one summary request. The earlier termination-protocol test covered `optimizer_study_finish`, so it cannot be used to claim that the ordinary search path also ends the native turn.

## Original Evidence and Root Cause

Run: `.evolution/feedback-study-live-paired-20261028`. `optimizer/0/trace/notifications.jsonl` of the Full second search job `2055d52b48575b21330b2b03f23beea5f1d8a95d7dea4c04ac986908a2ad0586`:

| Event | Observation |
|---|---|
| seq721 | step100 calls `evolution_finish` |
| seq722 | Tool succeeds; the receipt already contains `conclusion.reason/at/champion` |
| seq724 / seq726 | step101 issues a new request and generates a summary |
| seq728 | Turn completes naturally |

The extra request `b553c0cd-5700-4a15-bdd7-ac30b23acca7` took 5528 ms and the report output 617 tokens. This search ultimately ended normally; no conclusion loss or candidate re-run was observed.

`dist/plugin.js` inside the old domain mirror `sha256:ed2c995b6233c41995925b9407d6ab01312f052015cae60a22a4b8871e09715f` is byte-for-byte identical to the local build at verification time; the ordinary tool only calls HTTP `/finish`. The meta-optimizer tool of `dist/study-plugin.js` already calls `exec.concludeTurn()`. The original test is located at `tests/native/study-finish.test.ts` and covers only the latter.

| Original Evidence | SHA-256 |
|---|---|
| Ordinary plugin `dist/plugin.js` | `5758065926888f6a4f2e563bc5113fc1e5f2d8bdef642821a10371a2539fe832` |
| Meta-optimizer `dist/study-plugin.js` | `e473ef62f05bb069ae575c9b2521b53d49855f3d33d36847cfc095b0e131cffe` |
| The above notifications.jsonl | `31e8ec42fbceaf8b33f23772d369b0eb11f08d5bcdbc4e65c49407f39602702e` |
| requests.jsonl in the same directory | `33f331f498e8d3c8cec222c57d4fef35b3009cd60ba8231fb848a89730b1a2c4` |

## Native Semantics and Fix

DSH's [tool protocol](https://github.com/deepseek-ai/deepseek-harness/blob/22ddee3792402c3e70ec5f86a63c3e3e895a2f60/docs/subsystems/tools.md) defines `concludeTurn()` as a termination marker on a successful tool result. The installed `@deepseek-ai/dsh-tools@0.2.1-rc.4` generates the marker at `lib/index.js:3251、3659–3665`; `dsh-agent-loop/lib/index.js:573` collects that marker when submitting the result. A tool failure cannot produce a successful termination result; steering/context already submitted still follows native scheduling.

The ordinary `evolution_finish` now follows the same order as the meta-optimizer:

```text
request /finish → host success confirmation → check call cancellation signal → concludeTurn → return original receipt
                   │                │
                HTTP failure         cancelled
                   └──── native error result, no successful termination marker
```

Host termination conditions, selection rules, scoring, and data permissions are unchanged. The source was modified only after the research at `2026-10-27T21:47:09.175Z` had reached a terminal state; the old research, original mirror, and extra request records are retained, and the post-fix call cost is not traced back to the old results.

## Verification

- `npm run typecheck` passes; Prettier passes for the three modified/added code files.
- `node --import tsx --test tests/native/evolution-finish.test.ts`: 5 passed, 0 failed.
- Direct native Tools calls verified the success marker, no marker on HTTP rejection, and no marker on AbortController cancellation while awaiting confirmation.
- Actual SDK subprocess verification: on success only one request is made; on HTTP rejection it continues to a second request; when the host receipt is not returned, the runtime is closed, the original call rejects, and there is no second request.

The test uses a local deterministic LLM protocol adapter and an HTTP host fixture, with real execution of the native DSH assembly, tool pipeline, and Agent Loop; no paid model was called, and this test is not treated as evidence of quality gains. The [official SDK contract](https://github.com/deepseek-ai/deepseek-harness/blob/22ddee3792402c3e70ec5f86a63c3e3e895a2f60/packages/sdk/client/README.md) explicitly has no prompt-cancel RPC; this test follows the actual interface and cancels the owned runtime via `runtime.close()`.
