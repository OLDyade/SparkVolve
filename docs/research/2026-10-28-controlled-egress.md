# Controlled Network Egress: Ecosystem Verification and Real Boundary Experiments

2026-10-28. The goal is to allow mutable plugins to access the network only through declared service egress, with model credentials kept in the trusted process. This work completes the architecture experiment and a repeatable acceptance script, and **has not yet been integrated into the formal experiment controller**.

## Materials, Versions, and Choices

| Material | Verified Fact | Impact on This Project |
|---|---|---|
| Docker [gateway modes](https://docs.docker.com/engine/network/port-publishing/#gateway-modes), [DNS](https://docs.docker.com/engine/network/#dns-services); Context7 `/docker/docs` | A normal internal network can still reach the host gateway; since Docker 28, isolated gateway mode does not assign a host address to the bridge. Custom networks usually use the built-in DNS, and external resolution requires separate constraints | Each execution unit gets an independent internal + isolated network; DNS is set explicitly, and "no default route" is not treated as the entire network boundary |
| Anthropic [sandbox-runtime Linux wiring](https://github.com/anthropics/sandbox-runtime/blob/98a4016d27609ed34dd1fb43d23ed6efb6eeeb77/src/sandbox/linux-sandbox-utils.ts#L1488), [resolved address protection](https://github.com/anthropics/sandbox-runtime/blob/98a4016d27609ed34dd1fb43d23ed6efb6eeeb77/src/sandbox/resolved-address-guard.ts) | Linux uses an independent network namespace, routed via Unix socket / socat to a trusted HTTP/SOCKS proxy; domain allowlisting still needs to constrain the actual resolved address. The source code explicitly separates the proxy layer from the namespace layer | Reuse the "isolated network + trusted egress" layering; keep the Docker/gVisor execution backend, not just setting HTTP_PROXY. Future general network access interfaces must handle DNS rebinding and private-network destinations |
| LangSmith [sandbox auth proxy](https://docs.langchain.com/langsmith/sandbox-auth-proxy) | The trusted egress injects authentication outside the sandbox according to rules; the SDK can use placeholder credentials; network permissions and credential injection are configured separately | Formal model calls should go through explicit service routing; plugin processes do not need to hold real Keys. External APIs themselves may still echo data back, and a proxy does not mean any upstream is trusted |
| X [developer practices](https://x.com/kraitsura/status/2005394713864790247), [Bubblewrap discussion](https://x.com/xds2000/status/2044034948894732544) | The search surfaced discussions of headless Agent/worktree and Linux sandbox applications; the interaction volume returned this time was limited | Used only as practical leads; no claim of being the most popular or of security effectiveness is made based on them, and the performance ratios in the posts were not adopted |

The dedicated Debian/OrbStack instance on this machine does not have `/dev/kvm`. The existing runsc/systrap has actual acceptance; this work did not relabel the shared OrbStack kernel as a MicroVM, nor did it start Firecracker without KVM.

## Acceptance Topology

```text
Trusted test controller (sole holder of the Docker socket; saves logs/receipts)
        │ creates and verifies
        ├── host HTTP service fixture ──random test credential──┐
        │                                   │
        ├── normal internal network → positive control: host reachable
        │
        └── per-execution-unit internal + isolated network
               │
          non-root candidate process ──sole proxy address──► trusted proxy fixture ── uplink ──► host service
               │                             │
               ├─ no real model key              └─ authenticates on its behalf, restricts methods/paths
               ├─ explicit hosts binding to the proxy
               ├─ DNS points to its own loopback
               └─ direct host / external IPv4, IPv6 / external DNS: probes fail
```

Run `SPARKVOLVE_TEST_IMAGE=<local immutable image ID> SPARKVOLVE_TEST_RUNTIME=<exact runtime> node scripts/verify-egress-boundary.mjs <fresh evidence directory>`. Only Node is required inside the image; no real model credentials are used and no paid models are called. A trusted Docker daemon is required; the host network fixture uses runc, and the candidate under test uses the specified runtime. The script preserves each container's original logs and allowlist configuration, and finally deletes the fixtures and networks with this run's unique prefix; if the output directory exists, it refuses to overwrite.

## Observed Results

- Docker 29.8.2/runc and the dedicated Debian Docker 29.9.2/gVisor `sparkvolve-runsc-20261019` both pass the final script.
- The normal internal positive control read the random nonce from the host service, proving the service is genuinely available; the isolated candidate's direct connections to the host address and external IPv4/IPv6 fail.
- The candidate did not receive the test credential; even when submitting a wrong Authorization, the trusted proxy still completed authentication to the same upstream using its own credential; unpermitted paths were rejected.
- The actual Docker configuration was verified for a single candidate network, the specified runtime, DNS, and hosts; the guest routing/resolution configuration was read. Resolution requests to both the external default DNS and the specified public DNS failed.
- After the proxy was stopped, calls failed and did not fall back to direct connections. The fixture exit code 137 caused by stopping the proxy is fault injection in this work, not a business experiment failure.
- The initial gVisor experiment could not resolve the Docker network alias `broker`, and the original failure report is preserved. In the end, both runtimes uniformly write the same-network proxy IP resolved by the controller into hosts, removing the dependency on Docker's built-in alias resolution; no runtime was switched after failure and no access permissions were changed.

The machine-readable summary and the raw receipt summary are in [network experiment record](../evidence/2026-10-28-egress-boundary.json). This proves the network behavior in the specified host, image, and probe scenarios; it does not prove resistance to container escape, all DNS tunnels, malicious proxies, or the security of production credential services. The HTTP proxy is a test fixture; the script does not implement a production HTTPS identity proxy or complete domain filtering.

## What the Formal Implementation Must Still Complete

1. The contract explicitly freezes the route, upstream, credential environment variable names, and request scope; real values enter only the trusted proxy. Model, budget, and scoring identities continue to be controlled by the experiment contract.
2. Create an independent network and proxy per single execution intent; write the network/proxy/candidate identities and addresses into persistent evidence; on recovery, verify the actual topology, expose proxy loss directly, and do not implicitly rerun tasks.
3. The native DSH Provider uses a fixed proxy entry point; the optimizer control API uses a separate precise route. Build sources and research access go through independent approved scopes; QA, grader, and probe remain network-disabled.
4. Verify streaming responses, cancellation, connection interruption, address rebinding, cross-task access, and cleanup, and complete end-to-end acceptance with the real DSH model. The existing bridge path remains marked with its limitations as originally stated until this part is complete.
