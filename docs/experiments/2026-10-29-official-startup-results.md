# Official DeepSeek Simplified Entry · Real Run

On 2026-10-29, one structured data evolution was completed with `npm start`, lasting 7 minutes 16 seconds, with the model fixed to the official `deepseek-flash` and 600 seconds per problem. Environment auto-build, data preparation, native optimizer run, candidate scoring, and original bundle export all went through the public entry. [Machine summary](../evidence/start-official-20261029.json) records the original report summary and image identity.

| Version | Modification | Three-problem mean | Verdict |
|---|---|---:|---|
| H0 | Initial read/write tools | 100% | Kept |
| H1 | Model autonomously modified `index.mjs`, adding event merging, grouped statistics, and exact join tools | 100% | Tied, promotion rejected |

All six task executions completed, and 162 model requests returned complete usage: 150,777 input and 46,136 output tokens; G accounted for 137 calls. This simple example validates the entry and the autonomous modification loop; H0 already scored full marks, so it cannot be used to prove a benefit of the optimization method.

The optimizer also wrote and ran three native probes on its own, and all three failed; in the exact join assertion, the actual unmatched returned was the package name `aa`, while the expected value was the entry ID `B2`. These failures are retained; the fact that the final three-problem score passed cannot be used to claim that all candidates are semantically correct. Strict selection ultimately exported the original H0 bundle, with SHA-256 `8d601c638fab194035fa40e5c49bad89de6789ea0108e38d3accca7e7a6d702c`.

This time, no additional independent validation set or post-install tasks for a new Profile were run. Original bundle installation and independent quality already have [separate historical acceptance](2026-10-28-official-deepseek-results.md); the benefit of the current method is tested separately by [three mutation controls](2026-10-29-mutation-space-registration.md).
