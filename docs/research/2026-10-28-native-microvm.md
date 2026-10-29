# Native macOS MicroVM isolation: source findings and installation evidence

Research date: 2026-10-28 (Asia/Shanghai). This record serves the isolation backend for the executor, builder, and optimizer; it does not modify the core idea, experiment selection, or the production Docker interface.

## Conclusion and actual status

Apple `container` provides a native direction usable on this machine: each container gets an independent Linux VM using Virtualization.framework, and supports OCI images and fixed-capacity ext4 persistent volumes. The earlier `Operation not permitted` of `losetup` inside OrbStack only negates the loop-mount path in that shared-kernel environment; it cannot be used to conclude that this machine has no MicroVM route.

**Runtime acceptance has not been completed, and the production execution backend has not been integrated.** The official signed installer package has been downloaded and verified successfully; installation was blocked by the administrator authentication requirement, and no service, VM, container, network, or volume was started.

| Machine item                                | Observation                                                                                             |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Operating system                            | macOS 26.6.2, build 25G83                                                                               |
| CPU / architecture                          | Apple M4 Pro / arm64                                                                                    |
| `kern.hv_support`                           | `1`                                                                                                     |
| CLI                                         | `container` not found in PATH or common install paths; `krunvm`, `vfkit`, `limactl` not found in PATH                  |
| Official installer package                  | `container-1.6.1-installer-signed.pkg`, 155,965,213 bytes                                               |
| SHA-256                                     | `cd47846819f06478d067060efe21e516b562ac0a9af8eecad6d5fea0b556b200`, matches the GitHub release asset digest |
| `pkgutil --check-signature`                 | exit 0；Apple Inc. - Containerization (`UPBK2H6LZM`)，Apple notary service trusted                      |
| `spctl --assess --type install --verbose=2` | exit 0；`accepted`、`source=Notarized Developer ID`                                                     |
| Official installation                       | `sudo -n /usr/sbin/installer -pkg … -target /` returned exit 1: `sudo: a password is required`              |
| Kernel isolation / ENOSPC / reconnect after interruption / hard log bound     | **unknown: native VM acceptance has not been executed**                                                                       |

Raw evidence is kept in the ignored directory `.evolution/apple-native-20261028-preflight/receipt.json`, UTC time `2026-10-27T20:47:54.616Z` to `20:48:01.238Z`. The installer package is kept in the same directory; binaries are not committed. The failure receipt is preserved in full; the original download redirect contains GitHub's temporary public asset signed URL and is not used as release material. The probe script subsequently records only the redirect origin/path and does not save query parameters.

The new script [`scripts/probe-apple-isolation.mjs`](../../scripts/probe-apple-isolation.mjs) is an installation and capability pre-check, and **does not include a VM acceptance implementation**. It requires a new evidence directory each time and saves each command, output, and exit status; all unexecuted capabilities remain `unknown`, and `acceptedAsExecutionBackend` is always false. `--install` uses only the fixed official signed release package; it will not unpack into a private directory to bypass system authentication, nor will it start a background service.

```sh
# A new directory must be used; overwriting old failure evidence is refused.
node scripts/probe-apple-isolation.mjs --install .evolution/apple-native-new-attempt
```

Continuing the installation currently requires the user to enter the administrator password in the official installer. The already downloaded and verified package can be used directly; no password needs to be provided to the Agent. Completing installation only removes the prerequisite blocker and cannot be used to declare isolation acceptance complete.

The script syntax and repository Prettier check pass; reusing the original evidence directory was measured to return `EEXIST`, which the original record did not cover. An independent subagent direction review confirmed that the pre-check and runtime acceptance were not conflated, and pointed out the version verification gap for an installed CLI; version, release build, and commit are now checked according to the stable [ReleaseVersion format](https://github.com/apple/container/blob/aa8d76b44a834eee3ebf6a0bc577e376f65f6361/Sources/ContainerVersion/ReleaseVersion.swift#L18-L24), and other versions are refused entry into this capability table. This CLI branch has not yet been executed on this machine.

## Fixed reference versions

First retrieve `/apple/container`, `/libkrun/libkrun`, and `/libkrun/krunvm` via Context7 resolve, then verify against the official stable tag source, to avoid treating main documentation as released behavior.

| Item                   | Version and source verified this time                                                                                                                                                                                                         |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Apple container        | [1.6.1 release](https://github.com/apple/container/releases/tag/1.6.1), released 2026-10-23; tag corresponds to commit `aa8d76b44a834eee3ebf6a0bc577e376f65f6361`                                                                      |
| Apple Containerization | The above release's [Package.resolved](https://github.com/apple/container/blob/aa8d76b44a834eee3ebf6a0bc577e376f65f6361/Package.resolved) pins 0.53.0, commit `f79e412d7c31b00c65c8a6f80dd0b0bb55f6a4f7`; no independent latest release obtained |
| libkrun                | [v1.19.7](https://github.com/libkrun/libkrun/releases/tag/v1.19.7), released 2026-10-22                                                                                                                                      |
| KrunVM                 | [v0.2.7](https://github.com/libkrun/krunvm/releases/tag/v0.2.7), released 2026-08-25                                                                                                                                         |

## Apple native capabilities and boundaries

| Capability          | Verified facts for the stable version                                                                                | Implication for this project                                                                  |
| ------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Independent kernel      | Lightweight VM per container, based on Virtualization.framework; officially supports Apple Silicon / macOS 26               | This machine meets the public platform requirements; distinct boot IDs, resources, and device configuration still need to be measured                      |
| Images          | Consumes and produces OCI images                                                                           | Image format and digest can be reused; CLI, inspect, network, exit, and recovery protocols must be adapted independently         |
| Persistent volumes        | Named volume uses ext4, with `size` specified at creation; default 512 GiB sparse image                          | Small capacity must be explicit; working data does not need unbounded host bind. The capacity parameter does not mean ENOSPC has passed        |
| Network none     | `NetworkClient.noNetworkName = "none"`; the CLI converts a standalone `--network none` to `config.networks=[]` | The no-network grader has native wiring; zero NICs, IPv4/IPv6/DNS/host reachability still need to be measured               |
| internal network | `--internal` maps to host-only                                                                   | Retains a host network path and cannot serve as proof of completion for broker-only egress                        |
| Resources          | CPU, memory, readonly root, cap-drop, tmpfs, and ulimit all have interfaces                                  | The current contract's pids, no-new-privileges, and swap must be checked item by item; unsupported items should be exposed, not ignored   |
| Logs          | The VM runtime writes stdout/stderr to the host bundle's `stdio.log`                                    | Working volume size does not limit host logs; an independent hard bound is required, and polling deletion of logs cannot be passed off as one                |
| Recovery          | The native service retains container/process identity and an exit-wait interface; named volumes can persist across runs                  | Reconnecting to the original task, recovering saved data, and restarting the process must be distinguished; memory checkpoint was not verified this time |

Key sources:

- [Platform and official installation](https://github.com/apple/container/blob/aa8d76b44a834eee3ebf6a0bc577e376f65f6361/README.md), [VM architecture](https://github.com/apple/container/blob/aa8d76b44a834eee3ebf6a0bc577e376f65f6361/docs/technical-overview.md). The signed package requires administrator-authenticated installation `/usr/local`, which is unrelated to bypassing OrbStack permission restrictions.
- [Persistent volumes](https://github.com/apple/container/blob/aa8d76b44a834eee3ebf6a0bc577e376f65f6361/docs/volumes.md), [EXT4 formatting implementation](https://github.com/apple/container/blob/aa8d76b44a834eee3ebf6a0bc577e376f65f6361/Sources/Services/ContainerAPIService/Server/Volumes/VolumesService.swift). The source calls `EXT4.Formatter(... minDiskSize: sizeInBytes ...)`; the actual block count, writable capacity, and inode exhaustion behavior still need to be verified. Anonymous volumes are not automatically deleted due to `--rm` and must be reclaimed according to this creation manifest.
- [none constant](https://github.com/apple/container/blob/aa8d76b44a834eee3ebf6a0bc577e376f65f6361/Sources/Services/ContainerAPIService/Client/NetworkClient.swift#L39-L43), [CLI no-network branch](https://github.com/apple/container/blob/aa8d76b44a834eee3ebf6a0bc577e376f65f6361/Sources/Services/ContainerAPIService/Client/Utility.swift#L185-L205). This behavior is not prominent in the command reference and has been corroborated with stable source; it must no longer be recorded as "the CLI has no none".
- [Command and network contract](https://github.com/apple/container/blob/aa8d76b44a834eee3ebf6a0bc577e376f65f6361/docs/command-reference.md), [run configuration](https://github.com/apple/container/blob/aa8d76b44a834eee3ebf6a0bc577e376f65f6361/docs/runtime-configuration.md). `--no-dns` does not prevent direct IP connections.
- [Host stdio writes](https://github.com/apple/container/blob/aa8d76b44a834eee3ebf6a0bc577e376f65f6361/Sources/Services/RuntimeLinux/Server/RuntimeService.swift#L225-L240), [stdio path](https://github.com/apple/container/blob/aa8d76b44a834eee3ebf6a0bc577e376f65f6361/Sources/Services/Runtime/RuntimeClient/Bundle%2BLog.swift), [development FileLogHandler without rotation](https://github.com/apple/container/blob/aa8d76b44a834eee3ebf6a0bc577e376f65f6361/Sources/ContainerLog/FileLogHandler.swift#L19-L20). Neither type of log is in the working ext4 volume; no CLI hard log limit interface has been found so far, so it cannot be claimed that all write paths are bounded.
- [runtime wait](https://github.com/apple/container/blob/aa8d76b44a834eee3ebf6a0bc577e376f65f6361/Sources/Services/RuntimeLinux/Server/RuntimeService.swift#L623-L644), [start behavior](https://github.com/apple/container/blob/aa8d76b44a834eee3ebf6a0bc577e376f65f6361/Sources/ContainerCommands/Container/ContainerStart.swift). When recovering the controller, the original task cannot be started without regard to state; the CLI also has explicit restrictions on re-attaching to an already running container.

## Integration with the current execution protocol

Retain `execution.ts`'s creation intent, actual resource identity, final-state evidence, recovery, and reclamation order, and add an independent backend implementation. Docker commands cannot simply be replaced with `container`:

```text
Freeze execution contract, OCI digest, kernel/init identity
                  │
    ┌─────────────┴─────────────┐
    │ Docker / gVisor backend      │ Apple native VM backend
    │ Docker inspect / wait     │ native API configuration / process wait
    │ Linux network boundary            │ no-network VM / independent broker channel
    │ native host storage constraints          │ explicit ext4 volume + host log constraints
    └─────────────┬─────────────┘
                  │
Same-semantics identity verification, resource evidence, final-state archiving, failure retention, and targeted reclamation
```

File staging, optimizer writable area, build context and cache, image unpacking, execution volumes, host stdio, and archive staging each have explicit owners and limits; limiting only `/workspace` cannot close the disk boundary. If the image cache is in a shared trusted service, it must also have separate limits and ownership records. Guest-side ext4 full-disk and host service log limits should be implemented by the real filesystem or kernel constraints. Log byte polling, download size checks, and application capture lengths only limit the output of their respective tools and do not constitute proof of a disk quota against a malicious guest.

The host stdio hard limit of the current Apple CLI is not closed. A restricted log sink using the Containerization API directly, or an independent service data directory constrained by kernel capacity, could be investigated; neither has been implemented, and neither path relocation nor virtual disk file size is directly marked as safe.

## Minimal native acceptance contract (to be executed after installation)

1. Start two test VMs with a fixed OCI digest and kernel/init identity; save the configuration and distinct Linux boot IDs, and verify independent process spaces. Use only self-owned model-free fixtures.
2. For the no-network configuration, first verify a priori that there are zero attachments, then verify that the guest has only loopback, no non-local routes, and that the external network, host, peers, and DNS are all unreachable. It is forbidden to switch to internal/NAT to keep the test going.
3. Create an explicit small-capacity ext4 volume; in a non-root worker process, write until real ENOSPC, recording total blocks, inodes, actual bytes written, and host usage. After termination, remount the same volume and read back the fsynced random marker, verifying the hash; reclamation operates only on this volume.
4. Perform independent boundary checks on rootfs, tmpfs, host logs, and build and archive directories. An adversarial test that continuously writes logs must first have a host hard limit, to avoid flooding the host with unbounded logs.
5. Kill the controller while keeping the VM running, then reconnect to the same VM, the same process, and the same volume; a write counter proves the workload was not restarted. After normal termination, independently recover the exit code; a VM crash must retain the failure and must not automatically rerun.
6. Verify the actual enforcement of CPU/memory/pids/permissions and no-new-privileges; missing fields remain fail/unknown. After completion, archive the configuration, final state, logs, and data hash, then reclaim this run's resources.

The above contract has no passing results yet. Pre-check script exit 1 indicates a saved installation or environment blocker; exit 2 indicates the pre-checks completed but runtime acceptance is still missing. There is no path where "pre-check passes, therefore the backend is accepted".

## libkrun / KrunVM comparison

[libkrun v1.19.7](https://github.com/libkrun/libkrun/blob/v1.19.7/README.md) supports Hypervisor.framework on macOS ARM64, a different host path from Linux KVM. It has basic capabilities such as virtio-block/fs/net, but the official security model requires host mechanisms to isolate the VMM; virtiofs itself does not protect other host directories, and the default TSI network uses the VMM's network context.

[KrunVM v0.2.7](https://github.com/libkrun/krunvm/blob/v0.2.7/README.md) uses Buildah to unpack OCI and libkrun to start the VM; the default host directory and virtiofs root filesystem cannot directly provide a fixed persistent disk boundary. It suits a custom VMM route but requires more host sandboxing, network, and storage work; it was not installed or started this time.

This machine prioritizes acceptance of the Apple native path; an external native Linux host remains another deployment option. This choice comes from verified platform capabilities and interfaces and does not mean the Apple route has passed the full execution contract.
