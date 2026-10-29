# Public CI and Transport-Stage Diagnosis

On 2026-10-28 the user explicitly authorized making `OLDyade/SparkVolve` public and re-running CI. The actual API returned `isPrivate=false`; for run `40624792713` of main branch `a42416c`, all four jobs started on the second attempt, and the billing rejection from the first attempt remains recorded.

The actionlint step on macOS runner `macos-26-arm64` reported `go: command not found`. The workflow previously assumed Go was preinstalled; it now explicitly uses the official `actions/setup-go` v7.0.0 (pinned commit `b7ad1dad31e06c5925ef5d2fc7ad053ef454303e`) to install Go 1.27.3. The version comes from the official `actions/go-versions` release; actionlint v1.7.12's go.mod requires at least Go 1.25. The two host platforms each complete independently, so one failure does not cancel the other.

## Correction of Transport Evidence

The old `stage=connect` spanned from creating the HTTP request until receiving response headers, so the old record can only prove **ECONNRESET before response headers** and cannot distinguish the TCP, TLS, or service-processing stage. The earlier wording "connection establishment failure" was overly specific; the original ledger was not amended with observations that did not exist.

The current native broker records monotonic clock offsets for: request read, DNS policy resolution, socket allocation, TCP connect, TLS secureConnect, request finish, response headers, response body completion, and total elapsed time. TLS authorization state is recorded separately; no HTTP status is fabricated when there are no response headers. A missing field means it was not observed and must not be treated as zero elapsed time.

Per the [Node HTTP documentation](https://nodejs.org/docs/latest-v24.x/api/http.html#event-finish), request finish only means the request was handed to the operating system and does not prove server-side receipt. Per the [Node TLS documentation](https://nodejs.org/docs/latest-v24.x/api/tls.html#event-secureconnect), handshake events and certificate authorization are distinct facts. Current HTTPS verification behavior is preserved; credentials and request bodies are not written to the transport ledger.

11 actual HTTP/TLS regressions pass: DNS rejection, handshake rejection, handshake success, delayed response headers, reset after connection established, timeout, cancellation, and no retry. This only enhances observation; it does not change routing, credentials, models, timeouts, address selection, or error adjudication.

## Docker Network Initialization After gVisor Installation

The gVisor job in public CI `40626981748` failed directly when starting the build container: `could not parse extra host IP invalid IP: ParseAddr("invalid IP")`. The runc job in the same matrix does not run the runtime installation script. The script originally registered runsc and then only called `systemctl reload docker`.

The [official Docker documentation](https://docs.docker.com/reference/cli/dockerd/#configure-host-gateway-ip) states that `host-gateway` defaults to the address of the default bridge; the [GitHub gh-aw runtime integration record](https://github.com/github/gh-aw/issues/44795) documents the same error after reload and the requirement for a full restart. The installation script was changed to fully restart Docker on the dedicated host, without writing a fixed gateway IP, changing the runtime, or reducing isolation. The script header explicitly states the Docker restart side effect.

The test's own resource lifecycle was also fixed: cleanup is registered immediately after the local HTTP fixture is created, ensuring the service is closed even when the host-gateway probe fails before the subsequent test body is entered. CI uses TAP to output failure stacks immediately and preserves container stdout/stderr; failures will not remain hidden long-term due to leftover test services.

## Native Tool Sandbox and Temporary HOME

After fixing the gateway, the gVisor matrix in public CI `40627364489` completed 23 tests, with 21 passing; the native bash/LibreOffice HOME test and the bash-dependent feedback protocol test failed. On the dedicated gVisor 20261019.0/systrap host, actual testing showed: the DSH Landlock probe returned `unusable`, and the image did not contain `bwrap`. After installing Debian Bubblewrap, the DSH native read-only probe command succeeded; `--cap-drop=ALL`, non-root, read-only root, and `no-new-privileges` were preserved, and container permissions were not relaxed.

The [official DSH documentation](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/sandbox/sandbox-local/README.md) and the pinned `@deepseek-ai/dsh-sandbox-local@0.2.1-rc.4` implementation both state that Linux native selects Bubblewrap/Landlock; when no implementation is available it fails explicitly. The image now installs [Bubblewrap](https://github.com/containers/bubblewrap), continues to use the native selection mechanism, and does not add a custom executor or bypass inner isolation.

In this version, `bwrapProfileArgs` creates a separate `/tmp` for workspace-write, then binds the workspace. Actual testing shows this masks the previous `/tmp/evolution-home`. Therefore HOME/XDG was uniformly moved to a separate 128MiB, 0700 tmpfs at `/workspace/.harness-home`: the native workspace bind preserves this mount and quota, it persists across tool calls, and it is released when the container is destroyed. Actual probing confirmed its capacity is 134217728 bytes, it is writable, and external paths are still denied writes. The host retains only an empty mount point; HOME contents do not enter the delivery snapshot. The regression uses two consecutive real native bash runs to check configuration availability, quota, content across calls, and the empty mount point after container deletion; the full matrix is subject to the actual results of the new commit.
