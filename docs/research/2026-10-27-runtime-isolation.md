# Runtime Isolation: Official Capabilities, Actual Hosts, and Implementation Choices

Verified 2026-10-27. The goal is to make the execution boundary of plugin code mutation declarable, checkable, and recoverable, while preserving native DSH.

## Verified Materials

- Docker [Alternative runtimes](https://docs.docker.com/engine/daemon/alternative-runtimes/): the daemon registers OCI runtime/shim, and containers explicitly select one via `--runtime`. Context7 `/docker/docs` queries cross-verified against Docker 29.8.2 `info`/`inspect`.
- gVisor [security model](https://gvisor.dev/docs/architecture_guide/security/), [platform selection](https://gvisor.dev/docs/user_guide/platforms/), [Docker integration](https://gvisor.dev/docs/user_guide/quick_start/docker/): Sentry reduces the interfaces directly exposed to the host kernel; systrap can be used inside a VM without nested KVM. Source located at [4777ee7811e235e66d5825f6c6ae5ccd3ccccfb3](https://github.com/google/gvisor/tree/4777ee7811e235e66d5825f6c6ae5ccd3ccccfb3). Actual compatibility still requires running installation, compilation, and DSH dynamic library workloads.
- Firecracker [production host requirements](https://github.com/firecracker-microvm/firecracker/blob/b54ebb201303087c699cc4c1711bec962919f893/docs/prod-host-setup.md): depends on KVM/CPU virtualization; production recommendations include seccomp and host maintenance; an independent guest kernel does not automatically solve networking, disk, scheduling, and data permissions.
- X search returned transcription leads related to GoogleCloudTech and LegitSeanSmith, but no independently verifiable original posts were obtained, so they are not used for technical or popularity conclusions. Overhead percentages or user-attribution rumors from search results were not adopted.

## Decisions and Measurements

The macOS/OrbStack Linux aarch64 daemon registers only runc and io.containerd.runc.v2. Global runtime configuration was not modified. Previously hardcoded resources and implicit root identity are now required contract fields, with real settings verified via inspect; receipts record actual registration information and do not infer isolation implementation from names.

Image, command, mounts, and permissions enter the intent digest; verification occurs after creation, before recovery, and after completion. The original container is retained for forensics, and verification failure does not trigger resampling.

- 25 unit tests and 8 native tests passed.
- Image `sha256:2eff5055a8006398c279766e8145a4638608a331f025e3e62f00cd5336a586b9` passed four real container acceptance checks: compilation/dependency packaging/offline installation, native DSH→delivery→independent scoring→recovery, actual isolation probing, and native optimizer→control API.
- Guest verified non-root, CapEff=0, NoNewPrivs=1, loopback-only network, source/root directory write failure, and writable authorized and temporary directories; host verified resources.
- After modifying the PID limit of the original container via `docker update`, collect was rejected; an unregistered runtime failed before create; recovery reused the original container; receipts contain no injected probe credentials.
- The above verifies engineering execution and recovery; it does not measure real model accuracy gains, nor does it prove escape resistance or multi-tenant security.
- A real Venus DeepSeek session completed status→wait→finish under the same non-root configuration, returning a host-event random nonce; elapsed time about 7.86 seconds. Zero tasks, zero candidates; this item only verifies real networking, credentials, and native session lifecycle.
- Independent read-only direction review passed; it noted that the Quick start fifth parameter and UID/GID documentation needed synchronization, which has been completed.

## gVisor Implementation and Run Matrix

- Reviewed the [official installation instructions](https://gvisor.dev/docs/user_guide/install/) and the [20261019.0 release package](https://github.com/google/gvisor/releases/tag/release-20261019.0): the current distribution includes runsc, shim, and `gvisor-bin` sidecars, which must be kept together. The repository script pins the release package and SHA256; it explicitly registers an independent name `sparkvolve-runsc-20261019` without changing the default runtime.
- [OrbStack isolated machines](https://docs.orbstack.dev/machines/isolated) support disabling Mac file sharing and host networking; their [architecture](https://docs.orbstack.dev/architecture) still has machines share the Linux kernel. This time a dedicated Debian 13 ARM64 machine and Docker 29.9.2 daemon were created, with host sharing and networking disabled. The trusted test controller holds that daemon socket; candidate containers do not.
- Host proxy, direct TLS, and SSH reverse forwarding all encountered actual network failures, with logs retained. Finally, the official signed APT index and SHA256-verified packages were imported offline, with guest APT signature verification, without opening host access or disabling TLS verification. The two installation entry points—runsc inside the package and the complete tar release package—were accepted separately.
- Under runsc/systrap all four container acceptance checks passed; then the pinned release package was installed with the repository script, and the same four acceptance checks were run with `sparkvolve-runsc-20261019`, all passing. 13 end-of-run isolation receipts record the actual runtime, user, and network. No registered name or hello-world was substituted for the full DSH workload.
- A real DeepSeek session completed status→wait→finish under runsc, with all 4 native model stream calls returning, reporting 3990 input / 686 output tokens, and a single experiment of 9.303 seconds. Zero tasks, zero candidates; no quality gains are inferred.
- Two installation/test preparation errors are retained: the first trusted controller used the wrong socket group, causing a permission failure; the first extraction of the release package lacked bzip2. Each was fixed based on the actual group and by installing the dependency, and a dependency precheck was added to the installation script. Both occurred during engineering acceptance and are not mixed into quality experiments.
- The GitHub workflow adds independent runc/gVisor matrices and failure log/isolation receipt archiving, with the artifact action pinned to [v7.0.2 commit](https://github.com/actions/upload-artifact/tree/cf430e030ddbb5b0abf93d22962f4752f3646cd9). The check `122277182856` of the current remote run `40529245525` explicitly did not start due to payment/consumption quota, so the remote matrix cannot be claimed as passing.

Independent read-only subagent direction review passed, with no blockers found for this delivery; it explicitly noted that the online download entry point and Linux x86_64 cloud CI have not yet actually run. Machine-checkable summary: [gVisor acceptance record](../evidence/2026-10-27-gvisor-acceptance.json). Linux x86_64 remote execution, controlled egress, disk quotas, and the MicroVM backend remain incomplete and stay within the full delivery scope.
