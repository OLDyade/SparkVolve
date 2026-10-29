# gVisor Controlled Egress: DNS and Real-Model Acceptance

## Original Failure and Sources

The original formal Controller acceptance returned `upstream_error` on the first model request, and the ledger had no resolved address. A credential-free probe was then run on the same gVisor runtime and two custom bridges: container `/etc/resolv.conf` was `127.0.0.11`, and `dns.lookup` returned `EAI_AGAIN`. On the default bridge, the explicitly observed environment resolver was `0.250.250.200`, and resolution succeeded.

The [gVisor official FAQ](https://gvisor.dev/docs/user_guide/faq/#docker-bridge) explicitly states that Docker's built-in DNS on a custom bridge requires the host network stack, which runsc netstack cannot access; passing only `--dns` still leaves the built-in DNS address. We adopted its approach of read-only mounting a resolver file, preserving Sentry and dual-network isolation.

## Implementation

- The contract explicitly freezes 1–3 IPv4 resolvers; it does not default to public addresses and does not switch policy with the runtime. It rejects duplicates, loopback, multicast, broadcast, `0.0.0.0`, and overlap with the address pool; internal addresses explicitly provided by the deployment environment are allowed.
- The file is generated verbatim and mounted read-only by the broker; the contract and container identity include DNS, recovery verifies bytes and mount, and a digest is saved before release. Drift in an existing file fails directly, and recovery does not rewrite to mask it.
- The broker ledger records the failure stage and known native error codes, and does not save exception text, credentials, or request content. DNS answers are still resolved once and fully verified, and connections are pinned to the verified address.
- The deployment script only discovers candidate resolvers for the default bridge of the specified image/runtime; final controlled-network reachability is verified by actual requests. CI saves the discovery artifact and passes it explicitly to the tests.
- The [Linux resolver documentation](https://man7.org/linux/man-pages/man5/resolv.conf.5.html) specifies `MAXNS=3`, and the actual image header also has 3; the contract rejects anything over the limit.

## Actual Acceptance

Final image `sha256:6708cd91fdfb6a802432f20f4a97bff3ca2dfb47116cbbf3c520e00eaa9f3cf3`. The compiled contract, session, and broker file digests were compared against the actual image.

| Acceptance | Result |
|---|---|
| Unit / native DSH | 53 / 9 passed; new DNS contract and failure-diagnosis assertions added |
| runc / gVisor container matrix | 12 items each passed on the same final image |
| Real model, original container continuation, independent scoring | On gVisor, 4 started / 4 result / 0 failed / 0 unfinished; score 1 |
| DNS, lifecycle, reclamation | Actual read-only mount, file digest, original worker/broker identity verification; containers and both networks reclaimed; repeated pump produced no new calls |
| Distribution install | Native install and capability invocation passed after actual packaging |

Model input 1571 / output 283 tokens, request duration sum 5461ms. The raw HTTP ledger shows 3 completed / 1 cancelled, all connected to the resolved address and receiving HTTP 200. HTTP consumer response closure and model completion are different observation dimensions; cancelled is not rewritten as completed, and no specific cause is inferred for each closure. The actual [OpenAI SDK stream implementation](https://github.com/openai/openai-node/blob/main/src/core/streaming.ts) exits on the completion marker and releases the reader; the local dependency version 7.19.0 has been checked. Two Context7 searches did not return an accurate SDK entry, so we consulted the official source and the actual installed implementation.

## Preserved Failures

The original DNS failure was not rewritten; the initial image's address validation mistakenly treated the OrbStack resolver as unspecified for the entire `0/8`, which has been corrected; the test loader's original fixed node_modules relative path was changed to native module resolution, and the original failure log is preserved. One engineering task on the final image was delivered and scored, but the newly added acceptance assertion mistakenly required all HTTP to be completed; the original failure report is preserved, and after correcting the acceptance condition, the same production image was verified in a new directory. The additional assertions pairing one by one by UUID and requiring non-empty model usage were re-checked read-only on the original final artifact, without running the model again.

An independent subagent review identified the MAXNS issue and completed the re-check; the corresponding failure, final receipt, original log digest, and file identity are in the [evidence JSON](../evidence/2026-10-28-gvisor-controlled-dns.json). This proves the engineering chain and does not constitute an accuracy-gain experiment. Disk quota, MicroVM, stable quality, and cloud CI are still being advanced according to the full delivery checklist.
