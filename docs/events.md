# Events, Waiting, and Recovery

```text
Candidate / task state change
        │ same SQLite transaction
        ▼
persisted raw event ── COMMIT ──→ wake waiters
        │                    │
        └─ host feedback view projection ←─┘
                 │ continuous view cursor
       native evolution_wait returns
                 │
       DSH next model request → attribution and mutation

connection interrupted → retain cursor → reconnect and catch up
controller interrupted → restart original experiment → collect original container → continue accounting
```

`evolution_status` returns both the state and `cursor: { experimentId, viewDigest, sequence }`. Pass all three fields intact to `evolution_wait`, which calls `POST /events` with the capability, waiting at most 30 seconds. After receiving an event, save the returned cursor; on `hasMore=true`, continue reading the remaining pages. When there are no visible events, return an empty page and the original cursor.

An event page holds at most 100 entries, and the cursor stops at the last entry actually returned. A wrong experiment ID, wrong view identity, or ahead-of-position cursor raises an error directly. Canceling the wait, a dropped connection, and a wait timeout all do not cancel the task, duplicate an attempt, or trigger a retry. After a failed request, retain the last successfully received cursor and replay it when the connection is restored; when the client receives duplicates, deduplicate by `(experimentId, viewDigest, sequence)`. The protocol does not promise exactly-once network delivery.

Host raw events continue to be stored in full. The model cursor is bound to the frozen [feedback protocol](feedback-views.md); the mechanical view filters out scores and task results and then renumbers continuously, and hidden events do not advance the model cursor. The read-only `events` CLI uses the host raw cursor; do not pass it into model tools.

States and events become visible only after the transaction commits; a rollback does not notify. After subscribing, re-read events to cover changes that occurred "after checking state and before starting to wait." In-memory notifications are used to reduce latency, but SQLite is authoritative; after each bounded wait ends, read the log again to cover cases such as commits by other connections. Only one lease-holding controller writes to an experiment.

`serve` and `evolve` wait for events when idle; when running, they wait for the real result of the original container. After the optimizer session ends, the trusted host continuer waits for pending candidates directly through the local read-only Store and periodically verifies the committed state of other connections. It does not rely on the trimmed model API to judge scores or budget. Infrastructure errors are still propagated upward, and the original run data is retained.

Independent deployment requires distinguishing the host address from the container address:

```sh
sparkvolve serve --root ./experiment --host 0.0.0.0 --port 8787
sparkvolve optimize --root ./experiment \
  --endpoint "http://${SPARKVOLVE_CONTROLLER_IP}:8787"
```

`endpoint` writes into the Preset of the optimizer container, and the address must match the actual deployment network. The host continuer reads the ledger of the same `root` directly; `optimize` no longer accepts `--control-endpoint`. `evolve` manages the control service automatically, and the user still provides a container-reachable entry point.

Real-model lifecycle acceptance runs explicitly and is not part of the default offline tests:

```sh
SPARKVOLVE_TEST_IMAGE=sha256:<run image digest> node --env-file=/secure-directory/venus.env \
  --import tsx --test tests/live/events.test.ts
```

This acceptance requires the model to actually wait, receive the host random nonce, and write the end reason; it does not submit mutations, does not execute evaluation problems, and does not claim quality improvement.
