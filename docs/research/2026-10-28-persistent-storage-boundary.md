# Persistent Disk Boundary: Route and Host Measurements

Status: research and host capability probing. Not yet integrated into the production controller; the disk quota gap remains open.

## Current Real Boundary

The writable bind mount of `src/docker.ts`, the stdout/stderr copied out after completion, and the frozen artifact archive currently have no hard capacity limit. The existing read-only rootfs, bounded tmpfs, and memory/PID limits cannot substitute for a persistent disk boundary.

he-runsc-lab uses OrbStack-managed btrfs; Docker 29.9.2 uses the containerd overlayfs snapshotter with default json-file logging. btrfs has squota enabled; this session did not modify OrbStack's global quota or machine security settings. Without `/dev/kvm`, Firecracker independent guest kernel acceptance cannot be completed on this basis.

## Recommended Design

```text
Deployment-side restricted storage pool (real total capacity, reserved control state space)
 ├─ Execution volume: an independent fixed-capacity filesystem per run; code only receives the mount directory
 ├─ Log volume: trusted receiver, explicit overflow failure, hard capacity limit still enforced underneath
 └─ Archive pool: frozen artifacts and evidence have a total budget; pressure is not shifted to an unbounded host directory

Volume identity → filesystem UUID / backing identity / mount identity
       → original volume recovery → original container completion → archive → unmount and release
```

A fixed-capacity ext4 block device is an implementable route: the deployer pre-allocates the image, a trusted host manager mounts it, and the candidate has no loop/block device privileges; when full, the kernel returns ENOSPC, and the original volume is retained for recovery. Production may also explicitly adopt XFS project quota, but project inheritance and bypass paths must be verified. Both backends require explicit declaration and independent acceptance, with no automatic fallback to a plain directory.

The [losetup official manual](https://man7.org/linux/man-pages/man8/losetup.8.html) notes that find/associate is not an atomic operation; a production manager needs mutual exclusion and identity verification. `--nooverlap` avoids duplicate mapping of the same backing file but cannot by itself replace a concurrency lease.

[Docker local logging rules](https://docs.docker.com/engine/logging/drivers/local/) delete old records once max-file is exceeded; this is a retention policy for the diagnostic window and cannot serve as proof of complete forensics. Complete logging requires bounded reliable reception, explicit termination on overflow, and an independent control state space. Merely polling directory size or cleaning up after the fact does not provide hard isolation.

## Results of This Capability Probe

Installed e2fsprogs 1.47.2-3+b12 from the Debian signed repository. The first apt index update failed because the existing offline mirror lacked translation indexes; after explicitly disabling translation indexes, installation from the existing online signed sources succeeded normally, with no changes to software sources or dependency versions.

An independent 64 MiB file was successfully pre-allocated and formatted as ext4; the actual `sudo losetup --find --show --nooverlap` returned **Operation not permitted**, and mount or container-fill testing has not yet been reached. `losetup -f` can see a free `/dev/loop0`, which does not prove that the machine permits associating devices. A second run reproduced the test in a new file solely to capture the command stderr that the first probe did not record; both failure artifacts are retained. The loop list was empty afterward, with no mount or device association residue. See the [original report](../evidence/2026-10-28-persistent-volume-host-probe.json).

Follow-up work needs to verify supported Linux host capabilities, or complete a full isolation proof for another explicit backend. Successful formatting, the existence of device nodes, or the existence of configuration options must not be written up as passing disk acceptance.

Supplementary verification: both the [OrbStack official resource interface](https://docs.orbstack.dev/machines/#resource-limits) and the local `orb create --help` provide `--disk`, allowing investigation of a development backend with a separate restricted machine per task. The current shared machine total limit cannot be treated as a per-task budget; this approach still shares the Linux kernel, and the [official security model](https://docs.orbstack.dev/machines/isolated) does not regard it as an independent VM against active kernel escapes. No supported machine loop switch was found; privileged/nsenter access into the shared host will not be used to bypass EPERM. A dedicated Linux host with `/dev/kvm` and a restricted storage pool remains the recommended environment for full production acceptance.

## Completion Criteria

Byte and inode exhaustion, write/fsync/close, oversized stdout/stderr, inter-task isolation, original volume recovery after process restart, archive pool exhaustion, path replacement, and quota/subvolume ioctl bypass all require actual acceptance. MicroVM and disk limits are validated independently; gVisor Sentry and the OrbStack shared kernel are not accepted as substitute evidence for an independent VM.

Other official research entry points: [XFS quota](https://man7.org/linux/man-pages/man8/xfs_quota.8.html), [Docker containerd storage](https://docs.docker.com/engine/storage/containerd/), [btrfs subvolumes](https://btrfs.readthedocs.io/en/stable/btrfs-subvolume.html), [qgroup](https://btrfs.readthedocs.io/en/latest/Qgroups.html), [Firecracker host requirements](https://github.com/firecracker-microvm/firecracker/blob/main/docs/getting-started.md). gVisor's [FUSE/NFS delayed quota error report #16043](https://github.com/google/gvisor/issues/16043) still needs to be tested against the actual version; a single issue cannot be used to assert that all environments are affected.
