# Formal Egress Integration: Independent Review and Remaining Implementation

This round of work is based on `174a702e1b9d156cbb1f4d320a0424891358a50b`, implemented and accepted item by item in the `feat/controlled-egress` working tree. The core idea, promotional positioning, and `11.md` are unchanged.

## Verified

1. Routing enters the experimental identity; the optimizer's and executor's real credentials remain in their respective trusted brokers; candidates receive only placeholder values. The control API fixed path and the external model route are declared separately, and the external route cannot override control capabilities.
2. The formal Controller's actual model calls, tool writes, and independent scoring hold. After the host wait is interrupted, it reconnects to the original worker/broker, attempt=0, and all 4 model requests have results; pumping again in the terminal state produces no new requests.
3. The native optimizer completes the control API lifecycle through the actual broker; independent container tests check direct-connection rejection, authentication replacement, foreign endpoints, preparation interruption, and disappearance of the original container.
4. The persistent preparation/creation intent/created state of `prepareExecution` has fixed the preparation window found in the first independent review. Re-review confirms this item is resolved, with no new blockers.

The first real-model acceptance fixture was missing the build script, so the build failed immediately with 0 model calls; the original report is retained. After fixing the acceptance fixture, a new directory is used, without overwriting failed or mixed attempts. [Machine-readable receipt](../evidence/2026-10-28-controlled-controller-integration.json)

## Network Resource Lifecycle: Problems and Fixes

The original wiring allocated two default bridges per execution and fully retained stopped containers and networks. In practice, Docker by default has only 30 IPv4 `/24` address pools; 30 concurrent questions require at least 60 networks, which may be exhausted before running. Serial experiments also accumulate. The test's finally cleanup only cleans up test fixtures and cannot represent that the formal system has reclamation capability.

The current implementation uses a contract-declared finite private IPv4 address pool and persistent `/29` leases, and separates execution terminal-state archiving from resource reclamation:

```text
Contract freezes address pool and capacity → prepare lease → run original container → collect all raw evidence
                           │                    │
                     host interruption retains          persist execution terminal state
                     same lease/container               │
                                           detach endpoint and release lease
                                               │
                                           archived evidence is reviewable
                                  reclamation interruption only continues cleanup, does not rebuild execution
```

Must cover: target concurrency capacity, cross-process allocation conflicts, preparation interruption, run interruption, interruption between terminal-state write and reclamation, repeated cleanup, and zero new model requests after archive recovery. Run evidence should retain the original container ID, configuration, logs, request ledger, and content identity. Acceptance must not be passed by automatic reruns, unbounded pool expansion, or only modifying test cleanup.

In practice, it has passed 62 subnet capacity, first-choice lease contention among 8 independent processes, successful terminal-state reclamation interruption, failed reclamation interruption, and original worker recovery validation failure wrap-up. Independent re-review additionally found premature terminal state on failed cleanup and loss of the original worker contract on recovery exceptions; `execution-failure.json` and pre-creation persistent `execution-spec.json` have been added, so the Controller/optimizer first continue cleanup, then record the business failure, without entering a new execution. Controller fault injection confirms one create, one collect, and two cleanups.

Real-model acceptance in a new directory passed: original worker/broker IDs retained, all 3 calls returned, independent score 1, attempt=0; after archiving the original container is removed, and pumping again in the terminal state produces no new requests. Full resource evidence is in the [machine-readable receipt](../evidence/2026-10-28-egress-resource-lifecycle.json). Runtime and call counts are reported only; this item is not a score-improvement experiment.

Also tested in practice was the approach of reusing the default `bridge` as the broker uplink: Docker rejects multi-network creation that attaches both the default network and a user-defined network at the same time; the original error was `cannot attach both user-defined and non-user-defined network-modes`. Therefore dual user networks are retained, with explicit small-subnet allocation and terminal-state reclamation, and no shared-default-network downgrade. Pool selection is part of deployment network planning; Docker IPAM can only detect daemon networks and cannot replace LAN/VPN conflict checks.

## Verified Sources

- Docker official [network and multi-network gateway priority](https://docs.docker.com/engine/network/); Docker 29.8.2 real verification of multiple `--network name=...,gw-priority=...,ip=...`.
- Docker official [bridge network management](https://docs.docker.com/engine/network/drivers/bridge/): detach container connections before deleting a network; stopping a process does not equal resource reclamation.
- Docker official [IPAM configuration](https://docs.docker.com/reference/compose-file/networks/#ipam): explicit subnet / ip_range / gateway / aux_addresses; one cannot assume the host default address pool supports the target scale.
- The local `docker info --format '{{json .DefaultAddressPools}}'` was measured in practice as 30 IPv4 `/24` pools, plus one independent IPv6 pool; IPv6 is not a substitute for the current IPv4 contract.

Industry solutions and version sources continue to follow the [controlled egress research](2026-10-28-controlled-egress.md). What the above findings change is the formal infrastructure implementation, not the project's core positioning.
