# Persistent Event-Driven Continuation: Verification and Acceptance

## Verified Sources

- [Node 24 events](https://nodejs.org/docs/latest-v24.x/api/events.html): listeners execute synchronously; awaiting `events.once` sequentially may miss consecutive events. Therefore, database sequence-number catch-up reads, post-commit notification, and post-subscription re-check are adopted.
- [Node 24 HTTP](https://nodejs.org/docs/latest-v24.x/api/http.html): `ServerResponse.close` covers normal completion and premature connection termination; `server.close` does not immediately terminate all active requests. Therefore, request disconnection releases the wait, and service shutdown explicitly propagates AbortSignal.
- The actual DSH `0.2.1-rc.4` of this project has its tool registration, execution, and session loop unreplaced. `evolution_wait` registers through the existing Cordis `tools` service, and the returned content enters the next model request along with the native tool result.

## Changes and Evidence

SQLite events contain an incrementing sequence number corresponding to the experiment ID; HTTP long polling returns at most 100 per page and lasts at most 30 seconds. The optimizer host waits through the control API, and the container access address is declared independently. The controller idles waiting for persistent events and no longer performs 250/500/1000 millisecond status polling. QA failure status and notification are changed to commit in the same transaction.

- 22 unit tests and 8 native tests pass; including 205-event pagination, rollback, invalid cursor, cross-connection commit, restart, HTTP replay, and cancellation.
- The controller receives new candidates while waiting, automatically builds, executes, scores, and adjudicates; pumping again after canceling the wait did not increase the execution count.
- 3 real container tests pass. Runtime image: `sha256:247237d62c837ad39a80959ce8ca2986e278222d6ee7adab39adc92ce4bd5011`.
- The deterministic Provider only drives the protocol; the real native optimizer container executes status → wait → finish, the host commits `acceptance.wakeup`, and continuation completes before the fourth model request. The native invocation totals four model requests and one wait request.
- [Real model acceptance](../evidence/2026-10-27-event-acceptance.json): Venus DeepSeek V4.1 Flash 1017, thinking off; 1 session, 1 wait, and 4 model requests all succeeded, container 7.024 seconds. The end reason accurately contains the host random nonce; input 10,265 / output 561 tokens, 0 candidates, 0 evaluation questions. This is lifecycle evidence and cannot be treated as a quality gain.

Event recovery replay and task recovery are separate: the former performs catch-up notification reads, the latter collects results along the original container identity; neither permits re-drawing tasks on that basis. Cross-process notification delay is at most one long-polling cycle. Research gains and other remaining gaps across the project continue to be tracked in the completion ledger.
