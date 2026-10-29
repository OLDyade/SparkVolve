# Repository Presentation Review — 29 October 2026

The project thesis remains unchanged: **Evolve the Harness, Not the Model.** Plugins are evolution genes; evolution is a plugin; evolution results are plugins. The homepage should make that thesis inspectable through an actual mechanism and accessible through a real entry point.

## Decisions implemented

| Review signal | Implementation |
| --- | --- |
| A repository HTML link is not an online experience | Publish a static GitHub Pages tour with no account, model calls or credentials. Keep the earlier rejected experiment accessible. |
| A score curve does not show what evolved | Publish H0/H1/H2 source snapshots and complete patches. Verify their bytes against the existing mutation and installed-file records. |
| A short command can hide substantial prerequisites | Keep the two-command entry point; state Docker, runtime, credentials, network-pool, first-build and provider-cost requirements beside it. |
| The output taxonomy is hard to scan | Use three explicit assets: Capability Bundle, Evolution Lineage and Evidence Package, each with a concrete inspection or use path. |
| Domain generality can imply runtime portability | Explain replaceable task adapters and native DSH/Cordis integration separately. |
| Branding alone cannot establish repository quality | Add local-link and anchor validation, generated evidence checks and browser accessibility/interaction tests to CI. Repair the initialization reader/writer race exposed by container CI. |

We do not turn one positive run into a generalization or method-superiority claim. The source case includes known semantic counterexamples. The later comparison includes negative results and retained baselines. No new model evaluation is implied by rebuilding the tour.

## Sources and practical lessons

- [GEPA README, commit 80a62c8](https://github.com/gepa-ai/gepa/blob/80a62c879ecdeb8741faac72a844dceb1c18691f/README.md): make website, executable Quick Start and concrete examples independently discoverable. Its reported benefits belong to its own experiments; they provide no evidence for SparkVolve.
- [GitHub Pages custom workflows](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages): build a static artifact, deploy through the Pages environment, and keep deployment permissions scoped to the deploy job.
- [GitHub Pages REST API](https://docs.github.com/en/rest/pages/pages#create-a-github-pages-site): configure the repository for workflow-based Pages deployment. The site contains only an explicit public file list.
- [SQLite WAL concurrency](https://sqlite.org/wal.html): readers can hold a snapshot without blocking a writer's commit. The initialization database now uses WAL, matching the experiment store's concurrency model; competing writers still fail immediately.
- [Node.js 24 SQLite API](https://nodejs.org/docs/latest-v24.x/api/sqlite.html): transaction and timeout behavior must be tested at the real connection boundary.
- [remark parser](https://github.com/remarkjs/remark/tree/main/packages/remark-parse): parse Markdown references and headings structurally rather than interpreting code examples as links.
- [Playwright accessibility testing](https://playwright.dev/docs/accessibility-testing): automated accessibility scans supplement actual responsive and interaction checks; they do not prove universal accessibility.

## Verification boundary

The website is a presentation of committed experiment records. Its build checks source hashes, complete patch reconstruction, per-task means and denominators, and the selected archive's installed identity. These checks validate the presentation against those records; they do not independently reproduce model outcomes or turn private source hashes into public access to full trajectories.
