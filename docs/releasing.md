# Distribution, Reproduction, and Release

Capability Bundles and the self-evolution infrastructure both follow DSH native installation. Before release, deliver the actual reviewable package, dependency manifest, and verification records; the source repository was made public on 2026-10-28 per user instruction, and the build process does not automatically create a Release or publish an npm package.

The candidate `export` simultaneously generates the [capability card](capability-cards.md), the original research archive, and the usage report at export time. They describe the actual frozen package and experimental boundaries without modifying the tarball; the `package:artifacts` below is used to distribute the self-evolution infrastructure itself.

```text
Pin source and lockfile → checks / native integration → clean install → npm pack
                                               │
                         ┌─────────────────────┼───────────────────┐
                         ▼                     ▼                   ▼
                   installable bundle.tgz     dependency SBOM + lockfile    identity and SHA256
                         └─────────────────────┼───────────────────┘
                                               ▼
                             CI Artifact / local delivery directory
                                               │
                              version and license review + explicit release decision
                                               ▼
                                     public Release / package registry
```

## Generating a reviewable package

After completing checks, native installation, and acceptance in the corresponding domain container per [Contributing](../CONTRIBUTING.md), run:

```bash
npm run package:artifacts -- .evolution/release-inspection
HE_INSTALL_PACKAGE="$PWD/.evolution/release-inspection/harness-evolution-dsh-bundle-0.0.0-development.tgz" \
  npm run test:install
cd .evolution/release-inspection
shasum -a 256 -c SHA256SUMS
```

The output directory must not already exist; failure evidence is not overwritten. The command actually performs the build and `npm pack`, verifies tarball integrity, required entry points, and forbidden runtime directories, then generates:

| File                    | Purpose                                                                            |
| ----------------------- | ------------------------------------------------------------------------------- |
| `*.tgz`                 | The actual npm package for this run; installed via `dsh plugin --profile sdk add /absolute/package.tgz` |
| `artifact.json`         | Source commit, whether the working tree has modifications, runtime versions, files in the package, and package and dependency manifest digests                  |
| `dependencies.cdx.json` | npm native CycloneDX SBOM, derived from the lockfile, excluding dev-only dependencies                             |
| `package-lock.json`     | Full repository lockfile snapshot at the time this manifest was generated                                                    |
| `SHA256SUMS`            | Verifies the byte identity of this delivery                                                          |

The install test specifies the same actual tarball via `HE_INSTALL_PACKAGE` and verifies digests before and after installation; when unspecified, the test packs its own. When the package name or version changes, use `archive.file` in `artifact.json`; CI also reads from that field. The SBOM describes the repository dependency snapshot; final resolution of a consumer DSH Profile still requires actual installation verification. Digests can detect byte changes but cannot prove publisher identity. A dirty working tree is explicitly recorded, and the package cannot be attributed as the product of a clean commit. The current `0.0.0-development` is a development identifier and does not claim a stable release.

## Original-package installation acceptance for frozen studies

After the fixed-method comparison ends, the originally registered G, H0, and the actually selected H can be accepted in one pass. The entry point reads the original SQLite and frozen identities and produces new installation records outside the study directory; it does not start search, scoring, packaging, or model inference. In-flight studies are rejected outright.

```bash
node scripts/verify-study-artifacts.mjs \
  --evidence-root <existing-study-evidence-root> \
  --output <new-installation-evidence-directory> \
  --framework-tarball <existing-evolution-framework.tgz> \
  --install-policy <pnpm-install-policy.json> \
  --timeout-seconds 480
```

The input study directory uses the `verify-feedback-study.mjs` layout, containing `study/registration.json`, `study/study.sqlite`, and the original frozen inputs. The install policy file explicitly declares `{ "allowBuilds": { "package@exact-version": true } }`; approved packages and versions are determined by the actual installation environment; the script does not implicitly expand build permissions. Supporting packages are recorded with separate digests and are not passed off as G/H build products of this round.

Each installation context shares a single deadline (default 480 seconds) covering cold dependency installation and native assembly, with no per-command re-timing. The acceptance script, installer, and process management module each record digests; the process management module is mounted read-only, and the original study image, G/H tarballs, and scoring results remain unchanged. This entry point sends no model requests; candidate initialization is still actual code execution, with network and permissions constrained by the registered installation environment.

Identical original packages are deduplicated by content identity; different original registered Profiles, models, environments, and assembly entry points are verified separately. Results retain the full job list, unselected slots, per-package failures, and all original identities. After an installation failure, actual results for other packages are still recorded; any failed or incomplete delivery slot makes the overall `passed` false. Passing installation and assembly only proves this delivery path; quality gains are covered separately in the independent research report.

## Actual release decisions

- Version, repository visibility, release targets, and license remain explicit; public operations require project owner instruction. The current license is the repository's Apache-2.0, with third-party attributions retained in NOTICE.
- Release notes list changes, the accurate support matrix, independent acceptance entry points, and known limitations; research scores must cite the complete experimental record. Configuration, interface, and dependency upgrades state new contract requirements; historical experiments are not rewritten for compatibility.
- Installation packages, frozen candidates, source commits, runtime images, and research results are identified separately; a single version number cannot substitute for specific artifact identity.
- CI uploads unpublished build artifacts and has no registry write permission. Pass/fail is judged by the actual results of specific runs and commits, and original failure records are retained.

### How CI runs after going public

After formal publication, continue using this repository's standard GitHub-hosted Ubuntu/macOS runners. Standard runner usage for public repositories is free on GitHub and does not consume private-repository plan minutes; larger runners are still billed, and limits on runtime, concurrency, and storage must still be managed separately. Placing only a reusable workflow in a public repository and calling it from a private repository is still billed to the caller and does not solve private-repository quota issues. Sources: [Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions), [Reusable workflow billing](https://docs.github.com/en/actions/concepts/billing-and-usage#billing-for-reusable-workflows) (verified 2026-10-28).

Public CI verifies builds, types, native assembly, container protocols, and real package installation; model research requiring credentials is separately authorized and accounted for, and free runners do not cover third-party model API costs. Actual runs after the repository went public eliminated the original minute-quota block and exposed a workflow issue where macOS lacked Go, which has been explicitly installed at a pinned version; see [implementation status](completion.md) for specific matrix results.

Research basis: a colleague's repository [Publish workflow](https://github.com/XHToken/dsh-intelligent-router/blob/d762b8e8ebd9f07dcea34fe2da56202f9f727fe4/.github/workflows/publish.yaml) chains together build, test, tag version verification, and distribution. This project borrows the verifiable artifact chain and delivers build packages for review; its registry publish trigger was not enabled. The SBOM uses the [official npm command](https://docs.npmjs.com/cli/v12/commands/npm-sbom), and the lockfile loading and pre-build identification implementation of the installed npm 12.2.0 has been verified.
