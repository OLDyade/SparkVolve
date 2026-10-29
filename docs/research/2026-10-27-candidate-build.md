# CandidateBuild: Giving the Tested Capability and the Distributed Capability the Same Identity

## Verification and Design

Previously, freezing the source, executing the source, and packaging separately at export time could not cover compiled languages, new runtime dependencies, and packaging differences. Now the candidate source identity and the artifact identity are recorded separately:

```text
Source / package-lock.json / fixed builder image
                  │
        isolated container npm ci → scripts.build → npm pack
                  │
           bundle.tgz + unpacked directory + receipt
                  │ content hash and read-only freeze
             ┌────┼─────────┬──────────┐
             ▼    ▼         ▼          ▼
          native QA  task execution  independent validation    original package export
                                      │
                              source → new draft continues mutation
```

The build container has no tasks, scoring materials, model credentials, or Docker socket. Network permissions, images, and timeouts are fixed by the experiment contract. The original source is read-only; a separate build working copy has write permissions restored. If installation or compilation fails, `build_failed` and the original logs are retained, no tasks are started, and no automatic retry occurs.

Native npm 12.2.0 was measured to have `npm pack --json` return an object indexed by package name. Dependencies are fixed via the v3 lock, and `npm ci` is executed; runtime dependencies are distributed with the package, and DSH host dependencies retain host ownership through peer declarations. The build artifact contains the compiler output, and QA and execution no longer read uncompiled source. Export copies the original tarball that was tested; independent validation also registers and uses the existing artifact, and rebuilding to replace the selected version is prohibited.

Interruption recovery uses the same named build container to collect the original output. The host independently verifies the source, lock, unpacked directory, tarball, and full artifact hash. Identity proves byte consistency, not that the build script's business logic is correct or that binaries are portable across systems; the target platform is constrained by the frozen image and independent installation acceptance.

## Official Sources

- [npm ci](https://docs.npmjs.com/cli/v12/commands/npm-ci/): fails directly when dependencies do not match the lock, and installation does not rewrite the lock; peers may retain resolution records without writing them to disk.
- [npm bundleDependencies](https://docs.npmjs.com/cli/v12/configuring-npm/package-json/#bundledependencies): runtime dependencies can be included in a single installation tarball; host peers and in-package runtime dependencies are kept separate.
- [AutoSaddler V2 pinned version](https://github.com/microsoft/AutoSaddler/tree/e841543ce6cf6bdf690e65134b12a829ec9f66d1): references the ideas of content addressing and recoverable experiments; this project uses the DSH native Bundle as the execution capability artifact.

## Acceptance Record

The first real container acceptance exposed the problem that the working copy inherited read-only permissions; the original failure logs are retained, and the copy permissions have been fixed. A read-only direction review found the identity drift risk of rebuilding during validation, and the validation arm protocol has been modified and re-reviewed and passed.

- 18 unit tests passed, including build failure terminal state, not entering QA/tasks, no duplicate builds, research archive retaining failures, and validation directly using the original artifact.
- 6 native DSH tests and 1 framework Bundle native installation test passed.
- The real container completed build → native assembly QA → two tasks → controller SIGKILL → collect original container → independent scoring → original package export; the exported tarball, Bundle, and source hashes matched item by item.
- An independent TypeScript candidate installed the locked `is-number@7.0.0` and development type dependencies and compiled; runtime dependencies entered the tarball and were installed and invoked successfully in a fresh, network-disabled, read-only container. Reuse of the original build container was verified, as was refusal to run after modifying the compiled artifact.
- The validation test set the source value to -1 and the selected artifact values to 0.25/0.75, and prohibited builder invocation; all eight paired runs consumed the selected artifact, and recovery produced no new executions.

This acceptance proves the build and delivery identity chain. Real model search, stable gains, joint mutation, and cross-domain conclusions are verified by their respective experiments and do not borrow scores from this protocol's fixtures.
