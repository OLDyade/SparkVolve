# Basis for Open-Source Repository Construction

The user specified [XHToken/dsh-intelligent-router](https://github.com/XHToken/dsh-intelligent-router) as a reference; this verification is pinned to [`d762b8e8ebd9f07dcea34fe2da56202f9f727fe4`](https://github.com/XHToken/dsh-intelligent-router/tree/d762b8e8ebd9f07dcea34fe2da56202f9f727fe4).

| Borrowed Direction | Implementation in This Repository |
|---|---|
| One-sentence understanding of value and mechanism | Retain the user's core sentence; README provides the complete feedback flow and entry points |
| Native plugin installation and invocation instructions | `npm pack → dsh plugin add`; the independent distribution test actually invokes the installed tool |
| Transparent versions and runtime boundaries | Pin DSH, Node, npm, and mirror; compatibility documentation and failure records |
| Participable, citable, verifiable | Contribution, Issue / PR templates, Code of Conduct, CITATION, CI |
| Clear license and attribution | The other party's LICENSE and package.json are Apache-2.0; this repository likewise adopts standard Apache-2.0 and retains this project's independent copyright |

No router implementation, product name, or model degradation strategy from the other party was introduced. The README's promotional expression does not replace real experiments; distribution tests, real-model acceptance, and independent research conclusions are listed separately.

Other verifications:

- npm 12 changed the `pack --json` structure to a package-name-keyed object. Local testing with npm 12.2.0 matches the [npm 12 changelog](https://github.com/npm/cli/blob/latest/CHANGELOG.md) and the [implementation](https://github.com/npm/cli/blob/latest/lib/commands/pack.js). The installation test handles the locked version, with no dual-format compatibility fallback.
- The DSH native command is responsible for incorporating the Bundle into the target Profile; the target Profile's pnpm build authorization still requires explicit configuration. Based on the installed version's `@deepseek-ai/dsh@0.2.1-rc.4` `runPlugin` / `runPluginCommand` and the actual installation output.
- The DSH adapter can return a transport failure via the finish event's `reason.kind=error`. Telemetry must count it as failed even if the generator does not throw; a real SDK subprocess test covers this path.

Previously, GitHub Actions was subject to account payment/spending quota limits, and jobs did not start. Subsequently, commits `fcf76f2` and `a486ce5` introduced another actual error: using `runner.temp` at the job-level `env`, causing the workflow to fail parsing. The two failures are recorded separately; the configuration error must not be attributed to account limits. Cloud results are listed separately as incomplete items, and local test results will not be written as a passing cloud matrix.

Based on the [GitHub context scoping table](https://docs.github.com/en/actions/reference/workflows-and-actions/contexts), the temporary directory initialization was moved into a step and passed to subsequent steps via `GITHUB_ENV`; the artifact upload step `with` continues to use the valid `runner.temp`. A pinned version of [actionlint 1.7.12](https://github.com/rhysd/actionlint/tree/v1.7.12) was added, the original error was reproduced locally, and the fix was verified to pass. The same `go run` as in CI first failed due to an EOF from the Go checksum service; after retaining the checksum settings, it succeeded on re-execution; dependency verification was not disabled. A read-only subagent review passed.

The post-push [a2905ca run](https://github.com/OLDyade/SparkVolve/actions/runs/40536959221) resolved four jobs; the job annotations explicitly report payment failure or spending quota limits, and no steps started. The scoping fix has been verified by remote parsing, but cloud execution acceptance remains incomplete.

## Bilingual Entry Points, Technical Diagrams, and Measured-Result Diagrams

After re-checking the colleague's repository at the pinned commit, its organization of value positioning, architecture, usage demonstration, lifecycle, and developer entry points was borrowed. The project's core sentence is retained, with an English README, component and continuation diagrams, and experiment diagrams generated directly from machine records added.

- GitHub officially supports [Mermaid diagrams](https://docs.github.com/en/get-started/writing-on-github/working-with-advanced-formatting/creating-diagrams) in Markdown; basic flowchart, stateDiagram, and sequenceDiagram are used here, and actual rendering was verified via Mermaid CLI.
- The [official workflow badge](https://docs.github.com/en/actions/how-tos/monitor-workflows/add-a-status-badge) links to the actual workflow; pass status is not hand-written. Private repository badges are not guaranteed to be visible on external sites.
- Result diagrams use Matplotlib `3.10.8`, reading candidate identity, scores, and final states from existing JSON; the full denominator is fixed, and negative results and service failures are shown. Both images and SVG can be rebuilt; no optimization curves were fabricated by hand.
- The subagent review pointed out that the side-by-side diagram should explicitly re-verify candidate identity; this has been matched to Mutation 1 by machine records; the core idea and `11.md` are unchanged.
