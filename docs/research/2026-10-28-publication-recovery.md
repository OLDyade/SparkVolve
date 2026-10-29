# Process Crash Consistency of Frozen Publication

The original implementation used a fixed `destination.freeze-lock` directory for exclusivity and relied on `finally` for cleanup. If the process is SIGKILLed during the copy phase, cleanup is not executed; recovery then encounters EEXIST, causing already successful builds or tasks to be incorrectly recorded as failures. There is also an interruption window between candidate freezing and SQLite registration, and the original proposal had no persistent record.

## Current Protocol

```text
Submit original proposal / content digest
        │
        ▼
SQLite reserves one candidate budget ──────────────────────────────┐
        │                                             │ restart
        ▼                                             ▼
Persistent publication intent → OS write lock → copy and verify → atomic rename
        │                  │                           │
        │                  └─ process death releases lock via OS      │
        │                                              ▼
        └─ resume same intent, published content must match ──→ publication registration
                                                       │
                                                       ▼
                            same transaction: record candidate + delete pending
                                                       │
                                                       ▼
                                     original build / original task / original scoring
```

- `freeze(source, destination, publicationRoot)` requires the caller to explicitly pass a trusted control directory. This repository uniformly uses the `publications/` of the owning experiment; control files do not enter the candidate, build, or delivery directories, and are not mounted into the optimizer or executor.
- The destination parent directory is resolved to its real path; each destination has its own SQLite file, allowing different artifacts to proceed in parallel. The same target must always use the same control directory; an active database must not be deleted, and coordination must not be bypassed via another directory.
- The intent fixes the content digest and staging path; after acquiring `BEGIN IMMEDIATE`, the state is re-read. An active concurrent publication explicitly returns SQLite busy; takeover is not guessed based on PID, time, or directory age.
- pending + complete destination exists: verify the digest, then resume commit; pending + destination does not exist: only rebuild the staging copy for that intent. published + artifact missing or mismatched: fail explicitly, without regenerating to mask corruption.
- On startup, the controller resumes persistent candidate commits, preserving the original proposal, provenance, and budget. Replaying a request with the same identity returns the original candidate; the same content with a different submission identity is rejected, without increasing the task attempt.
- The `harness-evolution:publication` native diagnostics channel provides the reserved/copying/ready/published/committed phases, destination, and digest. Subscribers execute synchronously per Node native rules; events do not contain file contents and do not replace persistent state.

## Research Basis

| Primary source | Constraint on the design |
|---|---|
| [Node 24 fs](https://nodejs.org/docs/latest-v24.x/api/fs.html#fspromisesrenameoldpath-newpath) | The rename API does not provide the cross-platform no-replace publication transaction required by this project; check-then-rename alone cannot coordinate concurrent callers |
| [SQLite transactions](https://www.sqlite.org/lang_transaction.html) | BEGIN IMMEDIATE acquires the write transaction immediately; concurrent writes explicitly produce SQLITE_BUSY, and transactions do not auto-commit across asynchronous procedures |
| [SQLite locking](https://www.sqlite.org/lockingv3.html) | Locks and processes, rollback journal division of labor; after a process interruption, reopening the database recovers the transaction, without the application guessing at stale directory locks |
| [Node 24 SQLite](https://nodejs.org/docs/latest-v24.x/api/sqlite.html) | Uses the project's existing built-in DatabaseSync, with explicit zero-wait, transaction state, and close; no new native lock dependency |
| [Node diagnostics channel](https://nodejs.org/docs/latest-v24.x/api/diagnostics_channel.html) | Synchronously observes publication boundaries, used for actual process fault injection and runtime diagnostics; no test-only degraded path is set in production logic |

## Acceptance and Boundaries

[Machine evidence and source identity](../evidence/2026-10-28-publication-recovery.json): the final working tree passed 67 unit tests, 10 native tests, 16 container tests, and 1 actual installation package acceptance. All three recovery paths—source, build, and delivery—retain the original process termination records and final receipts. Independent read-only review passed.

After real SIGKILL at five phases, re-invocation completed the same intent in every case; an active publication cannot be preempted by a second process, while another target can publish. Native container acceptance terminated the controller during copying of candidate source, successful build output, and successful task delivery respectively, waited for the original controller lease to expire naturally, then recovered: the original build/task container ID was preserved, attempt=0, scoring completed, and each question still had the original two fixture model requests. The fixture drives the real DSH Agent Loop, tools, and Docker, and does not claim to be a real model quality experiment.

The single-task failureLimit of the first newly added test reused the two-task default and was rejected by contract parsing; subsequently the test fixture lacked the required build script, and a macOS path alias caused the phase subscription to miss. All were fixed in the tests and the original failure directories were retained; no production contract was modified to allow passage, and no real model task was retried.

This demonstrates **process crash recovery**; it does not verify power loss, corrupted disks, remote filesystem locks, or cross-host coordination. The SQLite control state, source directory, and publication directory all belong to the trusted host; the candidate container has no permission to modify them. Disk hard quotas and MicroVM continue to be advanced as separate delivery gaps.
