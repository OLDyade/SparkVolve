# Public Repository, Cloud CI, and Real Delivery of the Original Package

On 2026-10-28, with explicit user authorization, `OLDyade/spark-harness-evolution` was changed to a public repository. The core idea and the original text of `11.md` remain unchanged; public source code does not equal publishing to npm or a GitHub Release.

## Cloud Engineering

The original private CI had no execution steps due to payment/quota. After going public, standard GitHub runners actually started, and the quota error no longer appeared; real runs exposed the following engineering issues:

- macOS ARM64 does not have Go preinstalled: the workflow explicitly installs a fixed Go version to run actionlint.
- After gVisor installation, only Docker was reloaded, and `host-gateway` resolved to `invalid IP`: the install script fully restarts Docker on the dedicated host. The test HTTP fixture registers cleanup immediately after creation, so an initialization failure does not leave a listening service behind that stalls CI. Immediate TAP and container logs preserve the original failure. See [diagnostic evidence](../research/2026-10-28-public-ci-and-transport.md).
- In gVisor, Landlock is unavailable and the image lacks Bubblewrap: the DSH native backend dependencies were completed. Native Bubblewrap recreating `/tmp` each time would shadow the old HOME, so it was uniformly changed to a temporary mount with an independent quota inside the workspace. Consecutive native tool calls and delivery not carrying HOME contents are both included in regression.

In [CI 40625648430](https://github.com/OLDyade/spark-harness-evolution/actions/runs/40625648430) of `0b67a10`, Linux and macOS each passed 255 unit, 26 native, and same-package installation checks; runc passed 23 items. gVisor failed at the time and was then cancelled. In the [full matrix](https://github.com/OLDyade/spark-harness-evolution/actions/runs/40627364489) of `d222dfd`, the other three paths passed, and gVisor was 21/23, exposing the missing native tool backend.

In the [corrected run](https://github.com/OLDyade/spark-harness-evolution/actions/runs/40628650904) of `9ba0e38`, Linux/macOS and gVisor all passed, with gVisor **23/23**; runc was **22/23**, exposing a race where the cancellation test opened a strict database reader before the experiment initialization had been committed. The test was changed to observe the committed `prepared` state of `initialization.sqlite`, then verify the original execution container and send SIGINT; the full interruption, cancellation, idempotency, and no-new-arm assertions passed on a local real runc. No contract mismatch errors were swallowed, no waits were extended to mask problems, and no tasks were retried. The results of each commit are preserved independently, and the latest main-branch matrix can be viewed from [Actions](https://github.com/OLDyade/spark-harness-evolution/actions/workflows/verify.yml).

The actual npm tarballs built from clean commit `0b67a10` on Linux x64 and macOS ARM64 are byte-for-byte identical: SHA256 `055ac14a3232325d25d35af596e55393f1407dfd662f5a452a123aaccd927696`, and both platforms install and invoke the same archive. The original manifest, SBOM, and archive were downloaded from CI and verified, see [reproducible build receipt](../evidence/public-delivery-20261028/reproducible-package.json). This evidence covers only the corresponding commit and the two actual environments, and does not guarantee any future environment.

The corrected `48e835c` in [CI 40629306937](https://github.com/OLDyade/spark-harness-evolution/actions/runs/40629306937) **passed all four paths**: Linux/macOS each 255 unit, 26 native, and 1 actual distribution package installation; runc/gVisor each 23 container tests. The final state was cross-verified via the GitHub API and the actual logs of each job, see [machine receipt](../evidence/public-delivery-20261028/cloud-ci-40629306937.json). Previous failure and cancellation records are fully preserved; no failing tests were disabled and no isolation requirements were lowered.

## 600-Second Real Model Acceptance

The native runtime is frozen at `0b67a10`, with actual image `sha256:f4a77050fd1a786c983e2b4a2e08ff117f6db5332e35ab61cfa87a99625f2de9`. The new contract registers four task types, two candidate budgets, and independent validation; the old optimizer or failed tasks were not rerun, and no service or model was switched.

| Stage | Actual Result | Calls: started/returned/failed/unclosed |
| --- | --- | --- |
| Search H0 and optimizer | H0 four questions scored 0.25, 1, 1, 1; G upstream stream lacked an end marker, no candidate submitted | 54/53/1/0 |
| Originally registered independent validation | All 8 slots reached terminal state, 6 scored, 2 execution failures; both arms were the same H0, full means 81.25%/50% | 32/30/2/0 |
| Independent delivery after original package installation | Four clean DSH Profiles installed and executed, 4 scored, 0 execution failures; scores 0, 1, 1, 1, mean 75% | 24/24/0/0 |

Of the 12 task slots originally planned for search, 4 H0 slots were actually executed, and the remaining 8 candidate slots did not occur; all 8 originally registered slots of independent validation were settled. Therefore, of the 20 slots originally planned, 12 were actually executed, plus 4 independent installation delivery slots. Unexecuted slots are not passed off as observations, and installation scores are not added into search or validation.

Model usage was respectively: search input 86810/output 17245 tokens; validation input 28053/output 7349; independent installation delivery input 20400/output 5827. The digest of the original failed acceptance file remains `6a40ba913bfd72868de6d088a6cc00bd2b666fa986e51ca99b40ad91a3ef34f4`, and the continued validation and delivery did not rewrite it.

## Transport Evidence and Remaining Boundaries

G's failed request completed TCP in about 70ms, and completed authorized TLS and request write in 212ms; HTTP 200 was received only after about 301132ms, after which the response ended, and the model adapter reported `Stream ended without finish_reason`. The validation normalization task showed the same kind of about 301 seconds without an end marker; another task `ECONNRESET` at the TLS stage, the egress generated a 502, and **there is no evidence of an upstream HTTP 502**. This differs from the local 600-second deadline; it is impossible to determine from these logs alone which remote component terminated the request.

Installation delivery used the original H0 archive `27acd1a2cbc6f3c222d54e3022406f210855af948fb6169800573363aab20f3a`. All four Profiles were resolved to the installed package by the native loader, and file digests were identical before and after execution; execution does not mount `/candidate`. Installation mechanism pass and business correctness are reported separately, and a normalization score of zero is preserved as is.

**Full autonomous mutation acceptance still does not pass, and stable quality gains and complex cross-plugin autonomous refactoring still require real evidence.** Currently, the originally registered and independently executable validation and same-package delivery have been completed; no fixtures, handwritten candidates, or automatic retries were used to replace the failed model experiments. Machine digests and original file digests are in [real acceptance](../evidence/public-delivery-20261028/real-acceptance.json) and [source index](../evidence/public-delivery-20261028/sources.json).
