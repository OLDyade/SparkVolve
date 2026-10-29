# From a clean checkout to an inspectable capability delivery

This page connects the public commands, actual state, and delivery boundaries. The model chooses plugin changes itself; the acceptance driver only invokes the public CLI according to pre-registered rules, does not generate candidate code, and does not fix answers on the model's behalf.

```text
Clone → npm ci → npm run check → build base / Excel images
                                      │
                         explicit runtime, address pool, DNS
                                      │
                                      ▼
         image real-path precheck → public input → frozen contract and selection rules
                                      │
                                      ▼
               init → evolve → native optimizer autonomous mutation
                              │               │
                              │               └─ events --follow: read-only observation
                              ▼
                  build / native QA / tasks / independent scoring
                              │
                 ┌────────────┴────────────┐
                 ▼                         ▼
          no qualifying terminal mutation                highest full-mean mutation
          end retaining negative result                ties select earliest registered
                                           │
                                           ▼
                           fixed new tasks → full re-validation of baseline / candidates
                                           │
                                           ▼
                                original package research archive + all results
                                           │
                                  source and capability semantic review
                                           │
                                independent install → new user tasks
```

## Run the full public flow

First follow the [startup guide](quick-start.md) to install dependencies, pass checks, and build images. `npm run check` generates the build artifacts needed for type checking itself; a first checkout does not require an existing `dist/`. Model credentials go in a private environment file outside the repository.

Running the following acceptance actually consumes model quota. The default example includes three tasks, at most four candidates, and a 1,800-second optimizer budget; if there is a re-verifiable mutation, it then runs four tasks × two groups. It is an engineering experience; a single repetition and public tasks cannot prove stable score improvement.

```bash
HE_IMAGE=$(docker image inspect harness-evolution-spreadsheet:local --format '{{.Id}}')
HE_CONTROLLER_IP=$(node scripts/controller-address.mjs "$HE_IMAGE")
node --env-file=/absolute/private/venus.env scripts/accept-walkthrough.mjs \
  --root "$PWD/.evolution/user-journey" \
  --image "$HE_IMAGE" --runtime runc \
  --pool "${HE_EGRESS_POOL:?Set a reserved private IPv4 CIDR}" \
  --dns "${HE_TEST_DNS:?Set approved IPv4 DNS servers}" \
  --endpoint "http://${HE_CONTROLLER_IP}:18958"
```

`--root` must be a directory that does not yet exist. On failure it stops immediately and preserves the original command logs, exit status, and experiment; this driver does not retry, and does not support running again in the original directory. To resume an experiment, after inspecting the original failure use the [CLI's resume semantics](events.md); do not create a new attempt to mask the failure.

| Artifact | Purpose |
|---|---|
| `commands/*.json`, stdout, stderr | Each public command, time, exit status, and output hash |
| `registration.json` | Pins source version, image, contract digest, selection rules, and data usage before execution |
| `search/`, `search-report.json` | Original experiment, all candidates, per-task scores, and model usage |
| `selection.json` | Selects the terminal mutation by full mean, retains regressions, does not cherry-pick by deleting tasks |
| `validation-study/registration.json`, `comparison.json` | Two groups with the same contract, same frozen build artifacts, and complete paired results |
| `research-export/` | Capability package and research archive; archiving does not equal approval to distribute |
| `outcome.json` or `failure.json` | Completion branch or first failure, without fabricating a successful terminal state |

The driver starts from an already-built image. A complete cold-start acceptance must also preserve the earlier `npm ci`, `npm run check`, and the logs of both image builds; you cannot claim dependency installation is verified based on `outcome.json` alone.

## Observe real progress and resume reading

Open another terminal to observe committed events, no model credentials needed:

```bash
node dist/cli.js events --root .evolution/user-journey/search --follow | tee events.jsonl
```

Each JSON line contains `event` and the corresponding `cursor`. Uncommitted or rolled-back events are not shown; the independent CLI connection re-reads after a bounded wait, and new commits appear with at most about 30 seconds of delay; it does not claim cross-process instant push. Wait expiry does not generate a "healthy" event. Ctrl-C only stops the observer; the original optimizer and tasks keep running. A one-shot snapshot omits `--follow`.

```bash
# Save the last received cursor from a non-empty log, then continue; cursors cannot be used across experiments.
jq -s 'last.cursor' events.jsonl > cursor.json
node dist/cli.js events --root .evolution/user-journey/search \
  --cursor cursor.json --follow
```

The observer uses a Node [SQLite readOnly connection](https://nodejs.org/docs/latest-v24.x/api/sqlite.html); it does not create a missing database, does not modify experiment metadata, and does not acquire an execution lease. `status` and `report` also use the same read-only approach. Persistent events are not proof that a process is alive; when there are no new events, you should also check the actual process/container and task artifacts.

## Install and use

First inspect the candidate implementation, independent native operation semantics, and re-validation results. If there are unaccepted automatic fixes, wrong algorithms, or failure boundaries, keep the research archive and do not force installation. For a reviewed and trusted Bundle, install it per the [independent capability entry](use-capability.md) and complete new tasks, verifying native terminal state, tool calls, delivered formulas/cache, and non-target preservation.

This independent capability entry passes model credentials directly to a trusted container; unreviewed candidates in experiments continue to use the controlled egress. Installation, engineering acceptance, quality conclusions, and public release are recorded separately.
