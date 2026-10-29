# Freeze runtime permissions, verify the real container

The isolation contract becomes part of the experiment identity. Build, QA, optimizer, executor, and grader all explicitly select the runtime, non-root UID/GID, and resource budgets; each role uses the network permissions within the contract. A missing runtime, drift in the original container configuration, or an identity mismatch fails immediately.

The mainline uses the accepted runc/gVisor path. MicroVM is an optional backend extension; users are not required to install it first to run the evolution loop. The independent kernel and persistent disk hard limits have not yet been accepted and cannot be treated as currently supported capabilities. Enabling any backend requires explicit registration; on failure there is no automatic switching.

```text
Researcher declares isolation ──freeze──► experiment contract
                                  │
       ┌──────────┬──────────┬────┴─────┬──────────┐
       ▼          ▼          ▼          ▼          ▼
     Build        QA      Optimizer   Executor    Grader
       └──────────┴──────────┴──────────┴──────────┘
                                  │
             daemon registers runtime → create → inspect verification
                                  │
                       isolation.json (before startup)
                                  │
                  original container execution / reconnect and re-verify after interruption
                                  │
                    isolation-final.json (after completion)
```

## Declaration and operation

```bash
# Use the current non-root user identity, explicitly select a registered runtime; do not change daemon configuration.
node examples/isolation.mjs runc "${HE_EGRESS_POOL:?Set a reserved private IPv4 CIDR}" \
  "${HE_TEST_DNS:?Set approved comma-separated IPv4 DNS servers}" > isolation.json
# Install a pinned version on a dedicated Linux Docker host, then select it explicitly.
bash scripts/install-runsc.sh
node examples/isolation.mjs he-runsc-20261019 "${HE_EGRESS_POOL:?Set a reserved private IPv4 CIDR}" \
  "${HE_TEST_DNS:?Set approved comma-separated IPv4 DNS servers}" > isolation.json
```

The install script pins gVisor `20261019.0` and the SHA256 for each architecture, installs the complete runsc/sidecar distribution package into a separate directory, registers `he-runsc-20261019`, and uses systrap; it does not replace existing runtimes or defaults. The host requires Docker, systemd, sudo, tar, bzip2, and sha256sum; online installation also requires curl. Only Linux x86_64/aarch64 is supported. An existing install directory or a registration with the same name is rejected outright rather than overwritten.

An isolated host can first supply the official distribution package, then run `bash scripts/install-runsc.sh /absolute/path/gvisor-aarch64.tar.bz2`. Offline mode still verifies the same pinned digest and does not download over the network or switch runtimes. Installation involves host configuration and should be performed on a dedicated Docker host managed by the researcher.

The same acceptance suite covers both runtimes; `HE_TEST_RUNTIME` and the deployer-confirmed `HE_TEST_DNS` must be declared, and a missing value fails immediately:

```bash
HE_TEST_RUNTIME=he-runsc-20261019 \
  HE_TEST_DNS="${HE_TEST_DNS:?Set approved IPv4 DNS servers}" \
  HE_TEST_IMAGE=$(docker image inspect harness-evolution:local --format '{{.Id}}') \
  npm run test:container
```

GitHub Actions runs runc and pinned gVisor separately, retaining test logs and per-role isolation receipts for 14 days. After the repository became public, the standard runner has actually executed, and the original quota block was lifted; complete results for specific versions are in the [public CI record](experiments/2026-10-28-public-ci-and-delivery.md).

The generator provides an editable workstation configuration. The framework does not fill in missing fields, does not automatically select a default runtime, and does not fall back after a run failure. The fifth argument of `prepare.mjs` must be this JSON; modifying the contract after freezing requires a new experiment. The UID/GID must be able to access the mounted directories; the framework does not modify host directory permissions. For remote Docker, the mount paths must actually exist on the daemon host; local paths are not uploaded automatically.

| Field | Meaning |
|---|---|
| `runtime` | Exact name registered with Docker; the name does not prove the implementation or isolation strength |
| `user.uid/gid` | Explicit non-root user, shared by all five roles |
| `memoryMiB` / `cpus` / `pids` | Per-container memory, CPU, and process limits; the total swap limit equals the memory limit |
| `tmpMiB` / `homeMiB` | Container temporary filesystem size and user ownership; `/tmp` allows DSH dynamic library execution; HOME is mounted separately at `/workspace/.harness-home`, preserving quota and cross-invocation state through the native workspace bind |
| `network` | build is none or bridge; optimizer is controlled, executor is controlled or none; QA/grader are fixed to none |
| `network.egressPool` | Private IPv4 CIDR reserved by the deployer; each controlled execution occupies two `/29`, including the optimizer; the contract checks the capacity required for concurrency |
| `network.egressDns` | Required 1–3 IPv4 resolvers; rejects duplicates, 0.0.0.0, loopback, multicast, broadcast, and addresses overlapping egressPool; no default value |

Capabilities are always cleared, privilege escalation is prohibited, the root filesystem is read-only, and IPC is private; the image entrypoint is replaced by an explicit command. The user, resources, network, mount read/write, runtime, and command are verified, and implicit image volumes are rejected. Recovery reuses the original container; permission changes do not trigger a task rerun.

The image installs Bubblewrap, and DSH's native sandbox-local selects an available backend; the Agent Loop is not replaced and the tool sandbox is not disabled. Bubblewrap in this DSH version creates a separate `/tmp` for workspace-write commands, so HOME is not placed under `/tmp`. HOME in the workspace is a separate 0700 tmpfs; after the container is destroyed, the host retains only an empty mount point, and caches, configuration, or history are not carried into capability delivery. `tmpMiB` describes the mount quota of the outer container `/tmp`; the `/tmp` newly created by the inner Bubblewrap is constrained by the container's total memory and cannot be claimed to inherit that separate quota.

## Egress DNS

The trusted broker needs to resolve in-contract upstreams; candidates continue to use static hosts and loopback DNS. The built-in DNS `127.0.0.11` of a Docker custom bridge cannot be accessed by the runsc isolated netstack, and setting `--dns` separately still goes through this address. The applicable solution given in the [official gVisor documentation](https://gvisor.dev/docs/user_guide/faq/#docker-bridge) is to mount a read-only `/etc/resolv.conf` pointing to a reachable resolver into the container. This framework freezes the broker's resolver in the contract and does not switch to host network or reduce runtime isolation.

The list has at most 3 entries, consistent with glibc's `MAXNS` in the image; excess entries are rejected outright, not truncated or silently ignored by the system. [Linux resolver documentation](https://man7.org/linux/man-pages/man5/resolv.conf.5.html)

If the deployer has not yet provided a resolver, the candidate list can be read from the default bridge of the built image and the registered runtime; the helper script does not call models, does not pass credentials, and cleans up this container on exit:

```bash
npm run build
mkdir -p .evolution/deployment
node scripts/egress-dns.mjs \
  "$(docker image inspect harness-evolution:local --format '{{.Id}}')" \
  "${HE_TEST_RUNTIME:?Select a registered Docker runtime}" > .evolution/deployment/dns-discovery.json
# After checking the discovery record and the deployment network, explicitly adopt the confirmed list; addresses provided directly by the deployer may also be used.
export HE_TEST_DNS=$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).servers.join(","))' \
  .evolution/deployment/dns-discovery.json)
```

The script only reports the raw `resolv.conf` and IPv4 list for that image/runtime and does not prove that the target network is reachable. Final acceptance must complete actual resolution and requests under the declared runtime, controlled dual networks, and read-only resolver file, and verify restoration of the original broker. An internal-only resolver may be explicitly declared; the address must not fall within the candidate address pool, to avoid route override. CI likewise first discovers and explicitly writes `HE_TEST_DNS`, then runs the real controlled container test.

## Evidence and boundaries

The receipt records the container ID, image ID, contract, actual settings and daemon version, kernel, architecture, and runtime registration data. Only whitelisted fields are serialized; `Config.Env` or the full inspect is not saved.

| Environment | Isolation boundary | Current acceptance |
|---|---|---|
| runc on Linux Docker / OrbStack | namespaces/cgroups, shared Linux kernel | Measured non-root, network disabled, read-only, drift rejection, and the complete DSH chain |
| gVisor/runsc 20261019.0 · systrap · Linux ARM64 | User-space Sentry handles application system calls | Measured on a dedicated Debian 13 Docker daemon: build, native DSH, grading, recovery, installation, and real model event continuation; see [acceptance evidence](evidence/2026-10-27-gvisor-acceptance.json) |
| Firecracker | KVM-driven independent guest kernel; also requires a production host and network configuration | Research complete; no MicroVM execution backend yet |

Receipts depend on a trusted daemon, cannot defend against a host administrator, and are not cryptographic remote attestation. This gVisor experiment machine disabled Mac file sharing and host/other-machine network access, but the OrbStack machine still shares the Linux kernel and cannot claim an independent microVM per task. The trusted controller holds a dedicated daemon socket, and candidate containers do not mount that socket. Real credentials for controlled execution remain in a separate egress proxy, and plugins use placeholder values; the independent process boundary still depends on the selected container runtime. Working directories and logs have no disk quota yet; memory/PID limits do not solve disk exhaustion. Current candidates should run on a dedicated research host. Disk quotas and the MicroVM backend still need further implementation.

Sources and acceptance are in [runtime isolation research](research/2026-10-27-runtime-isolation.md).

The [controlled egress architecture experiment](research/2026-10-28-controlled-egress.md) has verified on runc/gVisor the internal + isolated networks, out-of-process proxy credentials, explicit DNS/hosts, and proxy-stop failure. This experiment uses an independent HTTP fixture.

The [controlled egress component](controlled-egress.md) has been integrated into the formal Controller and optimizer; real models on both runc and gVisor completed interruption recovery, independent grading, evidence archiving, and resource release. The final gVisor image completed 4 model calls, the actual read-only DNS mount and digest verification passed, and the original container and network were reclaimed; see [this round's evidence](evidence/2026-10-28-gvisor-controlled-dns.json). The explicit finite address pool covers 62 networks and cross-process contention; failure cleanup is also persisted, and recovery only continues cleanup. The deployer must reserve an address range that does not conflict with the host/LAN/VPN; the framework only checks network segments already occupied by Docker IPAM and cannot replace deployment network planning.
