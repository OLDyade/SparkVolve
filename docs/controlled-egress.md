# Controlled egress: let mutable plugins use services while credentials stay outside the boundary

The egress component is now wired into the Controller and optimizer sessions; the contract explicitly declares each route, the executor network is `controlled` or `none`, the optimizer uses `controlled`, and QA/scoring have no network. The real Controller has completed model → tool → private scoring, and after a host wait interruption it reattached to the same worker and broker. Both runc and gVisor now have formal chains and recovery evidence; current-version tests and remaining items are governed by [completion status](completion.md), and disk hard quotas and the optional MicroVM are not replaced by egress validation.

```text
Frozen routes: method / local path / upstream / address range / model / output quota
                              │
Candidate DSH                      ▼                    Trusted egress process
┌─────────────────────┐   sole entry point  ┌─────────────────────────┐
│ Native Provider + Loop │ ─────────────────► │ Check path and request contract │
│ Native tools and candidate plugins │   internal         │ Resolve once → verify all addresses │
│ Placeholder credentials, no real Key │   + isolated       │ Pin connection IP, keep TLS verification │
└─────────────────────┘                    │ Inject real credentials from its own environment │
  DNS loopback / explicit hosts                    │ Stream original bytes, propagate cancellation │
  No direct public route                           └───────────┬─────────────┘
                                                        │ uplink
                                                        ▼
                                                  In-contract upstream service

  UUID started (persisted) → request → finished (persisted)
  Stop accepting → cancel connections → wait for requests to finish → close ledger
```

`src/egress.ts` provides strict route configuration, address validation and streaming forwarding; `src/runtime/egress.ts` is the standalone process entry point. Model credentials are passed to the trusted proxy via the environment, and candidates only use the native Provider's local placeholder values. Network namespace constraints are enforced by the deployer; running a proxy alone cannot constrain plugins from connecting directly.

| Behavior | Contract and implementation |
|---|---|
| Destination | Exact method/path match; candidates cannot supply a URL; CONNECT, Upgrade, forwarding redirects and failure retries are not supported |
| Request | Limits byte count, fixed top-level JSON fields and integer upper bounds; does not rewrite the request body; client authentication headers are not passed through |
| Protocol headers | `forwardHeaders` explicitly declares which protocol headers to pass through; for example Messages' version, beta and Accept. Undeclared client headers are not passed; authentication, Host and HTTP transport headers are held by the proxy |
| Address | Public HTTPS or explicit IP ranges; any out-of-range DNS result causes rejection; the connection is pinned to the addresses verified for this request |
| TLS | Native Node verifies the certificate and target identity; verification is not disabled; the upstream is not downgraded to plaintext |
| Stream | The original response stream is forwarded with backpressure; client close and timeout cancel the upstream; HTTP error statuses are preserved |
| Ledger | Independent UUID; records route ID, address, HTTP status, terminal state and native transport phase timestamps, without bodies/credentials; fsync after write; a write failure stops the proxy and reports an error |
| Shutdown | Waits for in-flight requests to write their terminal state before closing the ledger; SIGTERM aborting a streaming request also preserves `cancelled` |

HTTP `cancelled` means the consumer closed the connection and cannot by itself determine that the model task failed. The native SSE SDK may close HTTP after consumption ends; task conclusions also check DSH native end events, the usage ledger and actual delivery. The proxy preserves the original transport terminal state and does not rewrite it as success.

`transport` fields provide monotonic millisecond timestamps relative to request start: reading the body, parsing, socket allocation, TCP connection, TLS handshake, finishing the write of the request to the OS, response headers and response body completion. Events not observed are left unset; `requestFlushedMs` does not prove the upstream received the body. The `stage=connect` of older records includes the entire wait before response headers and cannot be used to infer a TCP fault. See [phase diagnostics](research/2026-10-28-public-ci-and-transport.md).

## Acceptance and reproduction

The early integration version passed 53 unit tests and 9 native tests, and the same image at that time passed 12 runc and 12 gVisor container regressions respectively; these counts belong to historical versions. Tests cover fixed routes, model/output ranges, injected authentication, complete DNS answers, streaming first event, cancellation, timeout, redirects, no retry, ledger failure, and untrusted certificate rejection and streaming SIGTERM in a real HTTPS subprocess. TLS tests use temporary self-signed test certificates; the development environment requires OpenSSL.

The following script uses real models and incurs call costs. The credential file is read only by the trusted launcher; the output directory must be brand new. The Docker image must come from an actual build of the repository Dockerfile, with Node native dependencies matching the current architecture.

```bash
npm ci
npm run build
mkdir -p .evolution
HE_TEST_IMAGE=$(docker image inspect harness-evolution:local --format '{{.Id}}') \
  node --env-file=/absolute/private/venus.env \
  scripts/verify-egress-native.mjs .evolution/egress-native-acceptance
```

The script creates an isolated network, a dual-NIC proxy and a non-root DSH container, makes real model calls and executes a tool to generate a JSON file. The proxy listens only on the candidate subnet address; the candidate receives no real credentials, direct connections to public addresses fail, and unpermitted paths are rejected. At the end it saves the raw receipts and logs, then cleans up this run's containers/network; it does not overwrite failed results and does not rerun business samples.

Final measured result: 2 model requests, 2 native results, 0 failures/incomplete; the tool wrote `{"sum":55}`; all 3 HTTP requests have terminal states (including one rejected path probe), and the proxy exit code is 0. The image is pinned, newly compiled files run as read-only mounts, and the source and actual compiled file digests are recorded separately. [Machine-readable evidence](evidence/2026-10-28-egress-native-transport.json) also preserves the tmpfs and SSE assertion issues of the early acceptance script. This result proves transport and wiring, not an accuracy gain.

### Controller / optimizer wiring acceptance

- `Experiment.egress` freezes two classes of external routes; the control API's fixed paths are produced by the trusted launcher, and external routes are forbidden from overriding control capabilities.
- `execution-intent.json` distinguishes prepared, create intent issued, and created. An interruption during the preparation phase can continue with the same network/proxy; after the create intent, a missing original worker means failure, and no replacement task is generated.
- Each run retains the network ID, proxy container ID, original configuration, actual isolation receipt and request ledger. Recovery verifies actual Docker state; foreign network members or a lost original proxy cause rejection.
- `tests/container/egress-session.test.ts` uses real Docker: verifies credential substitution, direct-connection rejection, preparation-phase interruption, original container recovery, stop idempotency, foreign network members and loss of the original container. The native optimizer completes the control API lifecycle through the proxy.
- `scripts/verify-controlled-controller.mjs` uses real models and the formal Controller, actively interrupts the host wait, then continues with the original container; this run's independent score is 1, attempt=0, all 4 model requests have results, and pumping again after completion adds no requests. This is engineering wiring acceptance, not a quality-gain experiment. The first acceptance fixture lacked `scripts.build`; the build failure record is preserved as-is, and no model requests were made.

The first direction review found insufficient default address pool capacity and terminal-state network accumulation; the original findings and the previous round's receipts are preserved in [wiring evidence](evidence/2026-10-28-controlled-controller-integration.json). These have now been fixed with explicit address allocation and recoverable reclamation; see [resource lifecycle evidence](evidence/2026-10-28-egress-resource-lifecycle.json).

### Limited resources and evidence archiving

```text
Frozen egressPool → Docker IPAM atomically leases two /29 → original worker / broker
                          │                         │
                    preparation interruption continues                host interruption reattaches
                                                    │
                              ┌─────────────────────┴─────────────────────┐
                              ▼                                           ▼
                    save terminal state, isolation receipt, logs                  save failure reason and original worker contract
                              │                                           │
                    execution-completion.json               stop original process, collect raw failure evidence
                              └─────────────────────┬─────────────────────┘
                                                    ▼
                                      release.json records IDs and evidence digests
                                                    │
                                     delete original container → delete network → released
                                             after interruption only continue cleanup
```

- `isolation.network.egressPool` must be reserved by the deployer; each run uses two `/29`, so 30 executors plus one optimizer require 62. The contract rejects insufficient capacity; actual allocation excludes CIDRs already used by the daemon, and Docker IPAM arbitrates cross-process contention. The host default pool is not enlarged.
- `isolation.network.egressDns` freezes the 1–3 explicit IPv4 resolvers used by the trusted broker; there is no public DNS default, and overlap with the address pool is not allowed. Deployment discovery only provides a candidate list; the final controlled network still requires actual resolution acceptance, see [egress DNS](isolation.md#egress-dns).
- Containers are deleted only after the success receipt is persisted. Recovery reads the original container ID, contract identity and complete log digests; a modified archive causes an immediate error. The failure reason is persisted first, a cleanup failure keeps a resumable state, and re-preparing or executing tasks is forbidden.
- Real containers verified 62 independent subnets; 8 processes simultaneously requesting the same preferred subnet received 8 different leases; exhaustion fails explicitly. Both success and failure reclamation inject a deletion interruption, and after recovery the original task was not rerun.
- Formal Controller real-model re-verification: all 3 calls returned, independent score 1, attempt=0; after a host interruption the original worker/broker was recovered, archive reclamation completed, and pumping again added no requests. This arithmetic task verifies the engineering chain and does not support a quality-gain conclusion.

Formal Controller reproduction (requires build first):

```bash
HE_TEST_RUNTIME=runc HE_TEST_IMAGE=$(docker image inspect harness-evolution:local --format '{{.Id}}') \
  HE_TEST_DNS="${HE_TEST_DNS:?Set approved IPv4 DNS servers}" \
  node --env-file=/absolute/private/venus.env --import tsx \
  scripts/verify-controlled-controller.mjs .evolution/controller-resource-acceptance
```

The native gVisor formal-chain re-verification has been completed: [actual model evidence](evidence/2026-10-28-gvisor-controlled-dns.json) includes 4 model requests, original worker/broker recovery, independent score 1, terminal-state reclamation and no added requests on continuation. The early [HTTP fixture architecture experiment](research/2026-10-28-controlled-egress.md) is retained. Disk quotas and the MicroVM backend are covered separately in [completion criteria](completion.md) and are not replaced by this item.

Network wiring was checked against Docker [multiple networks and default gateway](https://docs.docker.com/engine/network/), [bridge management and connection removal](https://docs.docker.com/engine/network/drivers/bridge/) and [IPAM configuration](https://docs.docker.com/reference/compose-file/networks/#ipam). Docker 29.8.2 was measured to support multiple `--network name=...,gw-priority=...,ip=...`; the documentation explicitly requires disconnecting containers before removing a network, and a stopped container alone cannot be considered a reclaimed network.

Design basis: Node 24 [connections and address families](https://nodejs.org/docs/latest-v24.x/api/net.html#socketconnectoptions-connectlistener), [HTTPS](https://nodejs.org/docs/latest-v24.x/api/https.html), [streaming cancellation](https://nodejs.org/docs/latest-v24.x/api/stream.html#streampipelinesource-transforms-destination-options); address classification uses the exact dependency [ipaddr.js 2.5.0](https://github.com/whitequark/ipaddr.js). Industry basis, versions and community leads for deployment and credential boundaries are in [controlled egress research](research/2026-10-28-controlled-egress.md).
