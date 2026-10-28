# Command subprocess ownership

The post-study installer exposed a lifecycle defect: its timeout killed the direct `dsh` process while a `pnpm` child retained stdout/stderr pipes. Node's `close` event therefore waited for that child. The existing implementation could exceed its command deadline and leave dependency work running after cancellation.

## Verified mechanisms

- [Node `detached`](https://nodejs.org/docs/latest-v24.x/api/child_process.html#optionsdetached) creates a new process group and session on POSIX. The child stays referenced here; `unref()` is not used.
- [Node `exit` and `close`](https://nodejs.org/docs/latest-v24.x/api/child_process.html#event-close) are different events. Descendants can retain the direct child's stdio after its exit.
- [Node `process.kill`](https://nodejs.org/docs/latest-v24.x/api/process.html#processkillpid-signal) sends a signal to the supplied PID; a negative process-group ID uses POSIX group signalling. This was checked against Node's current documentation/source through Context7 on 2026-10-28.
- Installed DSH subprocess `0.2.1-rc.4` also launches POSIX detached groups and signals negative group IDs. Inspected file: `node_modules/@deepseek-ai/dsh-subprocess-local/lib/runner-launch-B2zsQ1Dz.js`, SHA-256 `6df08adc4a27f278878a5f4cde8b551b51e647b922ac7d6591fd62d272ced153`. Its direct-child fallback is not used by this command primitive.

## Implementation and boundary

`src/command.ts` owns a dedicated Linux/macOS process group. Deadline or cancellation kills that group. Direct-process exit also closes the group's lifecycle so inherited-pipe descendants cannot outlive a successful launcher. Spawn errors, nonzero exit diagnostics and the caller's cancellation reason remain failures. Missing groups (`ESRCH`) are already terminated; other signalling errors are exposed. `src/docker.ts` uses and exports this dependency-free primitive.

This is command lifecycle management, not a sandbox. A program deliberately creating a new session can leave its original group. Untrusted execution still requires the independently managed container/VM boundary. Killing a Docker CLI process also does not terminate a daemon-managed container; the controller's recorded container identity and cancellation path remain responsible for that.

`tests/command-lifecycle.test.ts` exercises real nested processes with inherited stdio: timeout, cancellation, leader-first exit, unrelated group survival, normal output/environment, nonzero exit, missing executable and pre-aborted/invalid requests. Timeout errors retain the captured stdout/stderr; cancellation retains the original reason. Tests treat a reaping-pending zombie as stopped, never as active work.

Verification: 5/5 lifecycle tests passed on macOS/Node `v24.16.0`, and 5/5 passed in the registered Linux image `sha256:ed2c995b6233c41995925b9407d6ab01312f052015cae60a22a4b8871e09715f`, with the newly compiled command module mounted read-only. That Linux check used no network or credentials. Its first execution exposed an absent `ps` test dependency (2 passed, 3 observation failures); the test now reads Linux `/proc/<pid>/stat` directly and uses `ps` on macOS. No production fallback was introduced. Command, cancellation and egress regression tests passed together (27/27). Type checking and bounded independent review passed. Native bundle installation is separately recorded by its installer receipt.

Frozen G/H artifacts and completed model trials are unchanged. A post-study installer using the new primitive records its separate verifier identity; it does not claim that the original runtime image already contained this fix.
