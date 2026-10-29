# Contributing

Preserve the core ideas in [`11.md`](11.md). Explain which plugin mechanism a change affects, the evidence motivating it, and how it was independently validated.

English is the working language for documentation, comments, examples, interfaces, diagrams, and generated pages. The root `README.md` is the English entry point; `README.zh-CN.md` preserves the Chinese introduction and original core statements. Chinese text is limited to these two files. `npm run docs:check` enforces this convention and checks that the generated tour is current.

Translate documentation without changing claims, commands, versions, numerical results, or source links. Preserve raw experimental records and candidate patches byte-for-byte; keep historical source hashes tied to their original revisions. Update generated pages and translated heading links together, and inspect text embedded in images.

```bash
npm ci
npm run check
npm run test:install
docker build -t sparkvolve:test .
SPARKVOLVE_TEST_RUNTIME=runc SPARKVOLVE_TEST_DNS="${SPARKVOLVE_TEST_DNS:?Set approved reachable IPv4 DNS servers}" \
  SPARKVOLVE_TEST_IMAGE=$(docker image inspect sparkvolve:test --format '{{.Id}}') npm run test:container
```

- Use Node 24.16.0 and npm 12.2.0; native Bundle installation uses pnpm 12.15.0.
- The host requires Python 3 and support for Unix `os.open(..., dir_fd=...)`, `O_NOFOLLOW`, and `O_DIRECTORY`; evidence reading, directory listing, and frozen source files all go through this descriptor interface, and falling back to an implementation that validates the path before reading is prohibited. Install missing dependencies first; the container image already includes Python 3.
- TLS transport tests use OpenSSL to generate temporary test certificates; install OpenSSL first if missing. For real-model egress acceptance, see also [controlled-egress.md](docs/controlled-egress.md).
- For the DSH API, first verify the actually installed version and source code. New plugin capabilities are accepted through native Cordis registration, execution, and release.
- Changes to the experiment state machine must cover interruption, duplicate delivery, scoring recovery, failure denominator, and champion updates.
- New domains are integrated through input directories, task contracts, independent scoring images, and capability Bundles. Adding problem ID branches or answers in the framework is prohibited.
- Failure reports are retained; service anomalies and business failures are kept separate; checks must not be made to pass by resampling, downgrading the model, or modifying the judge.
- Unit tests, protocol fixtures, real-model closed loops, and independent quality experiments must be labeled separately. Submitting experimental conclusions requires the full denominator, versions, repetition counts, negative results, and cost.
- `test:install` packages, natively installs, and actually invokes the state tool in a temporary DSH Home; it uses a deterministic Provider to verify distribution and runtime wiring, and does not count as a model quality result.
- Before any paid model task, the spreadsheet image runs `verify-image.mjs` according to the [startup guide](docs/quick-start.md): actually generating XLSX, invoking the independent scoring script, and recalculating with LibreOffice; it only verifies basic runtime dependencies and does not access research problems or provide quality scores.
- Runtime artifacts, datasets, and keys are not committed. Before publishing, check authorization, licenses, sensitive information, and research evidence.

Dependency or runtime protocol upgrades migrate directly to an explicit new contract, and validation evidence is updated. The repository does not maintain compatibility layers for untested historical interfaces.
