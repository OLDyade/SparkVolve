# Historical Experiment Tour · Local Design Conventions

Scope is limited to `tour.html` and the generator; does not change the project's core idea or `11.md`.

- **Readers and task**: Researchers visiting the project for the first time, who, without a key and without starting a model, understand how a real search produces mutations, accepts verdicts, independently re-verifies, and archives.
- **Mode**: Read. Users view mechanism summaries, per-question scores, and raw records along the candidate lineage, then proceed to the real run documentation.
- **Sources of truth**: `evidence/2026-10-27-continuous-acceptance.json` and `acceptance-continuous.md`. Titles and positioning retain the original sentences; scores, usage, candidate identities, and parent versions are all generated from the original records. This historical experiment uses public synthetic tasks; there is no conclusion of stable score improvement or topology search gains.
- **Visual inheritance**: Follows the existing `assets/experiment-results.svg` white background, dark blue body text, blue baseline, gray experimental versions, and rust-red regression expression. System fonts suit offline reading; monospace fonts are used only for identities, commands, and data.
- **Structure**: One selectable candidate lineage and one evidence reading area; below that, the full-denominator re-verification table and distribution entry point. Avoid card walls, fictional real-time animations, and decorations implying promotion.
- **Interaction**: Ordinary buttons select versions, arrow keys move along the version sequence; real per-question records can be expanded; original machine records can be downloaded offline. Links point to in-repository documents, with no remote resources or requests.
- **Mobile and accessibility**: Sequential reading on narrow screens; horizontally scrollable data tables are labeled and keyboard-focusable; clear focus, native details, and text states that do not rely on color.
- **Generation and acceptance**: A standard-library generator outputs a single-file HTML, records source file digests, and is repeatably generatable; batch checks on desktop and mobile for interaction, overflow, and no network requests.

The above product facts and structure come from an explicit task; the visual inheritance comes from existing repository charts. This time no new global product definition is created and no branding is changed.
