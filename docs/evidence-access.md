# Hand authorized evidence directly to native tools

In a real user journey, the optimizer transcribed the workbook returned by the tool as base64 into a file: 6,643 bytes became 6,288 bytes, and it then spent multiple steps troubleshooting a ZIP error. The original delivery was intact; the corruption occurred during transcription. The framework now publishes the original bytes to a read-only mount, and the model can inspect them directly with DSH files, Shell, and domain tools.

```text
Authorization reference: kind + id + area + file
                 │
       In-experiment identity and area permission check
                 │
   Trusted root directory handle → open layer by layer → original bytes
                 │
   Private staging: file + source + SHA256
                 │ Publish the complete directory at once
                 ▼
   /evidence/<identity>/files/<basename>  read-only
                 │
       DSH native files / Shell / domain tools
                 │
       Copy to /workspace yourself when changes are needed
```

## Native invocation

First obtain the actual ID and file name from the state and the corresponding evidence store, then invoke:

```json
{
  "kind": "run",
  "id": "<actual-run-digest>",
  "area": "delivery",
  "file": "result.xlsx"
}
```

`evolution_materialize` returns the readable path, byte count, SHA256, original reference, and provenance file path. It does not return the full file contents, does not interpret or repair the file, and does not treat the business expectations self-reported by the tool as proof of correctness.

| kind | Optional area |
|---|---|
| `task` | `input`: obtain public input by registered task id, no run id required |
| `run` | `input`、`delivery`、`trace` |
| `candidate` | `source`、`build`、`artifact`、`qa` |
| `probe` | `source`、`suite`、`build`、`artifact`、`logs`、`observations` |
| `asset` | `source`: contract-authorized research asset source files |

The file must be explicitly specified; directory listings are still read through the existing evidence tools. References are resolved only within the current experiment; host absolute paths, arbitrary download URLs, or caller-specified write targets are not accepted; the private scoring area has no read entry point. The same source and content return the same snapshot; content changes produce a new identity and do not overwrite existing evidence.

The above areas are also restricted by the frozen [host feedback protocol](feedback-views.md). `mechanical` rejects all `run` references; public input uniformly goes through `task`; closed probe/library cannot be read. Evidence listing, file reading, and materialization use the same authorization function and cannot be bypassed by switching to base64, original-byte mounts, or another tool. The original host ledger still retains the complete run results.

## Read and publish boundaries

Independent review empirically found that the original `realpath → prefix check → readFile` had a race: a candidate could replace the file or parent directory after the check. Now, through Python's standard file descriptor interface, `os.open(..., dir_fd=...)` layer by layer within the trusted authorization root, rejecting symbolic links at each layer; directory listings and hashes are also read along the same descriptor tree. The terminal accepts only regular files; special files such as FIFOs are not read as evidence. Candidate frozen copies and research asset reads reuse this implementation.

The implementation is based on the Python official [`os.open(dir_fd=...)`](https://docs.python.org/3/library/os.html#os.open), [`os.listdir(fd)`](https://docs.python.org/3/library/os.html#os.listdir), and capability checks of the actually installed version. `Controller.start()` calls `fileReaderCapabilities()` before starting a task; the host Python 3 must provide the corresponding POSIX capabilities, with no path-read fallback. Python is started with `-I -S`, using a fixed program within the product, and does not load the candidate directory, `PYTHONPATH`, or user initialization code. The trusted root directory and its host-managed paths belong to the control plane's permission boundary and cannot be replaced by candidates; writable descendant directories inside the container are not treated as trusted paths.

The temporary directory before publication is not mounted to the optimizer. After the file and source are fully written and the content identity is computed, the complete directory is moved into the read-only `/evidence`; concurrent publishers reuse it only when the existing file and source are exactly equal. A process crash before publication does not expose a partial file; private remnants are retained for investigation, and other executions' directories are not cleaned up. This verifies process interruption semantics and does not claim power-loss durability.

The snapshot of an active trajectory records the bytes actually read this time and does not certify that the writer has completed a business transaction. Evidence content may still be untrustworthy; the original invocation logs and independent scoring continue to be stored separately.

## How to run

`evolve` automatically establishes a read-only mount from the experiment `materialized/` to the optimizer `/evidence`. When installing the Preset independently, the deployer must establish the same directory mapping; merely connecting to the control HTTP service does not automatically transfer the mount. See [Preset run contract](presets.md).

Real model interface acceptance entry point:

```bash
node --env-file=/absolute/private/venus.env scripts/verify-materialized-evidence.mjs \
  --root /absolute/new-evidence-directory \
  --image sha256:<immutable-image-id> \
  --isolation /absolute/isolation.json \
  --model examples/venus/model.json \
  --controller-ip <container-reachable-IPv4>
```

The driver has the real model materialize random binary, copy and compute a digest through the native Shell, and observe the operating system read-only error; the host independently verifies the original bytes, native invocation, mount, and egress receipt. It does not execute scoring tasks, submit candidates, retry, or prove search gains.

## Actual acceptance · 2026-10-28

| Acceptance layer | Result |
|---|---|
| Determinism and native regression | 75 unit, 11 native, and 16 container tests passed |
| Independent race recheck | 8 sets of terminal file/parent directory swaps against the real production interface; no bytes outside the authorized scope were read or published |
| Real model | Native invocation `evolution_materialize` → Shell read and copied the random file; 8,192 bytes exactly equal to the host's independent SHA-256 |
| Read-only and cleanup | Actual write returned `EROFS`, Docker mount `RW=false`; worker, egress proxy, and both networks were fully cleaned up |
| Distribution package | The same tarball installed via native DSH; Preset loading, tool registration, and actual invocation passed |

The first real model acceptance retained a failure: the Shell actually reported a read-only file system, but the model wrote the exit status `1` into a field requiring a symbolic errno. After revising the driver to explicitly require reading errno from the actual exception, it was re-verified in a new directory; the product code and image were unchanged, and the original failure report was not overwritten. The first and revised sessions each had 3 DSH stream calls, reporting input/output of 8,852/823 and 2,053/677 tokens respectively; call statistics are not equivalent to the vendor's internal HTTP retry count.

Native trajectories, failure and pass receipts, independent recheck results, code, and artifact digests are in [machine-readable evidence](evidence/2026-10-28-materialized-evidence.json). This result proves file delivery and interface boundaries, not model reasoning, candidate business correctness, or evolution gains.
