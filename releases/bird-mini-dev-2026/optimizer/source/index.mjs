/**
 * Evolution research method (G) for the continuous open-plugin H/G study.
 *
 * REVISION 24 (this source) adds TWO ACCOUNTING RULES that the host measured being
 * violated in this checkpoint's own proposals:
 *
 *   1. PARENT-RELATIVE GAIN. A candidate's `conditionalUpperBound` is now documented
 *      as parent-relative and must count ONLY tasks the parent FAILS. Candidate 55's
 *      frozen proposal named eight tasks as its repair target and then wrote
 *      "upper bound 173/180 if all eight recover" - but its own evidence said those
 *      eight ALREADY PASS under the parent, so preserving them is worth zero net gain
 *      and the true retention-only bound is the parent's 165/180. Inherited passes
 *      added to the parent's score is a double count, and it makes a retention
 *      experiment look like an improvement. Retained, currently-failing and
 *      unobserved tasks are now three separate buckets in the method text.
 *
 *   2. NO OVERCLAIMED MANIPULATION. Candidate 55's appendix was described as a
 *      "controlled position-only" intervention; it also changes length, repetition,
 *      salience and content pointers, so position is not isolated. The method now
 *      states that correspondence between a delivered artifact and an instruction
 *      supports a hypothesis and at most possible observed use, never causation, and
 *      that the SAME evidentiary bar applies to prompt, executable-tool,
 *      context/workflow, plugin-config and composition mechanisms alike - prose gets
 *      no weaker bar for being prose, and code gets no stronger bar for being code.
 *
 * Neither rule chooses a parent, a family or a target.
 *
 * REVISION 23 (this source) revises the SEARCH STRATEGY, not an instrument. The host
 * audited the actual development lineage and found that every recent H candidate was
 * a guidance edit from one parent, and that the method text carried hardcoded
 * LOCAL-SEARCH restrictions that contradict its own common-criteria paragraph:
 *
 *   - `predictedTarget` was documented as "The one task id the change is predicted to
 *     move", which encodes one-task local repairs as the only legal shape. It now
 *     accepts one id, several ids, or a named failure class with the expected ids.
 *   - a defect had to reproduce "across two unrelated databases" to be "the mechanism
 *     worth a candidate", which barred legitimate single-task evidence. A second
 *     database now bounds the generality of the claim; it does not gate the
 *     experiment.
 *   - "never spend a slot on a change you cannot attribute" demanded causal certainty
 *     the study cannot supply at this manifest's movement level, and stopped
 *     informative experiments that would SEPARATE explanations. A slot is now wasted
 *     only when the change cannot be described as an observed decision plus a
 *     checkable prediction. A candidate may also target a mechanism CLASS with
 *     several predicted movements, or recombine two mechanisms that were each
 *     measured separately - that is one candidate, not a quota violation.
 *
 * None of these changes prefers a family or a parent: prompt edits, executable
 * tools, workflow/context structure, plugin/config and reuse are all judged on the
 * same fields, the current family and parent stay fully eligible when they win that
 * comparison, and there is no forced breadth, no category quota, no innovation
 * reward and no presumed-safer option. The champion stays separate from the
 * exploration parent.
 *
 * REVISION 22 (this source) repairs TWO data-loss defects in `recordDecision` that
 * the host reproduced on revision 21's exact bytes, in isolated fixtures, without
 * touching a live decision:
 *
 *   1. OVERWRITING WHAT IT COULD NOT READ. The prior-record read was
 *      `try { prior = JSON.parse(readFileSync(target)) } catch { prior = null }`, so
 *      a CORRUPT file and an UNREADABLE file both looked like "no record yet", and
 *      the valid write that followed destroyed the existing bytes. Reproduced:
 *      existing `{malformed` -> successful write, malformedRejected=false,
 *      malformedPreserved=false. Now only ENOENT means absence: a parse failure, any
 *      other read error, or an existing root that is not a JSON object throws BEFORE
 *      any byte is written. This mirrors what the READER (`decisionState`) already
 *      did - it distinguished ENOENT from other read errors and rejected a
 *      non-object root - so the writer was the inconsistent half, not the contract.
 *
 *   2. DROPPING THE HISTORY IT HAD RETAINED. `priorDecisions` was assembled only
 *      inside `newDecision && prior`, so an ordinary correction of a record that had
 *      a retained history erased it (host measured 1 -> 0: submitted b, then
 *      newDecision=true, then correct the new decision). The same spread also nested
 *      `prior.priorDecisions` inside the appended entry, so successive explicit
 *      transitions duplicated every earlier decision one level deeper. History is now
 *      a flat list carried forward by EVERY write; an explicit transition appends one
 *      nested-stripped snapshot of the decision it supersedes.
 *
 *   3. A HEURISTIC IDENTITY DISCARDING A REAL DECISION, found by the host reviewing
 *      this revision's first draft and reproduced before handoff. Deduplicating
 *      retained entries by `recordedAt + falsifier` is not an identity: two different
 *      decisions can share both, and the current decision was dropped while only the
 *      earlier one survived (history 1 where 2 are expected). Dedup is removed; one
 *      complete flat snapshot is retained per explicit transition.
 *
 *   4. FILTERING AWAY INVALID HISTORY, same review. `priorDecisions: [null, <earlier>]`
 *      was silently filtered to `[<earlier>]` by an ordinary correction, i.e. the file
 *      was rewritten with evidence deleted. Any priorDecisions that is not an array of
 *      JSON objects now throws with the original bytes untouched.
 *
 *   5. NORMALISING HELD ENTRIES, same review, last one found. An ordinary correction
 *      mapped every held entry through the flattener, so an older decision that lived
 *      only inside a held entry's own `priorDecisions` was deleted (reproduced:
 *      nestedUniqueEvidencePreserved=false). Nothing proves a nested decision is
 *      duplicated at top level, so held entries are now carried VERBATIM; only the
 *      newly appended snapshot of the current record drops its own nested list,
 *      because that exact list is already carried one level up.
 *
 * Both are writer-side preservation, not selection policy: they choose no parent, no
 * family, no target, and an unrepaired writer that silently loses a decision is worse
 * than no record at all because the next session reads the loss as "nothing was
 * decided". `gtest/regressions.mjs` covers corruption, unreadable path, non-object
 * root, a legitimate correction, an explicit transition, and transition-then-
 * correction with the REAL validator (`decisionState`), on isolated fixture paths.
 *
 * REVISION 21 repaired ONE defect: revision 20's `recordDecision`
 * tool declared `output.schema` but not the `output.render` function that the
 * native registry REQUIRES, so the package failed real native load QA with
 * `tool "recordDecision" must declare output { schema, render, presentationMeta? }`
 * (dsh-tools/lib/index.js:2977) and never ran. Nothing about the tool's logic,
 * its schema, or the decision contract changed: the missing renderer is added, it
 * renders the reader's verdict, and it adds no field the schema does not declare.
 *
 * WHY IT GOT THROUGH, which is the transferable lesson. Revision 20 was verified
 * with `gtest/native-validate.mjs`, which imported the plugin and supplied a plain
 * object `{ tools: { register: (d) => ... } }` in place of the real service. That
 * sink recorded the definition and never ran `ToolRuntime.register`, so the one
 * precondition that failed was the one thing the test did not execute. Every other
 * instrument happened to declare render, so nothing else caught it. The repair
 * therefore has two halves: the missing function, and a test that uses the real
 * native services. `gtest/native-load.mjs` instantiates an actual `Context` with
 * the real `dsh-system-prompt` and `dsh-tools` services and applies the plugin
 * exactly as the loader does; `check-load.mjs` runs in the build and asserts the
 * same precondition, and both fail on a re-introduced defect and pass on the fix.
 *
 * REVISION 20 added no selection policy. It repaired two defects that this
 * checkpoint measured in the method's own instruments, both of which produced
 * WRONG EVIDENCE rather than merely awkward output:
 *
 *   1. perTaskSummary answered a comparison request for three UNKNOWN candidate
 *      identities (short prefixes) with plausible 0/180, net 0 rows, because an
 *      unknown digest reads as 'missing' for every task. Unknown, abbreviated or
 *      malformed identities are now rejected before any summary is built.
 *   2. The decision record's shape drifted three times in one session
 *      (parentReason vs parent_rationale, an array counter_evidence, free-text
 *      alternatives) while the author believed a decision was recorded. A
 *      `recordDecision` tool now writes the exact validated shape and refuses to
 *      write a record its own reader would call incomplete, and the root
 *      `falsifier` is the only falsifier field, written from the caller unchanged.
 *
 * Both changes make the instrument harder to fool, never easier to please: neither
 * chooses a parent, a family or a target, and neither can mark a wrong answer right.

 * REVISION 19 added ONE instrument and no selection policy.
 *
 * IT ALSO REPAIRS ONE DEFECT IN THAT INSTRUMENT, found by native review after the
 * first draft was written and before the handoff was accepted: perTaskSummary
 * counted a candidate's panel completeness with `stateOf(...) !== 'missing'`, which
 * counts queued/executing/scoring runs as observed. A candidate with one pass and
 * one executing task was therefore reported as a FULL panel, moving unobserved work
 * into the denominator - the exact error the method text forbids and the error the
 * tool exists to prevent. Completeness is now terminal-only, with pending and
 * missing reported as their own count (`pendingObservationCount`) and never as zero
 * quality. Verified against five synthetic fixtures (all-pending, mixed, one missing
 * task, all-terminal, terminal-failure) plus the live artifact, under the declared
 * output contract: fullPanelCount 1 (not 2) for the reported case.
 *
 * The instrument itself:
 * `perTaskSummary`, which answers three questions from a single spilled status file
 * that `matrix` and `searchMap` do not - the champion misses ranked by solve count
 * over the candidates that actually have a FULL panel, per-task gained/lost lists
 * for several named candidates at once, and the partial-panel coverage that makes
 * the raw solver count misleading. It selects nothing, scores nothing, re-runs
 * nothing, and returns no task answers.
 *
 * WHAT LICENSES IT (measured, not intended). In checkpoint 017 the optimizer asked
 * those three questions and answered them with ad-hoc python passes over the spill
 * twice in the first fifteen minutes: once to rank the 18 champion misses by
 * full-panel solve rate (which reorders them completely against the raw solver
 * count - bird-216 shows 43 raw solvers but 11 of 14 full panels, while the study
 * actually needs the second number) and once to build the gained/lost flip table of
 * seven recent candidates against the champion, which `matrix` cannot express
 * because it diffs one named candidate per call. That is the same class of defect
 * revision 9 removed for the aggregate: arithmetic the method should carry, being
 * re-derived by hand, with the denominator errors the method text itself warns
 * about (an unobserved outcome counted as a miss, a partial panel treated as a
 * smaller measurement of the same thing).
 *
 * REVISION 18 adds ONE measurable capability and no selection
 * policy: a decision-state record, /workspace/decision-state.json, which the
 * method reads back and reports through methodInstrument as complete, incomplete
 * or absent (with the missing field names), plus one METHOD_TEXT entry telling the
 * optimizer to write it before building and to resume from it after interruption.
 *
 * WHAT LICENSES IT (measured, not intended). In the checkpoint this revision
 * follows, the host intervened twice on the same defect: a session had already
 * obtained the searchMap/matrix/taskEvidence it needed, then spent its first
 * fifteen minutes re-deriving candidates, parents and miss lists and created TWO
 * byte-identical branches of the same parent (h47, then h48) while freezing
 * nothing. The failure was not missing evidence and not a wrong parent choice; it
 * was that no durable artifact said the decision had been made, so every resumed
 * stretch of turns restarted the survey. The record is deliberately minimal -
 * selected parent, mechanism family, predicted target, falsifier - and it encodes
 * no preferred parent, family, or quota, because that would be a selection policy
 * change this data does not license.
 *
 * The reader is exercised before shipping against ISOLATED fixtures under /tmp
 * (never the live author path): complete-submitted, submitted-with-minimal-metadata,
 * submitted-without-falsifier, complete-without-submission, incomplete-without-
 * submission, unreasoned alternatives, unparseable, non-object root,
 * permission-denied and missing. Measured results: submitted-minimal returns
 * lifecycle submitted, status incomplete, and a note that leads with ALREADY FROZEN
 * and forbids rebuild/resubmit while naming the metadata gap as a documentation
 * gap; complete-without-submission returns complete and instructs a build;
 * incomplete-without-submission warns and instructs a build; unparseable /
 * not-an-object / unreadable / absent each report their own status instead of
 * collapsing into absent; the 400-character falsifier survives intact.
 *
 * Two real defects were caught by that matrix and fixed before shipping:
 *   1. the declared parameter is decisionPath while the reader first read args.path,
 *      so every fixture silently fell back to the live path and the matrix proved
 *      nothing until path-honoured was asserted;
 *   2. a KNOWN SUBMISSION did not dominate action guidance - a record naming a
 *      frozen 64-hex candidate but missing metadata returned status incomplete with
 *      "Fill those ... then build", which would have instructed a rebuild of bytes
 *      the ledger already holds. Submission identity now dominates the note for
 *      both complete and incomplete records.
 *
 * The module namespace is verified by import rather than by reading: `apply`
 * registers all eight tools and the prompt section, and methodInstrument returns
 * revision 19. That is loadability evidence only; it says nothing about task
 * quality, which only submitted H candidates can measure.
 *
 * REVISION 17 (previous) repairs an OBSERVED implementation defect in the
 * instruments, not a change of research policy. The native searchMap call on the
 * complete 44-candidate / 7740-run development ledger failed the host tool gate
 * with "value is not lossless JSON". The gate is
 * ToolRuntime.createSuccessResult -> snapshotToolValue (own undefined member =
 * loss) -> validateJsonSchemaValue, so a single own property whose value is
 * `undefined` fails the ENTIRE tool call; JSON.stringify would have silently
 * dropped it and hidden the defect. Measured causes, each repaired at the object
 * construction and at the declared output schema:
 *
 *   - searchMap top level: medianOf([]) is undefined when no candidate beats the
 *     champion, so paceAboveChampion/paceBelowChampion were own `undefined`
 *     properties. The champion is the best observed score, so an empty
 *     above-champion group is the ORDINARY case.
 *   - searchMap recent rows: parentPass (baseline has no parent), netVsPrimary
 *     (unknown parent) and paceSeconds (fewer than 10 terminal runs) were own
 *     `undefined`.
 *   - pace: highestOrdinal was `undefined` for a ledger that carries no ordinals.
 *   - taskEvidence: a run record without an id or without a deliveryDigest
 *     produced own `undefined` for `run` and `delivery`.
 *
 * The representation rule is explicit and is NOT a generic strip: an absent
 * observation is JSON `null` where the schema declares a nullable scalar, and an
 * omitted optional key where the schema declares an object node that cannot take
 * null. Nothing is coerced to zero and no field is withdrawn silently. The
 * searchMap object additionally states how many candidates fell in each pace
 * group, so "no candidate above the champion" is readable as a measurement
 * rather than inferred from a null.
 *
 * Verification performed before shipping (node, against the installed packages):
 * @deepseek-ai/dsh-util-values snapshotJsonValue/isJsonValue,
 * @deepseek-ai/dsh-tools validateJsonSchemaValue/assertSupportedJsonSchema/
 * assertObjectJsonSchema, the plugin's real registered tool definitions, and the
 * real 44-candidate 7740-run development status. Cases: baseline without parent,
 * empty ledger, pending candidate, missing parent, sparse timing (<10 runs), the
 * full development ledger, plus every other registered tool (checkpoint, pace,
 * matrix, taskEvidence, mechanism failure path) through the same gate.
 *
 * Revision 13 is revision 12 with an EVIDENTIAL correction, not a selection
 * change, plus one implementation fix: the interrupted edit that carried
 * revision 13 also left a single-quoted METHOD_TEXT entry containing a bare
 * apostrophe, so `node --check` rejected the module and the file could not be
 * loaded at all. The header-comment boundary and that literal are repaired and
 * the module namespace is verified by import, not by reading the source. The
 * instrument now reports revision 13 rather than the stale 11 so the next
 * native trace's load evidence names the revision that is actually running.
 *
 * Load receipt (observed, not intended). Before the repair, `await
 * import('./index.mjs')` returned exactly {'apply'}: `name`, `inject`, the
 * import of `readFileSync`, START and METHOD_TEXT were all inside the comment,
 * so the native loader could not obtain `inject` and the package could not
 * bind systemPrompt or tools at all. After repairing the comment boundary and
 * the literal, the same import returns {'apply','inject','name'} with
 * inject = ['systemPrompt','tools'], and `node --check` passes. A native load
 * reproduction then booted the real `sdk` profile with this file mounted as a
 * patch entry and opened one Agent without a model turn: the composition audit
 * reported passed=true with 0 failed and 0 pending entries and no broken
 * presets, and the native harness-inventory lists all five instruments this
 * plugin registers (checkpoint, matrix, taskEvidence, mechanism,
 * methodInstrument) alongside the standard tool surface. That receipt is QA of
 * loadability only; it says nothing about task quality, which is measured by
 * submitted H candidates and nothing else. A host audit found four statements in revision 12 (and in the handoff
 * it wrote) that the development data do not support; this revision replaces
 * them with the weaker claims the artifacts actually license. Nothing here
 * prefers or bans a mutation family, and the selection criteria in METHOD_TEXT
 * are unchanged.
 *
 * (1) Revision 12 said one failure class was "measured to be unreachable by
 * text". What was measured: one end-turn guidance candidate settled 151/180
 * with execution_failed 5->4 and wrongs 16->25. That is a full-panel outcome of
 * one prompt candidate, not a category-level impossibility; it is equally
 * compatible with the sentence being unread, being overridden, or being acted on
 * only in some runs. (2) Revision 12 concluded that a killed-run artifact
 * therefore "licenses an executable repair, not another instruction" - a default
 * priority the data cannot support and one this method explicitly rejects.
 * Prompt, tool, workflow/context and configuration/composition proposals are
 * compared on the same fields, and the trace of the specific run decides what is
 * plausible, not the class the failure appears to belong to. (3) Revision 12
 * treated the 147-156 spread of seven single-sentence guidance candidates
 * against a 159 champion as a "measured band", calling a net move inside it
 * "unresolved". That range describes seven different candidates; it is not a
 * noise model, confidence interval or decision threshold. Each candidate's
 * actual full-denominator result is a real result and is reported as one.
 * (4) Revision 12 implied that a target-level flip proves the sentence caused
 * it. A flip with a matching delivered artifact is compatible with the
 * hypothesis and nothing more; attribution needs the counter-evidence and the
 * shared-failure check, and a single adaptive run never isolates a mechanism.
 *
 * Revision 12 is revision 11 plus two calibrations taken from checkpoint 009,
 * both folded into sentences that already existed rather than appended as new
 * bulk. (a) Isolated single-sentence guidance candidates have settled below the
 * 159 champion over the whole manifest (154, 149, 156, 156, 154, 147 and 149),
 * so a guidance edit can land net-negative even when its own target flips; each
 * of those numbers is a full-denominator result on the same manifest and is
 * reported as one, without treating the spread as a noise bound. (b) In
 * checkpoint 009 both isolated sentences produced their predicted byte-visible
 * repair on their own target (a count-distinct rule flipped its task; its "each
 * printing counts" canary held). That shows the sentence reached the executor's
 * decision in those runs; it does not establish that the sentence caused the
 * flip, and the three numbers (target flipped / tasks gained / tasks lost) are
 * reported separately. Revision 12 adds no new tool, no new step and no family
 * preference.
 */

import { readFileSync, writeFileSync } from 'node:fs';

/**
 * Revision 14 is revision 13 plus one instrument, added because revision 13's
 * pacing rule was prose the optimizer could only obey by remembering to look.
 * Measured in the checkpoint-012 session: the method's text told the optimizer to
 * submit inside the first fifteen minutes, and the first frozen candidate
 * (ordinal 36, 21e515cd) was admitted at 1112 s elapsed; a host intervention
 * (host-checkpoint012-analysis-stall-20261105T161800Z) fired before it because two
 * qualified checks saw no new frozen candidate. `checkpoint` existed and reported
 * elapsed time, but nothing in it distinguished "still analysing" from "already
 * frozen something", so the failure was invisible to the instrument that was
 * supposed to prevent it.
 *
 * The `pace` instrument reads the same session clock and asks the executor-side
 * ledger for the three facts the pacing rule actually branches on: seconds
 * elapsed, the current checkpoint's candidate cap, and whether the newest
 * candidate is this session's submission. It does not submit, freeze, score or
 * choose; it reports, and its reading is the falsifiable record that a later
 * session can compare against its own submission time. If the ledger cannot be
 * read it says so rather than inventing zeros.
 */

/**
 * Revision 16 is revision 15 plus one instrument and the prose that binds its use.
 * It is written in response to a measured QUALITY plateau, and it confines itself
 * to claims the frozen ledger supports.
 *
 * What the carried artifact shows, and nothing more: the champion f9945cc0 settled
 * at 161/180 with 18 wrong and 1 execution_failed. Over the same manifest, some
 * tasks the champion misses are passed by other candidates, and 179 of 180 tasks
 * are passed by at least one candidate. The second number is a record of what has
 * been OBSERVED separately by different candidates. It is not proof that a single
 * harness can pass all of them at once - no candidate has - and it is not a
 * promise that the remaining misses are reachable by any particular mechanism.
 *
 * Revision 15 could not report which parent or which claim the study kept choosing:
 * `matrix` compares the champion with one candidate and `taskEvidence` routes one
 * task to its bytes, but neither describes the search itself. Consecutive
 * candidates that all name the same primary parent are then easy to read as
 * independent experiments. `searchMap` reports, per candidate, every recorded
 * parent, the exact recorded claim, the relationship to the CURRENT champion, a
 * diff against its own primary parent over settled tasks only, and measured run
 * duration; and it derives parent concentration, the pace-versus-quality split,
 * the reachability union, and the tasks that are genuinely unresolved because some
 * outcome is not observed. It reports and never selects.
 *
 * Two boundaries are load-bearing and are enforced in the code, not just stated:
 * an unfinished run is neither a pass nor a miss, so it is excluded from every
 * comparison and reported separately; and lineage is a relation to the current
 * champion, never a reconstruction of which candidate was incumbent back then.
 *
 * The prose change sits inside the existing scheduling paragraph. A tool without a
 * rule for when to call it repeats the defect revision 14 documented for
 * `checkpoint`.
 */

const START = Date.now();

export const name = 'evolution-research-method';
export const inject = ['systemPrompt', 'tools'];

const METHOD_TEXT = [
  'Evolve the Harness, Not the Model.',
  'Read evolution_status first, including the frozen hostSearchProtocol. Choose mechanisms from the authorized evidence. full feedback exposes task execution traces, deliveries and scores; mechanical feedback exposes public inputs, source, build and native assembly results only. Missing execution feedback in mechanical mode is intentional. Do not seek excluded data through another route or assume it means failure. evolution_status carries the whole run ledger and may be spilled to a file; parse that file with python once instead of re-printing it.',
  'Write the decision down before you build it, and resume from it after any interruption. /workspace/decision-state.json is a small JSON record the method reads back: selected.parent, selected.mechanism_family, selected.predicted_moves.target and falsifier. methodInstrument reports its status as complete, incomplete or absent. This is not bookkeeping: in this study two native sessions burned their first fifteen minutes - and one created two byte-identical branches of the same parent - while the needed evidence (searchMap, matrix, taskEvidence) had already been obtained, because nothing durable said the decision had been made. So: once the mechanism slate is recorded, write the decision record, then branch and build. If a session resumes, read that record first; a complete record means build, not re-survey. It deliberately encodes no preferred parent, family or quota - only that a choice was made, on what evidence, with what falsifier.',
  'Write the record WITH the recordDecision tool, not by hand. It emits the exact shape methodInstrument validates and refuses to write a record that validator would call incomplete, so a shape mistake cannot look like a decision. It chooses nothing: parent, family, target, evidence and falsifier all come from you, and the falsifier it writes is the only falsifier - there is no nested copy to go stale. If you do hand-write the record, its root-level falsifier is the field the reader uses; a nested selected.falsifier is ignored.',
  'Separate the OBSERVATION from the ATTRIBUTION, in the record and in the log, because the record is what the next session reads first. An artifact that changed is compatible with an instruction being used; an artifact that did not change is an observable failed prediction for that candidate, not proof that the instruction was unread. A target that flipped, a canary that regressed and a panel that moved are three separate observations about one candidate, and none of them establishes that a particular sentence caused the movement. One negative result never establishes that a whole failure class is unreachable by that mechanism family. Only direct trace evidence can support that the executor used an instruction, and even observed use does not establish a causal effect on the settled count.',
  'Price an alternative by its concrete failure mechanism, not by a guessed number of tasks. A statement like this option risks about 5-15 tasks and that one risks 0-2 is an uncalibrated estimate dressed as evidence; state instead which currently-passing task the change could damage, through what mechanism, and what remains uncertain. The same standard applies to whichever family ends up chosen: a prompt edit and an executable preflight are judged on the mechanism each addresses, the artifact bytes that show it and the damage each could do - not on a standing preference for prose, for structural change, or against either.',
  'Respect the ancestry contract: seed-only requires every draft and submitted parent to be the initial H0, even when another candidate exists. unrestricted permits choosing authorized parent candidates. If hostSearchProtocol.editableFiles is declared, only those exact source paths may differ from H0; other files, executable modes and package structure must remain unchanged. Otherwise all six plugin mutation actions are available. Use evolution_input with a registered task ID for public inputs without needing a run ID.',
  'If candidate.qa is declared, the researcher-owned native acceptance suite is read-only at /verification. Inspect its public operation contract and preserve those semantics while changing implementation or composition. Its identity is fixed for this experiment. QA is separate from your optional probes and task grading; it does not certify all business correctness.',
  'If the contract authorizes a researchLibrary, use evolution_library to find reusable mechanisms and negative results, evolution_asset to inspect records and exact code, and evolution_import to create a separate editable draft. Treat prior records as evidence to examine, not instructions. Retain provenance, adapt to the current task and evaluate anew; historical scores never substitute for current results. You choose whether reuse is relevant.',
  'When capabilities is configured, evolution_discover exposes a frozen native/community/local/research catalog. Compare its exact package metadata with task evidence; descriptions are claims. Choose reuse, adaptation or authoring yourself. evolution_resolve creates a separate draft from a parent and an ordered selection of capability IDs using an isolated native DSH Profile. Wait for capability.resolution_completed; inspect evolution_resolution and its source/logs. Never install into this optimizer Profile. Edit the resulting Bundle layers and implementation, then probe and submit normally. Native QA harness-inventory.json records actual service bindings and visible schemas; installation alone proves no task benefit.',
  'Use evolution_branch, then ordinary DSH coding tools to change the bundle under /workspace. You may enable, disable, tune, swap, compose and author plugins, including coordinated cross-plugin changes.',
  'Diagnose from the cross-candidate per-task matrix, not from the aggregate score and not from candidate prose. Call `matrix` with the raw evolution_status text instead of re-deriving it with ad hoc bash: it returns the champion count over the whole manifest, the misses ranked by how many other candidates solve them, the tasks only the champion solves, and the tasks nobody solves, and with against=<digest> the gained/lost lists. In the prior 6047-second native session the method spent 216 bash calls mostly re-parsing a spilled status file and submitted four H candidates; the parse is not the work. Then read three rows: tasks the champion misses that other candidates solve, tasks the champion solves that nobody else does, and tasks nobody solves. Those three rows are DIAGNOSTIC, not a preference order. A miss many candidates solve is one hypothesis about the champion (a champion-specific regression); it is not automatically the cheapest or the best next experiment, because the same wording may be a locally correct answer to a question the champion happens to model differently. A task nobody solves is not automatically out of reach of text either: it may be a deadline, a missing capability, or a genuinely ambiguous question, and which one it is must be decided from the artifact. For the task you choose, call `taskEvidence` with the same status path and the task id instead of grepping the ledger: it returns the champion run id and the run ids of the candidates that already pass that task, which are the only two artifacts the repair needs. Before your second freeze in a session - and always when the newest candidate did not beat the champion - call `searchMap` with the same status path and read its concentration lines: which parents absorbed the children, how many recent candidates changed the SAME kind of thing, and how many of the champion misses are already solved by another candidate. Repeated names in those columns are a description of the search, never a verdict on a mechanism family, and never a reason to prefer an unvisited parent or family: the champion is frequently the right parent for a repair of a champion regression. What the map is for is making the comparison explicit. On a plateau, enumerate the plausible next experiments under the SAME evidence standards the `mechanism` slate already requires - keeping the current parent and the current mechanism fully eligible - and pick the one whose expected correctness gain and expected information are best supported by the artifacts. If the best-supported experiment happens to be another edit of the champion, that is a conclusion reached by the criteria, not a default; if it is a different parent, a different class of change, or a combination of two changes measured separately, that conclusion needs the same support. A different parent is never required for legitimacy, and an unvisited mechanism class is never automatically better than an exploited one.',
  'When you need the miss list ranked by candidates that actually finished the whole manifest, or the gained/lost lists of SEVERAL recent candidates at once, call `perTaskSummary` on the same status path instead of writing python over the spill: it reports the champion misses with both the full-panel pass count and the raw solver count, the per-task gains and losses for up to eight named candidates, and how many candidates have only a partial panel. Prefer the full-panel number when deciding how reachable a miss is, because the raw solver count divides by candidates that observed only part of the manifest - a task solved by 11 of 14 full panels is not more reachable than one solved by 1 of 14 because 43 partial records also pass it. Neither number selects the experiment; they bound how much of the study has already solved it.',
  'Count only settled runs, on the full task denominator. evolution_status returns the live ledger including runs that are queued, executing or scoring, so a pass rate computed from it mid-flight understates the candidate and must never be quoted as a result or used to size a comparison. Wait for candidate.decision or candidate.settled for that exact digest, then recount. Report passes over the whole manifest (for example 148/180), and report execution_failed separately from zero-scored runs: a run killed at the wall clock and a run that delivered a wrong answer are different defects and lead to different repairs.',
  'Separate the measured outcome from the causal explanation, in the proposal and in the log. "148/180, ten tasks gained and nine lost against the champion on the same manifest" is a measurement. "The added rules caused the gains" is a hypothesis. Neither one adaptive run nor a paired task diff isolates a mechanism, because several rules change at once and this manifest reshuffles ten or more tasks between neighbouring candidates. Do not turn a cross-candidate spread into a noise model: seven single-sentence guidance candidates on this manifest have settled at 154, 149, 156, 156, 154, 147 and 149 against a 159 champion, and each of those is a full-denominator result on the same task set, not a sample from a distribution and not a threshold. The two most recent isolated sentences each produced their predicted byte-visible repair on their own target (bird-067 count-distinct 16->8; bird-072 canary held) while still landing net-negative from 15-20 other task movements. A flip with a matching delivered artifact is therefore COMPATIBLE with the sentence having reached the executor\'s decision and nothing more: it does not establish that the sentence caused the flip, and it says nothing about the net panel. Report the three numbers separately (target flipped / tasks gained / tasks lost) and state what would falsify the attribution; when the counter-evidence is as strong as the support, the result stays unresolved - not because it falls inside a range, but because the experiment did not separate the two explanations. Prefer the next candidate that distinguishes the two live explanations over one that adds a third.',
  'Read the delivered artifact for the specific task you are repairing: evolution_evidence and evolution_materialize give the exact answer.sql the candidate wrote, and the task prompt in the frozen manifest gives the question and the schema. Name the defect in those bytes (a literal never checked against the stored scale, a denominator taken from the already-filtered set, an aggregate over joined rows, an extra projected column). Naming the defect is what licenses an experiment; the SIZE of the change is chosen later, inside whichever mechanism the slate selects, and a defect visible only in bytes does not by itself imply the repair is prose. A hypothesis you cannot point at in a delivered artifact is speculation; do not spend a candidate on it.',
  'COUNT GAIN RELATIVE TO THE PARENT, IN THREE SEPARATE BUCKETS. A candidate branched from a parent inherits that parent\'s passes, so a task the parent already passes contributes ZERO net gain no matter how many candidates once lost it. Report (a) RETAINED correct tasks, (b) currently-FAILING tasks the change could flip, and (c) unobserved tasks, as three distinct numbers. Restoring a task that a rejected sibling had lost is retention, not improvement over the selected parent, and an upper bound that adds inherited passes to the parent\'s score double counts them. Recompute gained/lost sets from COMPLETE TERMINAL records only; a partially observed panel is neither a pass nor a loss. AND DO NOT OVERCLAIM THE MANIPULATION. A prompt appendix that adds a checklist changes LENGTH, REPETITION, SALIENCE and CONTENT POINTERS at once, so it is not a controlled test of position; a tool change alters what is callable and also what is prompted; a composition change alters both. Correspondence between a delivered artifact and an instruction supports a hypothesis about which decision was made and at most possible observed use. It does not establish that the instruction caused the movement, and the same standard applies to prompt, executable-tool, context/workflow, plugin-config and composition mechanisms alike - none of them gets a weaker or stronger evidentiary bar for being prose or code. ',
  'Reproduce before you generalise, and bound the reproduction. The read-only task databases are mounted for you at the same paths the executor used, so for a missed task run the candidate SQL and the repaired SQL under python3 sqlite3 and print both results: a defect is confirmed when the two differ and the surface (a value repeated per joined row, a denominator taken from the filtered set, a sentinel label counted as a category, a rank applied after the filter) is visible in the stored values. Query the stored distinct values of the column the wording names before writing a rule about it. A defect that reproduces across two unrelated databases is stronger evidence of a mechanism than one seen in a single task, but a single-task reproduction is still a legitimate target when the delivered bytes name the wrong decision and the repair is checkable: the number of databases bounds how general the claim is, it does not gate whether the experiment may run. A candidate MAY address a mechanism or failure CLASS (several predicted task movements, one coherent rule) rather than exactly one task; state which tasks you predict will move and which will not, and treat a partial flip as a result about scope, not as a failed candidate. Never put a database value or an answer into the guidance: the executor earns its answer, you only learn which decision was wrong. Put a hard timeout on every comparison (python signal.alarm or timeout(1), 60-90 s per statement) and never run an open-ended fetchall against an unindexed LIKE or a large cross join: the same statement can finish in 0.03 s in one form and fail to terminate in another, and the executor has a wall clock too. If the bound trips, that is itself a finding - a query shape that does not settle is a deadline risk for the executor - but it is not a defect provenance for a guidance rule, so record it and do not let it consume the checkpoint.',
  'Replace, do not only append. Before adding guidance, find the sentence that already covers that decision and make it checkable, or delete it. Every added rule must name the tasks it repairs and the cost it may impose (confirmation queries, longer text). Track the prompt size you ship; a text that grew every round without a matching gain is evidence the growth is inert. Deleting a rule that explains an earlier measured gain requires the same evidence as adding one.',
  'A new sentence can be worse than no sentence, and this study has already paid for that twice. Before shipping a rule, test the instruction it encodes as SQL against the stored values on the tasks it is meant to repair AND on a task the current champion already passes that has the same shape: in checkpoint 005 a rule telling the model to rank the numeric subset fixed one card_games task and a later rewording of the same rule to map non-numeric values to an extreme silently broke two others, at a cost of about fifteen tasks. A rule whose two candidate phrasings give different answers on the same stored data is not ready; write the conditional form or leave the text alone. State in the proposal which already-passing task the new sentence could damage, and check it after the run. Two sentences in ONE candidate are not one mechanism: in checkpoint 008 a two-sentence candidate settled 154/180 (9 gained, 15 lost) against a 159 champion, and separating them afterwards showed one sentence had produced the predicted byte-visible repair on its own target while the other was inert on ITS target and had re-routed a task that the proposal had explicitly cleared - the cleared task delivered SQL that moved a measured-value filter inside a ROW_NUMBER() subquery, changing 1 to 11 on the stored rows, which is exactly the shape the second sentence prescribed and the opposite of what the pre-existing conditional rule required. So when a candidate contains two independent rules, either ship them separately, or state for each sentence the passing task it touches and which existing rule it could contradict; a sentence that conflicts with an established conditional rule loses to that rule, and the conflict is decided by executing both forms, not by which sentence is newer. An ABLATION IS NOT A CAUSAL TEST, and this study has now paid for that too: a two-clause candidate settled 159/180 (10 gained, 16 lost) against a 165 champion with BOTH declared targets flipping in the delivered bytes. Re-shipping one clause from the same parent was then described as separating which half caused the losses. It is not. A single-clause run produces evidence COMPATIBLE with that clause being responsible for a movement; sampling, the interaction between the two clauses, and ordinary drift between runs remain live explanations, and this manifest has measured 15-20 task movements between neighbouring candidates. So when you separate a confounded candidate: (a) write compatible-with, never caused, in the proposal, the falsifier and the log; (b) state the attribution as UNRESOLVED and name only genuinely distinct follow-ups - a different mechanism, a different source hypothesis, a scoped and unscoped form of the SAME sentence as two separate candidates, or a bounded reinterpretation of evidence you already hold. Do NOT propose re-running the same clause on the same parent, or any candidate whose bytes reproduce an already frozen one: an identical frozen candidate, task and stage observation must never be executed again in this study, and varying irrelevant bytes to evade that identity is not an experiment. (c) never describe the separation as a verdict on which clause was harmful, and never let a later candidate silently contradict an earlier mechanism claim without recording the contradiction in the search log. A target flip whose delivered artifact matches the instruction shows the instruction was COMPATIBLE with the delivered change; only direct evidence that the executor used that instruction supports a claim of observed use, and even observed use does not establish a causal effect on score, because the same run carries sampling, ordering and the movement of every other task. Distinct adaptive variants do not establish causality by themselves, and any genuinely independent acceptance test must be preregistered on disjoint data by the host and is never something you construct. For a failure whose artifact is a killed run rather than a wrong answer, read the delivered trace of that specific run before writing any rule, and treat the mechanism as open until you have: a sentence telling the executor to end its turn immediately after the answer executes settled 151/180 with execution_failed only 5->4 and wrongs 16->25. That full-panel result is evidence about one instruction under one harness lifecycle; it is compatible with the sentence being unread, being overridden by the injected runtime-context step, or being acted on only by some runs, and it does not establish that this failure class is unreachable by text. Decide from the trace whether the model ever reached the instruction: if it did, a prompt candidate is legitimate and may be cheaper than code; if it did not, an executable change (a tool bound, a preflight, a composition change) is the option whose premise matches the artifact. Neither outcome settles the family question: a statement that executes can still be wrong, so a validator or a workflow change is judged by whether it can see the specific wrongness, not by whether writes are failing. Choose between them on the same slate fields as every other family - the trace decides feasibility, not a class-level rule.',
  'Submit early and often, on a schedule you commit to before collecting evidence. Call `pace` with the status path before you start reading evidence and again before you would begin another evidence round: if the highest ordinal is unchanged from session start, this session has frozen nothing and further reads are not an experiment - branch the parent your evidence actually justifies, make the smallest falsifiable change you already have evidence for, and submit it. If the evidence justifies a coherent RECOMBINATION of two mechanisms that were measured separately, that is one candidate, not a quota violation: name each component, the observed decision it addresses, and the previously-frozen digest that measured it. Always re-read evolution_status to a NEW spill file after a candidate settles, and point `pace`, `matrix`, `taskEvidence` and `searchMap` at that fresh path: a stale spill repeats the state the previous decision was made on and cannot show the candidate you just froze. A development phase that ends without a frozen candidate has produced nothing. Put the first submission of a checkpoint inside the first fifteen minutes of the session (the host qualified checks fire at roughly 12-15 minutes when nothing is frozen), and in every checkpoint spend no more than about twenty-five percent of the session collecting evidence before the first freeze: branch the parent the evidence justifies, make the falsifiable change the evidence supports (one mechanism, or a recombination whose parts were each measured), submit, and only then keep reading. The parent is an experimental choice like the mechanism: the parent whose measured regression you are repairing, a historical parent whose behaviour you are repairing, or a combination the artifacts support are all eligible, and stating which one you chose and why is part of the proposal. A development phase that ends without a frozen candidate has produced nothing, so treat the first freeze as the minimum deliverable of the session, not an aspiration. When the checkpoint caps candidates (for example sixteen including carried ones), reserve at least two of the remaining slots for the end of the checkpoint, so the last measured surprise can still be repaired. Never resample unchanged candidate bytes. Do not require CERTAINTY of causality before running an informative experiment: an experiment that would separate two live explanations is worth a slot even when the outcome may remain unresolved. A slot is wasted only when the change cannot be DESCRIBED in terms of an observed decision and a checkable prediction. Two headings govern the rest of the checkpoint. PACE IS NOT QUALITY: a candidate that delivered faster, that removed execution_failed runs, or that settled without a build failure has not thereby improved the executor; the quality number is the settled pass count over the whole manifest, and both are reported separately in the proposal and the log. Treat a deadline repair as a capability the executor may use, with its own falsifier and its own regression surface, and do not credit it with task gains that other changes in the same candidate could have produced. PARENT AND MECHANISM ARE CHOSEN, NOT INHERITED: the proposal names the parent it branches from and the reason that parent is the informative one - a measured regression of that parent, a mechanism the experiment can separate on it, or an artifact that only that line has. Editing the current champion is eligible and often right; it is not a default that survives without a reason, and neither is a different parent. The searchMap lineage line reports the relation to the CURRENT champion and its primary parent, which is what makes an inherited choice visible; the tool names a relationship, it does not recommend one. A different parent is not required for legitimacy and neither is a smaller diff: the choice is about which explanation the experiment separates, recorded on the same slate fields as every other option.',
  'Use the native authoring support: cordis_inspect_list discovers exact query methods, cordis_inspect_query exposes coding contracts, and skill loads the original cordis-plugin-development / editing-cordis-compositions references on demand. Follow their packageDir and reference paths to inspect the installed implementation and type declarations. These are G authoring APIs; use native candidate QA and probes to verify H. Research uncertain APIs before implementing. Select the size of a change from evidence, not from a fixed list of mutations.',
  'Measure with an instrument that exists. This method registers `checkpoint` and `methodInstrument` through the native `tools` service, which this plugin declares as a hard dependency; call `methodInstrument` once per session and confirm its injected list contains both systemPrompt and tools. If a tool you rely on cannot be resolved, that is a defect to report, not a capability you have. Report it once with the failing call and continue with the tools that do resolve; a controller-side schema rejection of an unrelated field is a host defect, not a reason to change H or G. Never claim an instrument exists because the source intends to register it: the native harness-inventory is the arbiter. When you author a tool yourself, follow the installed DSL: ctx.tools.register() validates the RAW compiled schema (parameters as an object root with type, properties and additionalProperties:false; output.schema as raw nodes with an object-level required array and no per-property required marker), while defineTool() accepts the per-property form and compiles it. A schema the authoring API rejects fails the native load: that is a real defect, not a cosmetic one. Assert the registered tool appears in the inventory. A FIXTURE HARNESS THAT STUBS THE TOOL REGISTRY DOES NOT TEST LOAD: this method shipped a tool whose output omitted the `render` function the native registry requires, its isolated fixture tests all passed because they replaced `tools.register` with a sink that never ran the precondition, and the package then failed real native load QA with `tool "recordDecision" must declare output { schema, render, presentationMeta? }` - so a package can look tested while it cannot load at all. Before proposing a G revision, apply the plugin to the REAL native services (a live Context with the actual systemPrompt and tools services) and assert each registered tool carries output.schema, a callable output.render and parameters; then execute the read-only instruments through that dispatcher and validate their returns against their own output schemas. Do not infer timing from evolution_wait timeouts, empty pages or shell timestamps, and never record a duration you did not observe.',
  'Read what the executor actually receives before reasoning about the harness. Materialize one champion run trace and inspect the delivered system message, the tool schemas and the runtime-context updates; a claim about prompt order, injected guidance or available tools must come from that artifact rather than from the repository description. The same inspection shows whether a defect is an interpretation error or a missing capability. One artifact is enough: do not re-materialize a trace you have already read.',
  'CHOOSE THE MECHANISM BEFORE THE EDIT, and use the same criteria for every family (prompt/guidance text, executable tool or validator, workflow or context organisation, plugin/config, and reuse of a native or library capability). Do not carry a standing preference for prose edits, for the smallest diff, or for the miss that the most other candidates happen to solve; and do not carry a standing preference for structural change either. Record the slate with the `mechanism` tool before you build: it requires every option to name its mechanism, evidence, counter-evidence, uncertainty, expected correctness, regression surface, what it distinguishes, an explicit feasibility of true/false/unknown with a reason, and a selected-or-deferred disposition with a reason when deferred, and it flags any option whose shared-failure check is unstated. It does not reward breadth: a one-family slate is legitimate when the alternatives were considered and deferred with reasons, so record what you rejected rather than padding the slate to look balanced. For each plausible option, state: the observed failure mechanism it addresses and the artifact bytes that show it; supporting and counter evidence, including whether the same failure reproduces on a task the champion already passes; uncertainty; expected correctness impact; the regression surface (which currently-passing tasks it could damage and why); runtime feasibility under the frozen limits; and what the experiment would distinguish that its rivals would not. Then choose among the options by weighing expected correctness impact against expected information TOGETHER, under the shared risk and runtime criteria above, and say why the others were deferred - not a category quota, not a novelty bonus, not an automatic ban on a family after two failures, and not an exclusive preference for the option that would only teach the most. An option that is likely to improve the score with modest information and one that is unlikely to improve it but would settle a live question are both legitimate; state which trade you are making rather than applying either rule automatically. Minimality applies AFTER the mechanism is chosen: within the chosen mechanism, make the smallest change that tests the hypothesis. Two prompt candidates landing 154 and 149 after 159, with nearly disjoint loss sets, is evidence that one adaptive run does not attribute a sentence to a task movement; it is not evidence that prose is the wrong family, and it is not evidence that code is the right one. A structural defect that recurs across unrelated databases in delivered SQL (an output-contract violation, a truncation, a refused write) is a candidate for an executable composition change — a tool, a preflight, a validator — rather than for more instructions. Before authoring one, confirm against the native Service and Tool contracts what the executor can actually call, keep the change inside the Bundle the contract allows you to edit, and state which plugin and file it occupies. If the best-supported option on the slate happens to be a guidance edit, that is a conclusion reached by the criteria above, not a default to fall back on; state which rival mechanisms were rejected and on what evidence. An exit code alone does not classify a failure. A run that ends with exit 137 may be a deadline kill, an OOM kill, or an upstream stop, and those imply different repairs, so read the receipts for that run - its elapsed time against the task limit, the memory limit, the tool call in flight, and any recorded upstreamFailure - before naming a mechanism. A kill shortly before the wall clock with a large or unindexed query in flight is consistent with a deadline; a kill well before it with a materialized result set is consistent with memory; a provider, quota or transport record is neither and interrupts the comparison instead.',
  'Use evolution_candidate for exact source files and QA logs. Use evolution_evidence for authorized execution artifacts only when the feedback contract permits it. Record the evidence actually available, a falsifiable mechanism hypothesis and expected behavior when submitting; never invent scores or observations.',
  'For local inspection of an inventoried evidence file, evolution_materialize exposes the exact bytes at a read-only /evidence path with SHA-256 and provenance. Native file, shell and format tools can use that path directly; avoid transcribing binary base64 through model output. Materialize by exact area and file name as listed; a path you invent is not authorized evidence. Probe and QA identity are references, not quality.',
  'When probes are authorized, evolution_probe tests a draft in the real native profile before spending a scored candidate. Write a separate ES module exporting async probe({agent, ctx, call, observe, workspace}); await observe(label,jsonValue) records explicit service/scope/lifecycle values before assertions; it does not assert correctness. call(name,args) runs the actual tool and returns a ToolResult object: inspect isError and content blocks; do not JSON.parse the object. Parse a text block only if its tool documents JSON output. suite names a directory under /workspace and entry is a literal module filename within it, without #probe. Execution has a new empty workspace, not this optimizer workspace; suite fixtures resolve relative to import.meta.url. Derive boundary expectations independently of the implementation, use node:assert/strict, and keep synthetic fixtures separate from the draft. Probe results remain optimizer-authored evidence; they do not certify business correctness. Use the same suite across changed drafts to test a repair. Inspect evolution_probe_evidence after probe.completed, retain counterexamples and reference probe identity in the proposal. You choose which mechanism, service or plugin interaction to test; no fixed mutation strategy is imposed.',
  'Candidate sources must include a native Bundle manifest, package-lock.json v3 and scripts.build. Update the lock when changing dependencies. The contracted builder runs npm ci and build, bundles runtime dependencies, and freezes the exact package used for QA, tasks and export. Inspect build logs for build_failed candidates; no task ran for those candidates.',
  'The controller owns fixed models, evaluator, task manifest, isolation, budgets and selection. Never embed task answers, access evaluation-private data, or modify these boundaries.',
  'Structured upstreamFailure records identify provider availability, quota, authentication, transport or server failures. They interrupt the experiment and invalidate candidate quality comparison; do not mutate the Harness to compensate, reinterpret them as task-quality evidence, change the provider contract, or retry the experiment. Ordinary task, formula and tool failures remain eligible evidence.',
  'After submitting, read evolution_status once and pass its cursor to evolution_wait. Continue from each returned cursor; drain hasMore pages. A timeout changes no task state. A full 180-task panel takes minutes, not seconds: between waits do work that does not depend on the result (read the delivered answer.sql of a missed task, reproduce a defect against the mounted database), and wait again only when that work is finished. The prior native session made 120 evolution_wait calls with a 13-second median spacing and 17 empty timeouts; that is polling and it bought nothing. full feedback emits candidate.decision; mechanical emits candidate.settled without a quality outcome. Either event means evaluation has settled. If screening is declared, candidate.screened with passed=false also settles that candidate; unexecuted remainder is unobserved, not zero-valued. A passed screen is intermediate: wait for the full candidate.decision. After a settled candidate or a failed build/QA, read status and the authorized evidence for the next decision. Distinguish runtime defects, business errors and unsupported assumptions; settled alone proves none of them. A tie is a legitimate negative result.',
  'Keep the attribution you paid for. At the start of a checkpoint read /workspace/search-log.json if it exists; before evolution_finish update it with one entry per candidate you submitted: candidate digest, parent, the mechanism you claim it changed, the tasks you predicted it would move, and the tasks it actually moved. Never re-derive a measurement that entry already records, and never let a later candidate silently contradict an earlier mechanism claim without recording the contradiction.',
  'The checkpoint handoff is a strict contract, not a report. /workspace/optimizer-revision.json must have exactly one of two top-level key sets and nothing else. revise: {"action":"revise","parent":"<exact current G source digest>","source":"<relative dir with the complete G source>","composition":"plugins.yml","hypothesis":"...","evidence":["..."],"expectedChange":"...","next":"continue"}. retain: {"action":"retain","parent":"<same digest>","reason":"...","evidence":["..."],"next":"continue"|"complete"}. Both shapes are STRICT: an unrecognized top-level key rejects the whole handoff and the checkpoint ends with no revision recorded, which is a defect in how the record was written, not evidence about H. Put the development record - champion and candidate counts, per-task movements, what the checkpoint learned - in /workspace/search-log.json, and keep the revision object to the contract fields; on a revise, `evidence` is where the measured result is cited. If the handoff is rejected, correct the key set yourself and re-emit it before finishing; do not repeat completed H work to compensate. `methodInstrument` reports the current handoff shape.',
  'Finish what you froze. Before a checkpoint ends, leave the best measured candidate as the parent of the next branch and write a retain/revise decision whose evidence names a digest and a settled count; a checkpoint that ends without a settled new candidate has produced no evidence about the change it made.',
  'Continue within the remaining contract budget. When evidence justifies stopping before budget exhaustion, call evolution_finish with the reason and remaining limitations. A normal message alone does not end the experiment. Reaching a plateau is not a stopping condition: a plateau calls for a different diagnostic (the cross-candidate matrix, a capability change, or a different artifact class), not for ending the window.',
  'Do not fill the budget with repeated checks. Implement and submit genuine changes; never resample unchanged candidate bytes. A single gain does not prove causality or transfer.',
].join('\n');

/**
 * Matrix instrument: compute the cross-candidate per-task matrix straight from an
 * evolution_status artifact instead of making the optimizer re-parse spilled JSON
 * with ad-hoc bash. In the prior native session 216 of 433 tool calls were bash and
 * most of them re-derived this matrix from a spill file; the same session submitted
 * four H candidates. Reading the ledger is not the scarce resource, deciding from it
 * is, so the arithmetic moves into the method.
 *
 * Input is the status JSON (either a bare status object or one wrapped in prose
 * around the first '{'). Output is deliberately small: counts, the three diagnostic
 * rows, and the paired diff against a named candidate.
 */

function extractStatusObject(text) {
  const start = typeof text === 'string' ? text.indexOf('{') : -1;
  if (start < 0) throw new Error('matrix: input contains no JSON object');
  // Trim trailing prose after the balance closes.
  const body = text.slice(start);
  try {
    return JSON.parse(body);
  } catch {
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = 0; i < body.length; i += 1) {
      const ch = body[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (ch === '\\') escaped = true;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') inString = true;
      else if (ch === '{') depth += 1;
      else if (ch === '}') {
        depth -= 1;
        if (depth === 0) return JSON.parse(body.slice(0, i + 1));
      }
    }
    throw new Error('matrix: unbalanced JSON in input');
  }
}

function buildMatrix(status) {
  const runs = Array.isArray(status && status.runs) ? status.runs : [];
  const candidates = Array.isArray(status && status.candidates) ? status.candidates : [];
  const order = candidates.map((c) => c.digest);
  const ordinal = new Map(candidates.map((c) => [c.digest, c.ordinal]));
  /** @type {Map<string, Map<string, {phase: string, score: number|null}>>} */
  const perCandidate = new Map();
  const tasks = new Set();
  for (const r of runs) {
    if (!r || typeof r.task !== 'string' || typeof r.candidate !== 'string') continue;
    tasks.add(r.task);
    if (!perCandidate.has(r.candidate)) perCandidate.set(r.candidate, new Map());
    const grade = r.grade && typeof r.grade.score === 'number' ? r.grade.score : null;
    perCandidate.get(r.candidate).set(r.task, { phase: r.phase, score: grade });
  }
  return { runs, order, ordinal, perCandidate, tasks: [...tasks].sort() };
}

/**
 * Terminal phases. A run killed at the wall clock or failed by the runtime is a
 * settled observation with no passing answer; queued/executing/scoring runs are
 * not, and counting them would understate a candidate exactly the way the method
 * text forbids.
 */
const TERMINAL_PHASES = new Set([
  'scored',
  'execution_failed',
  'failed',
  'build_failed',
  'qa_failed',
  'cancelled',
  'graded',
]);

function stateOf(mat, digest, task) {
  const hit = mat.perCandidate.get(digest) && mat.perCandidate.get(digest).get(task);
  if (!hit) return 'missing';
  if (!TERMINAL_PHASES.has(hit.phase)) return 'pending';
  if (hit.phase !== 'scored') return 'failed';
  return hit.score === 1 ? 'pass' : 'fail';
}

function summarizeCandidate(mat, digest) {
  let pass = 0;
  let fail = 0;
  let failed = 0;
  let missing = 0;
  let pending = 0;
  for (const t of mat.tasks) {
    const s = stateOf(mat, digest, t);
    if (s === 'pass') pass += 1;
    else if (s === 'fail') fail += 1;
    else if (s === 'failed') failed += 1;
    else if (s === 'pending') pending += 1;
    else missing += 1;
  }
  return {
    digest,
    ordinal: mat.ordinal.get(digest) ?? -1,
    pass,
    fail,
    failed,
    missing,
    pending,
    tasks: mat.tasks.length,
  };
}

function matrixValue(args) {
  let statusText = '';
  if (typeof args.statusFile === 'string' && args.statusFile.length > 0) {
    statusText = readFileSync(args.statusFile, 'utf8');
  } else if (typeof args.status === 'string') {
    statusText = args.status;
  } else {
    throw new Error('matrix: pass statusFile (path to the spilled evolution_status text) or status');
  }
  const status = extractStatusObject(statusText);
  const mat = buildMatrix(status);
  const champion = typeof args.candidate === 'string' && args.candidate.length > 0
    ? args.candidate
    : status.champion;
  if (typeof champion !== 'string' || champion.length === 0) {
    throw new Error('matrix: no champion in the status and no candidate arg given');
  }
  const minSolvers = Number.isInteger(args.minSolvers) ? args.minSolvers : 1;
  const otherDigests = mat.order.filter((d) => d !== champion);
  const championMisses = [];
  const championOnly = [];
  const unsolved = [];
  const pendingTasks = [];
  for (const task of mat.tasks) {
    const championState = stateOf(mat, champion, task);
    // An executing run is not a miss: its outcome is not observed yet.
    if (championState === 'pending') {
      pendingTasks.push(task);
      continue;
    }
    const solvers = otherDigests.filter((d) => stateOf(mat, d, task) === 'pass');
    if (championState === 'pass') {
      if (solvers.length === 0) championOnly.push(task);
      continue;
    }
    if (solvers.length === 0) unsolved.push({ task, champion: championState });
    else if (solvers.length >= minSolvers) {
      championMisses.push({ task, champion: championState, solvers: solvers.length });
    }
  }
  championMisses.sort((a, b) => (b.solvers - a.solvers) || a.task.localeCompare(b.task));

  const championSummary = summarizeCandidate(mat, champion);
  // "gained" means the OTHER candidate passes a task the champion does not: the
  // phrasing that matters when deciding what to repair. Report it from the other
  // candidate's point of view explicitly, and say so in the render, because reading
  // these two lists backwards inverts every conclusion drawn from them.
  let pairedAgainst = '';
  let pairedPass = 0;
  let pairedGained = [];
  let pairedLost = [];
  let pairedNet = 0;
  let pairedUnobserved = 0;
  if (typeof args.against === 'string' && args.against.length > 0) {
    const gained = [];
    const lost = [];
    for (const task of mat.tasks) {
      const a = stateOf(mat, champion, task);
      const b = stateOf(mat, args.against, task);
      // An unobserved run is neither a gain nor a loss. Treating 'pending' as a
      // non-pass inflated a live diff to "gained 55, lost 9" against a settled
      // candidate while 52 runs were still executing.
      if (a === 'pending' || b === 'pending') continue;
      if (a !== 'pass' && b === 'pass') gained.push(task);
      else if (a === 'pass' && b !== 'pass') lost.push(task);
    }
    pairedAgainst = args.against;
    pairedPass = summarizeCandidate(mat, args.against).pass;
    pairedUnobserved = mat.tasks.filter((t) => stateOf(mat, champion, t) === 'pending'
      || stateOf(mat, args.against, t) === 'pending').length;
    pairedGained = gained;
    pairedLost = lost;
    pairedNet = gained.length - lost.length;
  }
  // A run killed at the wall clock is a settled observation (a zero-value outcome),
  // not a pending one: only a task with no recorded terminal state is unsettled.
  const unsettled = championSummary.missing + championSummary.pending;
  return {
    champion: { digest: champion, ...championSummary },
    manifestSize: mat.tasks.length,
    // A pass rate computed while runs are still executing understates the candidate.
    championSettled: unsettled === 0,
    championMisses: championMisses.slice(0, 40),
    championMissesTotal: championMisses.length,
    championOnlyTasks: championOnly.slice(0, 20),
    championOnlyTotal: championOnly.length,
    unsolvedByEveryone: unsolved.slice(0, 40).map((u) => u.task),
    unsolvedTotal: unsolved.length,
    pendingTasks,
    pendingTotal: pendingTasks.length,
    pairedAgainst,
    pairedPass,
    pairedGained,
    pairedLost,
    pairedNet,
    pairedUnobserved,
    candidates: mat.order.map((d) => summarizeCandidate(mat, d)),
  };
}


/**
 * Evidence router. The `matrix` tool says WHICH task to repair; this says WHERE the
 * bytes are. In the session that produced revision 9 the optimizer had to run six
 * ad-hoc python passes over the spilled status file just to enumerate, per task,
 * the champion's run id and the run ids of the candidates that already pass it --
 * exactly the arithmetic `matrix` removed for the aggregate, reintroduced one level
 * down. Both answers come from the same artifact, so they belong in the same tool
 * family. Output is deliberately tiny: ids and digests, never task answers.
 */
function taskEvidenceValue(args) {
  if (typeof args.task !== 'string' || args.task.length === 0) {
    throw new Error('taskEvidence: pass task (a manifest task id such as bird-254)');
  }
  let statusText = '';
  if (typeof args.statusFile === 'string' && args.statusFile.length > 0) {
    statusText = readFileSync(args.statusFile, 'utf8');
  } else if (typeof args.status === 'string') {
    statusText = args.status;
  } else {
    throw new Error('taskEvidence: pass statusFile (path to the spilled evolution_status text) or status');
  }
  const status = extractStatusObject(statusText);
  const mat = buildMatrix(status);
  const champion = typeof args.candidate === 'string' && args.candidate.length > 0
    ? args.candidate
    : status.champion;
  const runs = Array.isArray(status.runs) ? status.runs : [];
  const forTask = runs.filter((r) => r && r.task === args.task && typeof r.candidate === 'string');
  // An ungraded run has no score and often no delivery: 4 of the champion's 180
  // runs are `execution_failed` with a null grade and a deliveryDigest pointing at
  // a directory that does not exist. The old shape declared `score: number` and
  // returned null for those, which the native output validator rejected
  // (host-task-evidence-null-contract-20261105T120900Z, tool/result seq216), so a
  // task whose champion run had been killed could not be inspected at all - the
  // exact case a repair most needs. The fields are now optional and a missing
  // score stays missing rather than being fabricated as 0, which would be
  // indistinguishable from a delivered wrong answer.
  const describe = (r) => {
    const graded = r.grade && typeof r.grade.score === 'number';
    // Every field here is emitted only when the run record actually carries it:
    // an own property whose value is undefined fails the native lossless-JSON
    // output gate for the WHOLE tool call, so absence is represented by omitting
    // the key (RUN_REF declares it optional) rather than by a fabricated value.
    return {
      candidate: r.candidate,
      ...(typeof r.id === 'string' ? { run: r.id } : {}),
      phase: String(r.phase),
      ...(graded ? { score: r.grade.score } : {}),
      ...(typeof r.deliveryDigest === 'string' ? { delivery: r.deliveryDigest } : {}),
    };
  };
  const championRun = forTask.find((r) => r.candidate === champion);
  const passers = forTask
    .filter((r) => r.candidate !== champion && stateOf(mat, r.candidate, args.task) === 'pass')
    .map(describe);
  return {
    task: args.task,
    champion: champion,
    championState: stateOf(mat, champion, args.task),
    // Omitting the key is the accepted representation of "no run recorded":
    // RUN_REF is an object node, so `null` would fail the raw schema validator.
    ...(championRun ? { championRun: describe(championRun) } : {}),
    passerCount: passers.length,
    passers: passers.slice(0, 6),
    consistent: passers.every((p) => p.candidate !== champion),
  };
}

/** Human label for a graded score, or an explicit marker for a run that never delivered one. */
const scoreLabel = (ref) => (typeof ref.score === 'number' ? String(ref.score) : 'ungraded (no delivered answer)');

const RUN_REF = {
  type: 'object',
  additionalProperties: false,
  properties: {
    candidate: { type: 'string' },
    run: { type: 'string' },
    phase: { type: 'string' },
    score: { type: 'number' },
    delivery: { type: 'string' },
  },
  // `score` and `delivery` are deliberately NOT required: an execution_failed run
  // is a legitimate observation with no score and no delivered file, and requiring
  // the field forced either a fabricated value or a schema rejection. `run` is
  // optional for the same reason. See the describe() note above.
  required: ['candidate', 'phase'],
};

const TASK_EVIDENCE_OUTPUT = {
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      task: { type: 'string' },
      champion: { type: 'string' },
      championState: { type: 'string' },
      // Absence is represented as omission, never as null: the declared node is
      // an object, and `required` does not make an optional property nullable.
      championRun: RUN_REF,
      passerCount: { type: 'number' },
      passers: { type: 'array', items: RUN_REF },
      consistent: { type: 'boolean' },
    },
    required: ['task', 'champion', 'championState', 'passerCount', 'passers', 'consistent'],
  },
  render(_args, value) {
    const v = value;
    const lines = [];
    lines.push('task ' + v.task + ' - champion ' + v.champion.slice(0, 12) + ' is ' + v.championState);
    if (v.championRun) {
      lines.push('  champion run ' + v.championRun.run + ' (phase ' + v.championRun.phase
        + ', score ' + scoreLabel(v.championRun) + ')');
      if (typeof v.championRun.score === 'number') {
        lines.push('    materialize: kind=run id=' + v.championRun.run + ' area=delivery file=answer.sql');
      } else {
        lines.push('    no delivery exists for this run; do not request one. Read area=trace'
          + ' (harness-inventory.json, metrics.json, the session log) for the failure shape.');
      }
    } else {
      lines.push('  champion has no run recorded for this task');
    }
    lines.push('  candidates that PASS it: ' + v.passerCount);
    for (const p of v.passers) {
      lines.push('    ' + p.candidate.slice(0, 12) + ' run ' + p.run);
    }
    lines.push('  Read at most one passer per defect class. The question text is in the frozen'
      + ' manifest; these ids are the only authorized route to the delivered bytes.');
    return [{ type: 'text', text: lines.join('\n') }];
  },
};


/**
 * Mechanism selection record. Neutral selection has to be part of G's BEHAVIOUR,
 * not a promise in prose, so the criteria are enforced by a tool instead of a
 * paragraph the optimizer may skim. It does not choose and it does not score.
 *
 * Design constraint that shaped this file: the first version of this tool warned
 * that "every option is in one family" and printed a success message only when at
 * least two families were compared. That is a diversity quota in disguise - it
 * penalises a slate whose evidence genuinely supports one family, and rewards
 * padding a slate with a weak rival. A single family is legitimate when the other
 * options were considered and deferred with their reasons recorded. What the tool
 * actually enforces is therefore symmetry of DESCRIPTION, not breadth of slate:
 * every option carries the same fields, feasibility must be stated explicitly
 * (true, false, or "unknown", each with a rationale) instead of silently
 * defaulting to feasible, and deferral reasons are recorded per option. Family is
 * a label; it is never validated, counted toward a threshold, or weighted.
 *
 * Uncertainty, counter-evidence, expected correctness impact and defer reasons are
 * real fields on the record, so a later session can audit what was considered
 * rather than re-reading prose.
 */
const SELECTION_FAMILIES = new Set([
  'prompt',
  'tool',
  'workflow',
  'plugin-config',
  'reuse',
  'composition',
  'other',
]);

const FEASIBILITY = new Set(['true', 'false', 'unknown']);

function requireText(o, field, i) {
  const v = o[field];
  if (typeof v !== 'string' || v.trim() === '') {
    throw new Error(`mechanism: option ${i} needs a non-empty ${field}`);
  }
  return v.trim();
}

function mechanismValue(args) {
  const options = Array.isArray(args.options) ? args.options : [];
  if (options.length === 0) {
    throw new Error('mechanism: pass at least one option; an empty slate records no reasoning');
  }
  const normalized = options.map((o, i) => {
    if (o === null || typeof o !== 'object') throw new Error(`mechanism: option ${i} is not an object`);
    const family = String(o.family ?? '');
    if (!SELECTION_FAMILIES.has(family)) {
      throw new Error(`mechanism: option ${i} has family "${family}"; use one of ${[...SELECTION_FAMILIES].join(', ')}`);
    }
    // Feasibility must be STATED. A missing value is not "feasible".
    const feasibility = String(o.feasibility ?? '');
    if (!FEASIBILITY.has(feasibility)) {
      throw new Error(`mechanism: option ${i} (${family}) must state feasibility as one of ${[...FEASIBILITY].join(', ')}; a missing value must not read as feasible`);
    }
    return {
      index: i,
      family,
      mechanism: requireText(o, 'mechanism', i),
      evidence: requireText(o, 'evidence', i),
      counterEvidence: requireText(o, 'counterEvidence', i),
      uncertainty: requireText(o, 'uncertainty', i),
      expectedCorrectness: requireText(o, 'expectedCorrectness', i),
      regressionSurface: requireText(o, 'regressionSurface', i),
      distinguishes: requireText(o, 'distinguishes', i),
      sharedFailureChecked: o.sharedFailureChecked === true,
      feasibility,
      feasibilityReason: requireText(o, 'feasibilityReason', i),
      disposition: (() => {
        const d = String(o.disposition ?? '');
        if (d !== 'selected' && d !== 'deferred') {
          throw new Error(`mechanism: option ${i} (${family}) must be marked disposition "selected" or "deferred"`);
        }
        return d;
      })(),
      deferReason: o.disposition === 'deferred' ? requireText(o, 'deferReason', i) : '',
    };
  });

  const selected = normalized.filter((o) => o.disposition === 'selected');
  if (selected.length !== 1) {
    throw new Error(`mechanism: mark exactly one option "selected"; found ${selected.length}`);
  }
  if (selected[0].feasibility === 'false') {
    throw new Error('mechanism: the selected option is stated infeasible; defer it and select a feasible one');
  }

  const families = [...new Set(normalized.map((o) => o.family))];
  const warnings = [];
  for (const o of normalized) {
    if (!o.sharedFailureChecked) {
      warnings.push(`option ${o.index} (${o.family}) does not say whether the failure also reproduces on a task the champion already passes`);
    }
    if (o.feasibility === 'unknown') {
      warnings.push(`option ${o.index} (${o.family}) records feasibility as unknown: resolve it before building, or say what would resolve it`);
    }
  }

  return {
    optionCount: normalized.length,
    families,
    familyCount: families.length,
    selected: selected[0].index,
    warnings,
    options: normalized,
  };
}

const MECHANISM_OPTION = {
  type: 'object',
  additionalProperties: false,
  properties: {
    index: { type: 'number' },
    family: { type: 'string' },
    mechanism: { type: 'string' },
    evidence: { type: 'string' },
    counterEvidence: { type: 'string' },
    uncertainty: { type: 'string' },
    expectedCorrectness: { type: 'string' },
    regressionSurface: { type: 'string' },
    distinguishes: { type: 'string' },
    sharedFailureChecked: { type: 'boolean' },
    feasibility: { type: 'string' },
    feasibilityReason: { type: 'string' },
    disposition: { type: 'string' },
    deferReason: { type: 'string' },
  },
  required: [
    'index', 'family', 'mechanism', 'evidence', 'counterEvidence', 'uncertainty',
    'expectedCorrectness', 'regressionSurface', 'distinguishes', 'sharedFailureChecked',
    'feasibility', 'feasibilityReason', 'disposition', 'deferReason',
  ],
};

const MECHANISM_OUTPUT = {
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      optionCount: { type: 'number' },
      families: { type: 'array', items: { type: 'string' } },
      familyCount: { type: 'number' },
      selected: { type: 'number' },
      warnings: { type: 'array', items: { type: 'string' } },
      options: { type: 'array', items: MECHANISM_OPTION },
    },
    required: ['optionCount', 'families', 'familyCount', 'selected', 'warnings', 'options'],
  },
  render(_args, value) {
    const v = value;
    const lines = [];
    lines.push('mechanism slate: ' + v.optionCount + ' option(s), ' + v.familyCount + ' family label(s)');
    for (const o of v.options) {
      lines.push('  [' + o.index + '] ' + o.family + ' - ' + o.disposition.toUpperCase()
        + ' (feasibility: ' + o.feasibility + (o.sharedFailureChecked ? '' : ', shared-failure unstated') + ')');
      lines.push('      mechanism:     ' + o.mechanism);
      lines.push('      evidence:      ' + o.evidence);
      lines.push('      counter:       ' + o.counterEvidence);
      lines.push('      uncertainty:   ' + o.uncertainty);
      lines.push('      correctness:   ' + o.expectedCorrectness);
      lines.push('      regression:    ' + o.regressionSurface);
      lines.push('      distinguishes: ' + o.distinguishes);
      lines.push('      feasibility:   ' + o.feasibilityReason);
      if (o.deferReason !== '') lines.push('      deferred:      ' + o.deferReason);
    }
    if (v.warnings.length > 0) {
      lines.push('notes:');
      for (const w of v.warnings) lines.push('  - ' + w);
    } else {
      lines.push('slate is complete: every option carries the same fields and one is selected.');
    }
    lines.push('Family labels are recorded, not validated or weighted. A one-family slate is legitimate when the others were considered and deferred with reasons.');
    lines.push('This tool records and checks a decision; it does not choose, does not score, and is not evidence that the selection works.');
    return [{ type: 'text', text: lines.join('\n') }];
  },
};

const MECHANISM_PARAMETERS = {
  type: 'object',
  additionalProperties: false,
  properties: {
    options: {
      type: 'array',
      description: 'One entry per mechanism you seriously considered. Judge every family with the same fields.',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          family: { type: 'string', description: 'prompt | tool | workflow | plugin-config | reuse | composition | other' },
          mechanism: { type: 'string', description: 'The observed failure mechanism this option addresses.' },
          evidence: { type: 'string', description: 'The artifact bytes or measurement that show the mechanism.' },
          counterEvidence: { type: 'string', description: 'Evidence that argues against this option, including a task the champion already passes where the same failure does not appear.' },
          uncertainty: { type: 'string', description: 'What is not yet known about this option.' },
          expectedCorrectness: { type: 'string', description: 'Expected effect on correctness and why; prose, not an invented score.' },
          regressionSurface: { type: 'string', description: 'Which currently-passing tasks it could damage, and why.' },
          distinguishes: { type: 'string', description: 'What the experiment would distinguish that its rivals would not.' },
          sharedFailureChecked: { type: 'boolean', description: 'True once you checked whether the failure also reproduces on a task the champion already passes.' },
          feasibility: { type: 'string', description: 'true | false | unknown - must be stated, never assumed.' },
          feasibilityReason: { type: 'string', description: 'Why that feasibility holds under the frozen limits.' },
          disposition: { type: 'string', description: 'selected | deferred' },
          deferReason: { type: 'string', description: 'Required when deferred.' },
        },
        required: ['family', 'mechanism', 'evidence', 'counterEvidence', 'uncertainty', 'expectedCorrectness', 'regressionSurface', 'distinguishes', 'feasibility', 'feasibilityReason', 'disposition'],
      },
    },
  },
  required: ['options'],
};

/** Scalar-only shapes: the raw-schema checker forbids type arrays, so every node has one type. */
const COUNTED = {
  type: 'object',
  additionalProperties: false,
  properties: {
    digest: { type: 'string' },
    ordinal: { type: 'number' },
    pass: { type: 'number' },
    fail: { type: 'number' },
    failed: { type: 'number' },
    missing: { type: 'number' },
    pending: { type: 'number' },
    tasks: { type: 'number' },
  },
  required: ['digest', 'ordinal', 'pass', 'fail', 'failed', 'missing', 'pending', 'tasks'],
};

const MATRIX_OUTPUT = {
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      champion: COUNTED,
      manifestSize: { type: 'number' },
      championSettled: { type: 'boolean' },
      championMisses: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            task: { type: 'string' },
            champion: { type: 'string' },
            solvers: { type: 'number' },
          },
          required: ['task', 'champion', 'solvers'],
        },
      },
      championMissesTotal: { type: 'number' },
      championOnlyTasks: { type: 'array', items: { type: 'string' } },
      championOnlyTotal: { type: 'number' },
      unsolvedByEveryone: { type: 'array', items: { type: 'string' } },
      unsolvedTotal: { type: 'number' },
      pendingTasks: { type: 'array', items: { type: 'string' } },
      pendingTotal: { type: 'number' },
      pairedAgainst: { type: 'string' },
      pairedPass: { type: 'number' },
      pairedGained: { type: 'array', items: { type: 'string' } },
      pairedLost: { type: 'array', items: { type: 'string' } },
      pairedNet: { type: 'number' },
      pairedUnobserved: { type: 'number' },
      candidates: { type: 'array', items: COUNTED },
    },
    required: [
      'champion',
      'manifestSize',
      'championSettled',
      'championMisses',
      'championMissesTotal',
      'championOnlyTasks',
      'championOnlyTotal',
      'unsolvedByEveryone',
      'unsolvedTotal',
      'pendingTasks',
      'pendingTotal',
      'pairedAgainst',
      'pairedPass',
      'pairedGained',
      'pairedLost',
      'pairedNet',
      'pairedUnobserved',
      'candidates',
    ],
  },
  render(_args, value) {
    const v = value;
    const lines = [];
    const c = v.champion;
    lines.push('champion ' + c.digest.slice(0, 12) + ' (ordinal ' + c.ordinal + '): '
      + c.pass + '/' + c.tasks + ' pass, ' + c.fail + ' wrong, ' + c.failed + ' execution_failed, '
      + (c.missing + c.pending) + ' not yet terminal'
      + (v.championSettled ? ' [settled: every task reached a terminal phase]'
        : ' [NOT settled: ' + (c.pending + c.missing) + ' task(s) still executing - do not quote this as a result]'));
    lines.push('misses solved by other candidates: ' + v.championMissesTotal);
    for (const m of v.championMisses.slice(0, 25)) {
      lines.push('  ' + m.task + '  champ=' + m.champion + '  others=' + m.solvers);
    }
    if (v.championOnlyTotal > 0) {
      lines.push('solved only by the champion (' + v.championOnlyTotal + '): '
        + v.championOnlyTasks.join(', ') + ' -- losing these is a regression');
    }
    lines.push('unsolved by every candidate: ' + v.unsolvedTotal
      + (v.unsolvedTotal > 0 ? ' (' + v.unsolvedByEveryone.join(', ') + ')' : ''));
    if (v.pendingTotal > 0) {
      lines.push('still executing (unobserved, not zeros): ' + v.pendingTotal
        + ' [' + v.pendingTasks.slice(0, 20).join(', ') + ']');
    }
    if (v.pairedAgainst !== '') {
      lines.push('paired: ' + v.pairedAgainst.slice(0, 12) + ' scores ' + v.pairedPass + '/' + v.manifestSize
        + ', net ' + v.pairedNet + ' against this champion.');
      lines.push('  that candidate GAINED (champion misses, it passes): '
        + v.pairedGained.length + ' [' + v.pairedGained.join(', ') + ']');
      lines.push('  that candidate LOST (champion passes, it misses): '
        + v.pairedLost.length + ' [' + v.pairedLost.join(', ') + ']');
      if (v.pairedUnobserved > 0) {
        lines.push('  ' + v.pairedUnobserved + ' task(s) excluded from the diff: at least one side'
          + ' has not reached a terminal phase, so its outcome is unobserved');
      }
    }
    lines.push('candidates: ' + v.candidates.map((x) => '#' + x.ordinal + '=' + x.pass).join(' '));
    return [{ type: 'text', text: lines.join('\n') }];
  },
};

const TASK_EVIDENCE_PARAMETERS = {
  type: 'object',
  additionalProperties: false,
  properties: {
    statusFile: { type: 'string', description: 'Path to the spilled evolution_status text.' },
    status: { type: 'string', description: 'Inline status JSON, for small ledgers only.' },
    task: { type: 'string', description: 'Manifest task id, for example bird-254.' },
    candidate: { type: 'string', description: 'Candidate digest to treat as champion; defaults to the ledger champion.' },
  },
  required: ['statusFile', 'task'],
};

const MATRIX_PARAMETERS = {
  type: 'object',
  additionalProperties: false,
  properties: {
    statusFile: { type: 'string', description: 'Path to the spilled evolution_status text (a 180-task ledger is several MB, so pass the path the host reports, not its contents).' },
    status: { type: 'string', description: 'Inline status JSON, for small ledgers only.' },
    candidate: { type: 'string', description: 'Candidate digest to treat as champion; defaults to the ledger champion.' },
    against: { type: 'string', description: 'Candidate digest to diff the champion against (gained/lost task lists).' },
    minSolvers: { type: 'number', description: 'Minimum number of other candidates that must pass a task for it to appear in championMisses (default 1).' },
  },
  required: ['statusFile'],
};

/**
 * Search-map instrument. `matrix` answers "which task should I repair next";
 * `searchMap` answers "what has this study been doing, and is the next experiment
 * actually a different experiment". Both read the same artifact; neither writes.
 *
 * Why it exists, measured not assumed: the carried ledger holds 41 candidates and
 * 7200 runs. Nine consecutive candidates after the 161/180 champion all branched
 * from that one champion and all changed guidance.md, settling 154, 158, 147, 156,
 * 159, 155, 154 and 155. Reading that history candidate by candidate is how a
 * plateau hides: every entry looks like a distinct repair of a distinct task, and
 * the concentration - one parent, one mechanism family, one change range - is only
 * visible when the whole ledger is projected onto those three axes.
 *
 * Change range is reported at the granularity the ledger actually records: the
 * status artifact carries per-candidate build digests, not per-file hashes, so
 * `searchMap` classifies a candidate as identical to its parent (same bundle),
 * dependency-changed (different lock) or source-only, and says 'unknown' when a
 * record lacks the digests. It never fabricates a file count it could not read.
 *
 * Quality and pace are reported as separate numbers, because the artifact shows
 * them moving independently; lineage is reported only as a relationship to the
 * current champion.
 */
function searchMapValue(args) {
  let statusText = '';
  if (typeof args.statusFile === 'string' && args.statusFile.length > 0) {
    statusText = readFileSync(args.statusFile, 'utf8');
  } else if (typeof args.status === 'string') {
    statusText = args.status;
  } else {
    throw new Error('searchMap: pass statusFile (path to the spilled evolution_status text) or status');
  }
  const status = extractStatusObject(statusText);
  const mat = buildMatrix(status);
  const champion = typeof args.candidate === 'string' && args.candidate.length > 0
    ? args.candidate
    : status.champion;
  const candidates = Array.isArray(status.candidates) ? status.candidates : [];
  const byDigest = new Map(candidates.map((c) => [c.digest, c]));

  /**
   * Recorded ancestry. Every parent a candidate records is kept, in order: a
   * candidate built on a composition of two parents has two, and dropping all but
   * the first would misreport the ancestry the contract asks us to preserve.
   */
  const parentsOf = (c) => {
    const p = c && c.proposal && Array.isArray(c.proposal.parents) ? c.proposal.parents : [];
    return p.filter((x) => typeof x === 'string' && x.length > 0);
  };
  /** The exact recorded hypothesis, untruncated and ungrouped. A claim, not a measurement. */
  const claimOf = (c) => (
    c && c.proposal && typeof c.proposal.hypothesis === 'string'
      ? c.proposal.hypothesis.trim()
      : ''
  );

  /**
   * Pace per candidate, measured from the artifact's run timestamps. Quality and
   * pace are separate numbers because they move independently: the carried ledger
   * contains candidates whose deliveries got faster while their pass count fell.
   * Only terminal runs with both timestamps count; a thin sample reports nothing.
   */
  const paceOf = (digest) => {
    const durations = [];
    for (const r of mat.runs) {
      if (!r || r.candidate !== digest) continue;
      if (!TERMINAL_PHASES.has(String(r.phase))) continue;
      const a = Date.parse(String(r.startedAt ?? ''));
      const b = Date.parse(String(r.completedAt ?? ''));
      if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) continue;
      durations.push((b - a) / 1000);
    }
    if (durations.length < 10) return undefined;
    durations.sort((x, y) => x - y);
    const mid = Math.floor(durations.length / 2);
    const median = durations.length % 2 === 0
      ? (durations[mid - 1] + durations[mid]) / 2
      : durations[mid];
    const p90 = durations[Math.min(durations.length - 1, Math.floor(durations.length * 0.9))];
    return { timed: durations.length, medianSeconds: Math.round(median), p90Seconds: Math.round(p90) };
  };

  /**
   * Quality of a candidate against a baseline, over SETTLED tasks only. A task
   * whose outcome is still unobserved on either side is excluded and counted
   * separately: treating an unfinished run as a miss would understate a candidate
   * and would let an in-flight result drive a quality comparison.
   */
  const compare = (candidateDigest, baseDigest) => {
    if (!baseDigest || !byDigest.has(baseDigest)) {
      return { baseKnown: false, gained: [], lost: [], unobserved: 0, net: undefined };
    }
    const gained = [];
    const lost = [];
    let unobserved = 0;
    for (const t of mat.tasks) {
      const a = stateOf(mat, baseDigest, t);
      const b = stateOf(mat, candidateDigest, t);
      if (a === 'pending' || b === 'pending' || a === 'missing' || b === 'missing') {
        unobserved += 1;
        continue;
      }
      if (a !== 'pass' && b === 'pass') gained.push(t);
      else if (a === 'pass' && b !== 'pass') lost.push(t);
    }
    return { baseKnown: true, gained, lost, unobserved, net: gained.length - lost.length };
  };

  const rows = [];
  for (const c of candidates) {
    if (!c || typeof c.digest !== 'string') continue;
    const summary = summarizeCandidate(mat, c.digest);
    const parents = parentsOf(c);
    const primary = parents.length > 0 ? parents[0] : '';
    const diff = compare(c.digest, primary);
    rows.push({
      digest: c.digest,
      ordinal: typeof c.ordinal === 'number' ? c.ordinal : -1,
      phase: String(c.phase ?? ''),
      parents,
      primaryParent: primary,
      parentOrdinal: primary && byDigest.has(primary) ? (byDigest.get(primary).ordinal ?? -1) : -1,
      pass: summary.pass,
      fail: summary.fail,
      failed: summary.failed,
      settled: summary.missing + summary.pending === 0,
      parentPass: primary && byDigest.has(primary) ? summarizeCandidate(mat, primary).pass : null,
      netVsPrimary: diff.baseKnown && diff.net !== undefined ? diff.net : null,
      gainedVsPrimary: diff.gained.length,
      lostVsPrimary: diff.lost.length,
      unobservedVsPrimary: diff.unobserved,
      // Relationship to the CURRENT champion only. This is not a claim about which
      // candidate was incumbent at the time the candidate was made: a candidate
      // whose parent chain runs through an older, stronger candidate is recorded
      // as what it is - its primary parent - and nothing more.
      championRelation: primary === champion
        ? 'direct-champion-child'
        : (parents.includes(champion) ? 'champion-co-parent' : 'other-lineage'),
      claim: claimOf(c),
      paceSeconds: paceOf(c.digest) ?? null,
    });
  }

  // Parent concentration: how many children each parent absorbed.
  const parentCounts = new Map();
  for (const r of rows) {
    for (const p of r.parents) parentCounts.set(p, (parentCounts.get(p) || 0) + 1);
  }
  const parents = [...parentCounts.entries()]
    .map(([digest, children]) => ({
      digest,
      ordinal: byDigest.has(digest) ? (byDigest.get(digest).ordinal ?? -1) : -1,
      children,
      pass: summarizeCandidate(mat, digest).pass,
      isChampion: digest === champion,
    }))
    .sort((a, b) => (b.children - a.children) || (b.pass - a.pass))
    .slice(0, 12);

  /**
   * Claims are listed verbatim and never grouped: punctuation-splitting or
   * truncation would invent an equivalence the record does not carry, and two
   * different hypses can share a first clause while testing opposite things.
   * The caller compares wording itself; the tool only makes repetition visible.
   */
  // Full claim text is preserved on the row (`claim`) and returned intact here for
  // the listed candidates; `claimChars` lets the caller see when a longer claim was
  // cut for the fixture window rather than silently believing it saw everything.
  const claims = rows
    .filter((r) => r.claim !== '')
    .slice()
    .sort((a, b) => b.ordinal - a.ordinal)
    .slice(0, 12)
    .map((r) => ({ ordinal: r.ordinal, claim: r.claim, claimChars: r.claim.length }));

  /**
   * Change range at the granularity the ledger records. Bundle and lock digests
   * identify WHICH frozen assembly a candidate used; they do not count changed
   * source files and do not say whether the change was prompt, code or
   * composition, so this reports identity and says the finer classification is
   * unknown rather than inferring it.
   */
  const changeOf = (c) => {
    const primary = parentsOf(c)[0] || '';
    const parent = byDigest.get(primary);
    if (!parent || !parent.build || !c.build) return 'unknown';
    if (parent.build.bundleDigest === c.build.bundleDigest) return 'same-frozen-assembly';
    if (parent.build.lockDigest !== c.build.lockDigest) return 'dependency-surface-differs';
    return 'assembly-differs-lock-same';
  };

  // Reachability over the whole manifest. A task counts as reachable when the
  // CHAMPION passes it or any other candidate does; the champion's own passes are
  // part of the union, not a separate category.
  let reachable = 0;
  let championMissesOthersSolve = 0;
  let unresolvedTasks = 0;
  let unsolved = 0;
  const repairTargets = [];
  /**
   * Every candidate identity the artifact carries, taken from BOTH the candidate
   * list and the run records. A run can name a candidate that has not yet been
   * listed (or whose record is filtered), and ignoring it would make an
   * unobserved outcome look like an observed non-pass - the exact error that
   * turns "unresolved" into a false "unsolved by everyone".
   */
  const observedDigests = [...new Set([
    ...mat.order,
    ...mat.runs.filter((r) => r && typeof r.candidate === 'string').map((r) => r.candidate),
  ])];
  for (const t of mat.tasks) {
    const champState = stateOf(mat, champion, t);
    const otherDigests = observedDigests.filter((d) => d !== champion);
    const anyPass = observedDigests.some((d) => stateOf(mat, d, t) === 'pass');
    const allObserved = observedDigests.every(
      (d) => stateOf(mat, d, t) !== 'pending' && stateOf(mat, d, t) !== 'missing',
    );
    if (anyPass) reachable += 1;
    if (champState === 'pass') continue;
    if (champState === 'pending' || champState === 'missing') {
      // Unobserved on the champion itself: neither reachable-and-missed nor unsolved.
      unresolvedTasks += 1;
      continue;
    }
    if (anyPass) {
      championMissesOthersSolve += 1;
      repairTargets.push({ task: t, solvers: otherDigests.filter((d) => stateOf(mat, d, t) === 'pass').length });
    } else if (allObserved) {
      // "Unsolved by everyone" requires every observed outcome to be terminal.
      unsolved += 1;
    } else {
      unresolvedTasks += 1;
    }
  }
  repairTargets.sort((a, b) => (b.solvers - a.solvers) || a.task.localeCompare(b.task));

  const settled = rows.filter((r) => r.settled);
  const champPass = summarizeCandidate(mat, champion).pass;
  let directChampionChildren = 0;
  let otherLineage = 0;
  let directBest = -1;
  let otherBest = -1;
  for (const r of settled) {
    if (r.parents.length === 0) continue;
    if (r.primaryParent === champion) {
      directChampionChildren += 1;
      if (r.pass > directBest) directBest = r.pass;
    } else {
      otherLineage += 1;
      if (r.pass > otherBest) otherBest = r.pass;
    }
  }
  const medianOf = (xs) => {
    if (xs.length === 0) return undefined;
    const v = xs.slice().sort((a, b) => a - b);
    const mid = Math.floor(v.length / 2);
    return v.length % 2 === 0 ? Math.round((v[mid - 1] + v[mid]) / 2) : v[mid];
  };
  const paced = settled.filter((r) => r.paceSeconds !== null && r.paceSeconds !== undefined);
  const aboveGroup = paced.filter((r) => r.pass > champPass);
  const belowGroup = paced.filter((r) => r.pass <= champPass);
  const paceAbove = medianOf(aboveGroup.map((r) => r.paceSeconds.medianSeconds));
  const paceBelow = medianOf(belowGroup.map((r) => r.paceSeconds.medianSeconds));
  // `recent` includes partially observed candidates so their unobserved count is
  // visible; the per-row `settled` flag says whether the full panel is in.
  const observed = rows.filter((r) => r.pass + r.fail + r.failed > 0);
  const ordered = observed.slice().sort((a, b) => b.ordinal - a.ordinal);

  const changeKinds = new Map();
  for (const c of candidates) {
    if (!c || typeof c.digest !== 'string') continue;
    if (parentsOf(c).length === 0) continue;
    const k = changeOf(c);
    changeKinds.set(k, (changeKinds.get(k) || 0) + 1);
  }

  return {
    champion,
    championPass: champPass,
    directChampionChildren,
    otherLineage,
    directBest,
    otherBest,
    // An absent observation is reported as JSON `null` with a stated count, never
    // as `undefined` (which the native tool-output gate rejects as lossless-JSON
    // loss and never as 0 (which would be a measurement this map did not take).
    // The champion is the best observed score here, so an empty above-champion
    // group is the ordinary case rather than an exceptional one.
    paceAboveChampion: paceAbove ?? null,
    paceBelowChampion: paceBelow ?? null,
    paceAboveChampionCandidates: aboveGroup.length,
    paceBelowChampionCandidates: belowGroup.length,
    candidateCount: rows.length,
    settledCount: settled.length,
    manifestSize: mat.tasks.length,
    reachableTasks: reachable,
    championMissesOthersSolve,
    unresolvedTasks,
    unsolvedByEveryone: unsolved,
    recent: ordered.slice(0, 8),
    parents,
    claims,
    changeRange: [...changeKinds.entries()]
      .map(([kind, count]) => ({ kind, count }))
      .sort((a, b) => b.count - a.count),
    repairTargets: repairTargets.slice(0, 25),
  };
}

const SEARCH_ROW = {
  type: 'object',
  additionalProperties: false,
  properties: {
    digest: { type: 'string' },
    ordinal: { type: 'number' },
    phase: { type: 'string' },
    parents: { type: 'array', items: { type: 'string' } },
    primaryParent: { type: 'string' },
    parentOrdinal: { type: 'number' },
    pass: { type: 'number' },
    fail: { type: 'number' },
    failed: { type: 'number' },
    settled: { type: 'boolean' },
    // `null` is the explicit "not observed/not computable" value, so the row is
    // valid lossless JSON in every case; the field stays present so a consumer can
    // tell "no parent to compare against" from "field withdrawn".
    parentPass: { oneOf: [{ type: 'number' }, { type: 'null' }] },
    netVsPrimary: { oneOf: [{ type: 'number' }, { type: 'null' }] },
    gainedVsPrimary: { type: 'number' },
    lostVsPrimary: { type: 'number' },
    unobservedVsPrimary: { type: 'number' },
    championRelation: { type: 'string' },
    claim: { type: 'string' },
    paceSeconds: {
      oneOf: [
        {
          type: 'object',
          additionalProperties: false,
          properties: {
            timed: { type: 'number' },
            medianSeconds: { type: 'number' },
            p90Seconds: { type: 'number' },
          },
          required: ['timed', 'medianSeconds', 'p90Seconds'],
        },
        { type: 'null' },
      ],
    },
  },
  required: [
    'digest', 'ordinal', 'phase', 'parents', 'primaryParent', 'parentOrdinal', 'pass', 'fail',
    'failed', 'settled', 'parentPass', 'netVsPrimary', 'gainedVsPrimary', 'lostVsPrimary',
    'unobservedVsPrimary', 'championRelation', 'claim', 'paceSeconds',
  ],
};

const SEARCH_MAP_OUTPUT = {
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      champion: { type: 'string' },
      championPass: { type: 'number' },
      directChampionChildren: { type: 'number' },
      otherLineage: { type: 'number' },
      directBest: { type: 'number' },
      otherBest: { type: 'number' },
      paceAboveChampion: { oneOf: [{ type: 'number' }, { type: 'null' }] },
      paceBelowChampion: { oneOf: [{ type: 'number' }, { type: 'null' }] },
      paceAboveChampionCandidates: { type: 'number' },
      paceBelowChampionCandidates: { type: 'number' },
      candidateCount: { type: 'number' },
      settledCount: { type: 'number' },
      manifestSize: { type: 'number' },
      reachableTasks: { type: 'number' },
      championMissesOthersSolve: { type: 'number' },
      unresolvedTasks: { type: 'number' },
      unsolvedByEveryone: { type: 'number' },
      recent: { type: 'array', items: SEARCH_ROW },
      parents: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            digest: { type: 'string' },
            ordinal: { type: 'number' },
            children: { type: 'number' },
            pass: { type: 'number' },
            isChampion: { type: 'boolean' },
          },
          required: ['digest', 'ordinal', 'children', 'pass', 'isChampion'],
        },
      },
      claims: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            ordinal: { type: 'number' },
            claim: { type: 'string' },
            claimChars: { type: 'number' },
          },
          required: ['ordinal', 'claim', 'claimChars'],
        },
      },
      changeRange: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: { kind: { type: 'string' }, count: { type: 'number' } },
          required: ['kind', 'count'],
        },
      },
      repairTargets: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: { task: { type: 'string' }, solvers: { type: 'number' } },
          required: ['task', 'solvers'],
        },
      },
    },
    required: [
      'champion',
      'championPass',
      'directChampionChildren',
      'otherLineage',
      'paceAboveChampion',
      'paceBelowChampion',
      'paceAboveChampionCandidates',
      'paceBelowChampionCandidates',
      'candidateCount',
      'settledCount',
      'manifestSize',
      'reachableTasks',
      'championMissesOthersSolve',
      'unresolvedTasks',
      'unsolvedByEveryone',
      'recent',
      'parents',
      'claims',
      'changeRange',
      'repairTargets',
    ],
  },
  render(_args, value) {
    const v = value;
    const lines = [];
    lines.push('search map - champion ' + v.champion.slice(0, 12) + ' at ' + v.championPass + '/' + v.manifestSize
      + '; ' + v.settledCount + ' of ' + v.candidateCount + ' candidates settled');
    lines.push('reachable: ' + v.reachableTasks + '/' + v.manifestSize
      + ' tasks are passed by at least one candidate (champion passes included); '
      + v.championMissesOthersSolve + ' champion misses are already solved by another candidate; '
      + v.unsolvedByEveryone + ' are unsolved by every observed candidate; '
      + v.unresolvedTasks + ' task(s) are unresolved (some outcome not observed) and are counted as neither.');
    lines.push('lineage to the CURRENT champion: ' + v.directChampionChildren
      + ' settled candidates name it as their primary parent (best ' + v.directBest + '/' + v.manifestSize
      + '); ' + v.otherLineage + ' settled candidates carry another primary parent (best '
      + v.otherBest + '/' + v.manifestSize + '). This is a relation to the current champion,'
      + ' not a reconstruction of which candidate was incumbent at the time.');
    if (typeof v.paceAboveChampion === 'number' && typeof v.paceBelowChampion === 'number') {
      lines.push('pace vs quality: median run time ' + v.paceAboveChampion + 's for candidates scoring above the champion, '
        + v.paceBelowChampion + 's for those at or below it. A faster group scoring lower is a pace difference,'
        + ' not a quality difference.');
    }
    lines.push('parent concentration (children counted per recorded parent, settled pass):');
    for (const p of v.parents) {
      lines.push('  #' + p.ordinal + ' ' + p.digest.slice(0, 12) + '  children=' + p.children + '  pass=' + p.pass
        + (p.isChampion ? '  [current champion]' : ''));
    }
    if (v.changeRange.length > 0) {
      lines.push('frozen-assembly relation to primary parent (identity only - NOT a changed-file count,'
        + ' and it does not say prompt vs code vs composition): '
        + v.changeRange.map((r) => r.kind + ' x' + r.count).join(', '));
    }
    lines.push('recent settled candidates (primary parent, pass, net vs that parent, unobserved excluded):');
    for (const r of v.recent) {
      const net = typeof r.netVsPrimary === 'number' ? (r.netVsPrimary >= 0 ? '+' + r.netVsPrimary : String(r.netVsPrimary)) : '?';
      const pace = r.paceSeconds ? '  median=' + r.paceSeconds.medianSeconds + 's' : '';
      lines.push('  #' + r.ordinal + ' ' + r.digest.slice(0, 12) + '  from #' + r.parentOrdinal
        + (r.parents.length > 1 ? ' (+' + (r.parents.length - 1) + ' co-parent)' : '')
        + '  pass=' + r.pass + '  net=' + net + '  gained=' + r.gainedVsPrimary + ' lost=' + r.lostVsPrimary
        + ' unobserved=' + r.unobservedVsPrimary + pace + '  ' + r.championRelation);
    }
    if (v.repairTargets.length > 0) {
      lines.push('repair targets the champion misses and others solve (solvers): '
        + v.repairTargets.slice(0, 15).map((t) => t.task + '(' + t.solvers + ')').join(' '));
    }
    lines.push('recent claims, UNTRUNCATED in the value and PREVIEWED below to 160 characters (claimChars says the full length; a claim is not a measurement and no two are grouped):');
    for (const c of v.claims.slice(0, 6)) {
      const preview = c.claim.length > 160 ? c.claim.slice(0, 160) + '...' : c.claim;
      lines.push('  #' + c.ordinal + ' (' + c.claimChars + ' chars): ' + preview);
    }
    lines.push('This reports concentration, pace against quality, and lineage against the current champion.'
      + ' It does not select, does not score, and a repeated claim is not evidence that a mechanism is wrong.');
    return [{ type: 'text', text: lines.join('\n') }];
  },
};

const SEARCH_MAP_PARAMETERS = {
  type: 'object',
  additionalProperties: false,
  properties: {
    statusFile: { type: 'string', description: 'Path to the spilled evolution_status text.' },
    status: { type: 'string', description: 'Inline status JSON, for small ledgers only.' },
    candidate: { type: 'string', description: 'Candidate digest to treat as champion; defaults to the ledger champion.' },
  },
  required: ['statusFile'],
};

/** Legal top-level key sets for the strict MethodRevision union. */
const HANDOFF_KEYS = {
  revise: ['action', 'parent', 'source', 'composition', 'hypothesis', 'evidence', 'expectedChange', 'next'],
  retain: ['action', 'parent', 'reason', 'evidence', 'next'],
};

/**
 * Report the SHAPE of the checkpoint handoff, never its content and never a
 * judgement about the decision it records. Revision 10's handoff was rejected for
 * one unrecognized top-level key while a checkpoint of measured results sat behind
 * the error; the fix belongs in the method text, but the trace should also show the
 * defect at the moment it exists rather than only as a host rejection at the end.
 * It reads /workspace/optimizer-revision.json when present, compares its top-level
 * keys against the strict union, and reports what is missing or extra. It does not
 * validate, rewrite or vouch for a decision.
 */
function handoffShape() {
  const path = '/workspace/optimizer-revision.json';
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return { present: false, status: 'absent', action: '', extra: [], missing: [], note: 'no handoff written yet at ' + path };
  }
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    return { present: true, status: 'unparseable', action: '', extra: [], missing: [], note: 'the handoff is not valid JSON, so the host cannot parse it' };
  }
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return { present: true, status: 'not-an-object', action: '', extra: [], missing: [], note: 'the handoff root must be a JSON object' };
  }
  const keys = Object.keys(body);
  const action = typeof body.action === 'string' ? body.action : '';
  const legal = HANDOFF_KEYS[action];
  if (legal === undefined) {
    return {
      present: true, status: 'unknown-action', action, extra: [], missing: [],
      note: 'action must be "revise" or "retain"; the host rejects anything else',
    };
  }
  const extra = keys.filter((k) => !legal.includes(k));
  const missing = legal.filter((k) => !keys.includes(k));
  if (extra.length === 0 && missing.length === 0) {
    return { present: true, status: 'legal', action, extra, missing, note: 'top-level key set matches the strict ' + action + ' contract' };
  }
  return {
    present: true, status: 'illegal', action, extra, missing,
    note: 'top-level key set does not match the strict ' + action + ' contract: '
      + (extra.length ? 'unrecognized ' + extra.join(', ') : 'no extra keys')
      + '; ' + (missing.length ? 'missing ' + missing.join(', ') : 'nothing missing')
      + ' - the host rejects the handoff on the unrecognized keys, so move any development record into /workspace/search-log.json and re-emit',
  };
}

/**
 * Decision-state reader (revision 18).
 *
 * WHY THIS EXISTS (measured, not intended). Two host interventions in one
 * checkpoint named the same defect: a session re-derived candidates, parents and
 * miss lists from the ledger across many calls and created two byte-identical
 * branches of the same parent while freezing nothing. The information needed to
 * act had already been obtained (searchMap, matrix and taskEvidence had all
 * succeeded); what was missing was a durable record that the decision had been
 * MADE, so the next stretch of turns re-opened the analysis instead of building.
 *
 * Four properties are enforced because each was a defect in this reader's first
 * draft, and each defect would have replaced a survey with a false clearance:
 *
 *   1. Only ENOENT means absent. A permission or I/O failure must surface as
 *      `unreadable` with its code, because "I could not read the record" and
 *      "there is no record" imply opposite actions.
 *   2. `complete` is not four non-empty strings. The same fields the mechanism
 *      slate requires are required here: supporting evidence, counter-evidence,
 *      the deferred alternatives with their reasons, the parent rationale, the
 *      uncertainty, the expected correctness, the regression surface, the
 *      resource feasibility and what the experiment distinguishes. A record that
 *      states only a parent and a target is a survey, not a decision.
 *   3. A submitted/settled decision resumes evaluation; it does not tell the
 *      optimizer to rebuild the candidate or resubmit the same bytes. The note
 *      therefore branches on the recorded lifecycle.
 *   4. The falsifier is returned in full with its character count. A silent
 *      truncation of the one field that says how the experiment could fail would
 *      make the record unusable for the decision it is supposed to support.
 *
 * `path` exists so the reader can be exercised against isolated fixtures. Tests
 * must never write the live author path; the first draft of this reader was
 * verified by overwriting /workspace/decision-state.json and left it malformed.
 */
const DECISION_PATH = '/workspace/decision-state.json';

const DECISION_REQUIRED = [
  ['selected.parent', (b) => nonEmptyString(getPath(b, 'selected.parent'))],
  ['selected.mechanism_family', (b) => nonEmptyString(getPath(b, 'selected.mechanism_family'))],
  ['selected.parent_rationale', (b) => nonEmptyString(getPath(b, 'selected.parent_rationale'))],
  ['selected.predicted_moves.target', (b) => nonEmptyString(getPath(b, 'selected.predicted_moves.target'))],
  ['selected.supporting_evidence', (b) => nonEmptyStringList(getPath(b, 'selected.supporting_evidence'))],
  ['selected.counter_evidence', (b) => nonEmptyString(getPath(b, 'selected.counter_evidence'))],
  ['selected.alternatives', (b) => deferredAlternatives(getPath(b, 'selected.alternatives'))],
  ['selected.expected_correctness', (b) => nonEmptyString(getPath(b, 'selected.expected_correctness'))],
  ['selected.regression_surface', (b) => nonEmptyString(getPath(b, 'selected.regression_surface'))],
  ['selected.resource_feasibility', (b) => nonEmptyString(getPath(b, 'selected.resource_feasibility'))],
  ['selected.distinguishes', (b) => nonEmptyString(getPath(b, 'selected.distinguishes'))],
  ['uncertainty', (b) => nonEmptyString(getPath(b, 'uncertainty'))],
  ['falsifier', (b) => nonEmptyString(getPath(b, 'falsifier'))],
];

function getPath(obj, path) {
  return path.split('.').reduce((o, k) => (o !== null && typeof o === 'object' ? o[k] : undefined), obj);
}

function nonEmptyString(v) {
  return typeof v === 'string' && v.trim().length > 0;
}

function nonEmptyStringList(v) {
  return Array.isArray(v) && v.length > 0 && v.every(nonEmptyString);
}

/** Every deferred alternative must name its reason; an unexplained deferral is not a comparison. */
function deferredAlternatives(v) {
  if (!Array.isArray(v) || v.length === 0) return false;
  return v.every((entry) => entry !== null && typeof entry === 'object'
    && nonEmptyString(entry.option) && nonEmptyString(entry.deferReason));
}

function decisionState(args) {
  const requested = args && typeof args.decisionPath === 'string' && args.decisionPath.length > 0
    ? args.decisionPath
    : '';
  const path = requested.length > 0 ? requested : DECISION_PATH;
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch (error) {
    const code = error && typeof error.code === 'string' ? error.code : 'unknown';
    if (code === 'ENOENT') {
      return {
        present: false, status: 'absent', path, lifecycle: '', parent: '', mechanism: '', target: '',
        falsifier: '', falsifierChars: 0, missingFields: [],
        note: 'no decision record at ' + path
          + ' - record the selected parent, mechanism, predicted task, supporting and counter evidence, the deferred alternatives, the falsifier and the risk fields BEFORE branching or editing a draft',
      };
    }
    return {
      present: true, status: 'unreadable', path, lifecycle: '', parent: '', mechanism: '', target: '',
      falsifier: '', falsifierChars: 0, missingFields: [],
      note: 'the decision record at ' + path + ' exists but could not be read (code ' + code + ': '
        + String(error && error.message ? error.message : error)
        + '). This is a read failure, not an absent record: fix access before deciding anything about the candidate.',
    };
  }
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    return {
      present: true, status: 'unparseable', path, lifecycle: '', parent: '', mechanism: '', target: '',
      falsifier: '', falsifierChars: 0, missingFields: [],
      note: 'the decision record at ' + path + ' is not valid JSON, so nothing can be read back from it',
    };
  }
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return {
      present: true, status: 'not-an-object', path, lifecycle: '', parent: '', mechanism: '', target: '',
      falsifier: '', falsifierChars: 0, missingFields: [],
      note: 'the decision record root must be a JSON object',
    };
  }
  const parent = nonEmptyString(getPath(body, 'selected.parent')) ? getPath(body, 'selected.parent') : '';
  const mechanism = nonEmptyString(getPath(body, 'selected.mechanism_family'))
    ? getPath(body, 'selected.mechanism_family')
    : '';
  const target = nonEmptyString(getPath(body, 'selected.predicted_moves.target'))
    ? getPath(body, 'selected.predicted_moves.target')
    : '';
  const falsifier = nonEmptyString(getPath(body, 'falsifier')) ? getPath(body, 'falsifier') : '';
  const missingFields = DECISION_REQUIRED.filter(([, check]) => !check(body)).map(([label]) => label);
  // Lifecycle: a frozen candidate is evaluated, never rebuilt. An unresolved
  // decision is still being surveyed and must not be frozen until it is filled.
  const submitted = getPath(body, 'submitted');
  const hasSubmitted = submitted !== null && typeof submitted === 'object'
    && nonEmptyString(submitted.candidate);
  const lifecycle = hasSubmitted ? 'submitted' : 'unresolved';
  const status = missingFields.length > 0
    ? 'incomplete'
    : (hasSubmitted ? 'complete-submitted' : 'complete');
  let note;
  // A KNOWN SUBMISSION DOMINATES ACTION GUIDANCE. Measured regression in the
  // previous draft: {selected:{parent:'a'}, submitted:{candidate:'<64hex>'}} came
  // back as lifecycle=submitted with status=incomplete and the note "Fill those ...
  // then build", i.e. missing metadata silently overrode the one fact that matters
  // most - these exact bytes are already frozen and running. Metadata gaps must
  // never instruct a rebuild or a resubmit, because both would spend a candidate
  // slot on bytes the ledger already holds.
  const candidate = hasSubmitted ? String(submitted.candidate) : '';
  if (hasSubmitted) {
    note = 'candidate ' + candidate.slice(0, 12) + ' is ALREADY FROZEN'
      + (parent.length > 0 ? ' for parent ' + parent.slice(0, 12) : '')
      + (mechanism.length > 0 ? ' (mechanism ' + mechanism + ')' : '')
      + (target.length > 0 ? ', predicted target ' + target : '')
      + '. Resume its remaining evaluation, or read its settled result and decide the next candidate; NEVER rebuild or resubmit these bytes.'
      + (missingFields.length > 0
        ? ' The record metadata is additionally incomplete (' + missingFields.join(', ')
          + '): correct the record so the next decision can be checked, but that is a documentation gap, not a licence to rebuild.'
        : '');
  } else if (missingFields.length > 0) {
    note = 'the decision record is missing or does not support ' + missingFields.join(', ')
      + '. Fill those from evidence already in hand, then build; non-empty strings are not evidence sufficiency and a record without them is a survey, not a decision.';
  } else {
    note = 'a decision is recorded: parent ' + parent.slice(0, 12) + ', mechanism ' + mechanism
      + ', predicted target ' + target + '. Build that decision now; do not re-open the survey.';
  }
  return {
    present: true,
    status,
    path,
    lifecycle,
    parent,
    mechanism,
    target,
    falsifier,
    falsifierChars: falsifier.length,
    missingFields,
    note,
  };
}

const METHOD_INSTRUMENT_PARAMETERS = {
  type: 'object',
  additionalProperties: false,
  properties: {
    decisionPath: {
      type: 'string',
      description: 'Optional path to an ISOLATED decision-record fixture. Omit to read the live /workspace/decision-state.json; never write the live record from a test.',
    },
  },
};

/**
 * CANONICAL DECISION WRITER.
 *
 * Why this exists as code rather than as more prose: the reader above validates
 * thirteen fields, and this author produced a record that failed it three times in
 * a row in one session - first with `selected.parentReason` instead of
 * `selected.parent_rationale` and no root `falsifier` (so the reader said
 * "incomplete" while the author believed a decision was written), then with
 * `counter_evidence` as an array, then with `alternatives` as free-text sentences
 * instead of `{option, deferReason}` objects. Each round cost a tool call and a
 * rewrite, and the drift was NOT laziness about prose: it was the author
 * reconstructing an schema from memory while the validator's exact shape lived in
 * source. Prose asking the author to be careful has now failed twice across
 * checkpoints. The fix is to make the correct shape the only shape that can be
 * written here: this tool takes the decision content, emits the exact structure the
 * reader validates, refuses to write a record that its own validator would call
 * incomplete, and returns the reader's verdict so the author never has to guess.
 *
 * It deliberately does NOT choose anything: parent, family, target, evidence and
 * falsifier are all supplied by the caller. It only refuses malformed containers.
 */
const DECISION_WRITE_PARAMETERS = {
  type: 'object',
  additionalProperties: false,
  properties: {
    path: {
      type: 'string',
      description: 'Optional target path for an ISOLATED fixture. Omit to write the live /workspace/decision-state.json.',
    },
    parent: { type: 'string', description: 'Exact parent digest this decision branches from.' },
    mechanismFamily: { type: 'string', description: 'prompt | tool | workflow | plugin-config | reuse | composition | other.' },
    mechanism: { type: 'string' },
    parentRationale: { type: 'string', description: 'Why THIS parent is the informative one, not that it is the default.' },
    predictedTarget: { type: 'string', description: 'The task id(s) the change is predicted to move: one id, or several comma-separated ids, or a named failure class with the ids you expect to move. A single id is not required - a mechanism may target a class.' },
    predictedDirection: { type: 'string', description: 'e.g. "fail -> pass".' },
    conditionalUpperBound: { type: 'string', description: 'Parent-relative best case. Count ONLY tasks the parent FAILS: tasks the parent already passes are retention, not gain, so they never enter the bound. State it as parent_count + (currently-failing tasks this change could flip).' },
    canaries: { type: 'array', items: { type: 'string' }, description: 'Currently-passing tasks this change could damage.' },
    supportingEvidence: { type: 'array', items: { type: 'string' } },
    counterEvidence: { type: 'string' },
    alternatives: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          option: { type: 'string' },
          deferReason: { type: 'string' },
        },
        required: ['option', 'deferReason'],
      },
    },
    expectedCorrectness: { type: 'string' },
    regressionSurface: { type: 'string' },
    resourceFeasibility: { type: 'string' },
    distinguishes: { type: 'string' },
    uncertainty: { type: 'string' },
    falsifier: { type: 'string', description: 'Root-level falsifier: the observable failed predictions. The reader uses THIS field, not a nested copy.' },
    notes: { type: 'string', description: 'Optional provenance, e.g. that the record was reconstructed after a branch.' },
    submittedCandidate: { type: 'string', description: 'Exact already-frozen candidate digest. When supplied, the record binds submitted.candidate so the reader reports complete-submitted and never instructs a rebuild.' },
    submittedOrdinal: { type: 'number', description: 'Ordinal of that frozen candidate, for the record only.' },
    newDecision: { type: 'boolean', description: 'Explicitly supersede a prior decision recorded at this path. Required to replace a record whose submitted identity differs; the prior record is retained under priorDecisions. Omit for initial creation or correction of the same decision.' },
  },
  required: [
    'parent', 'mechanismFamily', 'mechanism', 'parentRationale', 'predictedTarget',
    'supportingEvidence', 'counterEvidence', 'alternatives', 'expectedCorrectness',
    'regressionSurface', 'resourceFeasibility', 'distinguishes', 'uncertainty', 'falsifier',
  ],
};

// The output schema must declare EXACTLY what the implementation returns. The first
// draft returned the whole decisionState() object while declaring eight of its
// eleven keys, so a native output validator rejected every successful write - the
// tool appeared to fail precisely when it had worked. `present`, `path` and
// `falsifier` are part of the reader's verdict and are now declared; `decision` is
// returned by spreading the reader's object so the two cannot drift again.
const DECISION_WRITE_OUTPUT = {
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      written: { type: 'boolean' },
      path: { type: 'string' },
      preserved: { type: 'boolean' },
      decision: {
        type: 'object',
        additionalProperties: false,
        properties: {
          present: { type: 'boolean' },
          status: { type: 'string' },
          lifecycle: { type: 'string' },
          path: { type: 'string' },
          parent: { type: 'string' },
          mechanism: { type: 'string' },
          target: { type: 'string' },
          falsifier: { type: 'string' },
          falsifierChars: { type: 'number' },
          missingFields: { type: 'array', items: { type: 'string' } },
          note: { type: 'string' },
        },
        required: [
          'present', 'status', 'lifecycle', 'path', 'parent', 'mechanism', 'target',
          'falsifier', 'falsifierChars', 'missingFields', 'note',
        ],
      },
    },
    required: ['written', 'path', 'preserved', 'decision'],
  },
  /**
   * REQUIRED BY THE NATIVE REGISTRY, and its absence is what rejected revision
   * b8641751 at load. `ctx.tools.register()` validates
   * `output { schema, render, presentationMeta? }` and THROWS when `render` is
   * not a function (dsh-tools/lib/index.js:2977). The schema was correct and the
   * tool executed correctly in the isolated fixture harness - because that
   * harness replaced the real registry with a stub that never ran this check -
   * so the package looked tested while it could not load at all. Every other
   * instrument here already declares render; only this one did not.
   *
   * It renders the reader's verdict, because that verdict is the thing the caller
   * must not misread: whether a record was written, whether a frozen candidate
   * identity was preserved, and whether the method now considers the decision
   * complete. It adds no field the output schema does not declare.
   */
  render(_args, value) {
    const v = value;
    const d = v.decision;
    const lines = [
      (v.written ? 'decision record written' : 'decision record NOT written') + ': ' + v.path,
      'reader verdict: ' + d.status + ' / ' + d.lifecycle
        + (d.missingFields.length > 0 ? ' (unsupported: ' + d.missingFields.join(', ') + ')' : ''),
      'parent: ' + (d.parent || '(none)')
        + ' | mechanism: ' + (d.mechanism || '(none)')
        + ' | predicted target: ' + (d.target || '(none)'),
      'falsifier (' + d.falsifierChars + ' chars): ' + (d.falsifier || '(none)'),
      v.decision.lifecycle === 'submitted'
        ? 'frozen candidate identity: RECORDED for this decision'
          + (v.preserved ? ' (carried forward from the prior record)' : '')
        : 'frozen candidate identity: none - this decision is not yet frozen',
      d.note,
    ];
    return [{ type: 'text', text: lines.join('\n') }];
  },
};

function recordDecisionValue(args) {
  const target = typeof args.path === 'string' && args.path.length > 0
    ? args.path
    : DECISION_PATH;

  // TYPE EXACTNESS, not coercion. An array passed to a string field used to be
  // joined with ' | ' so that a wrong call silently "worked"; that hides a caller
  // bug behind a plausible-looking record. Reject the wrong type and say what was
  // received, before anything is written.
  const mustBeString = ['parent', 'mechanismFamily', 'mechanism', 'parentRationale',
    'predictedTarget', 'counterEvidence', 'expectedCorrectness', 'regressionSurface',
    'resourceFeasibility', 'distinguishes', 'uncertainty', 'falsifier'];
  for (const field of mustBeString) {
    if (typeof args[field] !== 'string' || args[field].trim().length === 0) {
      throw new Error(`recordDecision: field ${field} must be a non-empty string; received ${describeType(args[field])}. `
        + 'Types are rejected, never coerced: a joined array or stringified object would look like a valid record.');
    }
  }
  if (!Array.isArray(args.supportingEvidence) || args.supportingEvidence.length === 0
    || args.supportingEvidence.some((e) => typeof e !== 'string' || e.trim().length === 0)) {
    throw new Error('recordDecision: supportingEvidence must be a non-empty array of non-empty strings.');
  }
  if (!Array.isArray(args.alternatives) || args.alternatives.length === 0) {
    throw new Error('recordDecision: alternatives must be a non-empty array of {option, deferReason} objects.');
  }
  for (const [i, alt] of args.alternatives.entries()) {
    if (alt === null || typeof alt !== 'object' || Array.isArray(alt)
      || typeof alt.option !== 'string' || alt.option.trim().length === 0
      || typeof alt.deferReason !== 'string' || alt.deferReason.trim().length === 0) {
      throw new Error(`recordDecision: alternatives[${i}] must be an object with non-empty option and deferReason; `
        + 'free-text sentences lost the deferral reason and cannot be checked.');
    }
  }

  // LIFECYCLE PRESERVATION. Measured defect: writing a record with
  // submittedCandidate=<digest>, then correcting the SAME decision while omitting
  // that argument, overwrote a frozen-candidate record with an unresolved one and
  // silently erased the submitted identity - the single fact that stops the next
  // session re-branching bytes the ledger already holds. A correction must either
  // carry that identity forward or refuse; it may never quietly drop it. A genuinely
  // new decision has to say so explicitly, and the prior decision is retained.
  //
  // PRESERVATION, not absence. The read that decides what a write may replace used
  // to be a catch-all: any read error, and any unparseable file, was treated as
  // "no prior record", and the write then replaced real bytes. The host reproduced
  // it on this exact source - existing bytes `{malformed` followed by a valid call
  // returned SUCCESS and destroyed the file (malformedRejected=false,
  // malformedPreserved=false). Only ENOENT can mean absence. A parse failure, a
  // permission failure, a directory at the path, or an existing root that is not a
  // JSON object must all throw BEFORE a single byte is written, because the caller
  // still holds the old record and can inspect it, while an overwrite cannot be
  // undone by anything in this tool.
  let prior = null;
  let priorText = null;
  try {
    priorText = readFileSync(target, 'utf8');
  } catch (error) {
    const code = error && typeof error.code === 'string' ? error.code : 'unknown';
    if (code !== 'ENOENT') {
      throw new Error(
        `recordDecision: the decision record at ${target} exists but could not be read (code ${code}: `
        + `${String(error && error.message ? error.message : error)}). Refusing to write: an unreadable record is `
        + 'NOT an absent one, and replacing it would destroy a decision this tool cannot even see. '
        + 'Fix the path or the permissions first; nothing has been modified.',
      );
    }
    priorText = null; // ENOENT: genuinely absent, so this call is an initial creation.
  }
  if (priorText !== null) {
    try {
      prior = JSON.parse(priorText);
    } catch (error) {
      throw new Error(
        `recordDecision: the decision record at ${target} exists but is not valid JSON `
        + `(${String(error && error.message ? error.message : error)}). Refusing to write: corruption is not `
        + 'absence, and overwriting would silently discard whatever the file still contains. '
        + 'Inspect and repair (or move aside) the file first, or target a different path; nothing has been modified.',
      );
    }
    if (prior === null || typeof prior !== 'object' || Array.isArray(prior)) {
      throw new Error(
        `recordDecision: the decision record at ${target} exists but its root is `
        + `${Array.isArray(prior) ? 'an array' : describeType(prior)}, not a JSON object. Refusing to write: the `
        + 'reader treats a non-object root as nothing, so a write over it would both destroy the existing bytes '
        + 'and produce a record this method would still not trust. Nothing has been modified.',
      );
    }
  }
  const priorSubmitted = prior && typeof prior === 'object' && prior.submitted
    && typeof prior.submitted === 'object' && typeof prior.submitted.candidate === 'string'
    ? prior.submitted
    : null;
  const givenSubmitted = typeof args.submittedCandidate === 'string' && args.submittedCandidate.length > 0;
  const newDecision = args.newDecision === true;

  if (priorSubmitted && !givenSubmitted && !newDecision) {
    throw new Error(
      `recordDecision: refusing to overwrite a record whose submitted.candidate is ${priorSubmitted.candidate}. `
      + 'This decision is already frozen and its identity must not be erased by a correction that omits it. '
      + 'Pass submittedCandidate again to correct the same decision, or set newDecision=true to supersede it '
      + '(the prior decision is then retained under priorDecisions).',
    );
  }
  if (priorSubmitted && givenSubmitted && priorSubmitted.candidate !== args.submittedCandidate && !newDecision) {
    throw new Error(
      `recordDecision: conflicting submitted identity: the record already claims ${priorSubmitted.candidate} `
      + `and this call claims ${args.submittedCandidate}. A conflicting identity is not a correction; `
      + 'pass newDecision=true only if these are genuinely different decisions.',
    );
  }
  if (priorSubmitted && givenSubmitted && priorSubmitted.candidate !== args.submittedCandidate && newDecision) {
    throw new Error(
      'recordDecision: a new decision cannot claim a DIFFERENT already-frozen candidate in the same record. '
      + `The record holds ${priorSubmitted.candidate}; the call claims ${args.submittedCandidate}. `
      + 'Use a separate record path for a separate decision.',
    );
  }

  // Build the history BEFORE the record literal so every write path sees the same
  // list: correction preserves it unchanged, explicit transition appends one entry.
  const history = decisionHistory(prior, newDecision, target);

  const record = {
    selected: {
      parent: args.parent,
      mechanism_family: args.mechanismFamily,
      mechanism: args.mechanism,
      parent_rationale: args.parentRationale,
      predicted_moves: {
        target: args.predictedTarget,
        direction: typeof args.predictedDirection === 'string' ? args.predictedDirection : '',
        conditionalUpperBound: typeof args.conditionalUpperBound === 'string' ? args.conditionalUpperBound : '',
        canaries: Array.isArray(args.canaries) ? args.canaries : [],
      },
      supporting_evidence: args.supportingEvidence,
      // The reader requires a STRING here, and the type check above enforces it.
      // There is no join: converting an array would have hidden a caller bug.
      counter_evidence: args.counterEvidence,
      alternatives: args.alternatives,
      expected_correctness: args.expectedCorrectness,
      regression_surface: args.regressionSurface,
      resource_feasibility: args.resourceFeasibility,
      distinguishes: args.distinguishes,
    },
    uncertainty: args.uncertainty,
    // ROOT LEVEL, and written from the caller's falsifier unchanged: a nested copy
    // plus a stale root copy is exactly the bug this checkpoint hit.
    falsifier: args.falsifier,
    recordedAt: new Date().toISOString(),
    // A FROZEN CANDIDATE IS EVALUATED, NEVER REBUILT. Binding the identity here
    // is what makes the reader say complete-submitted instead of asking for a
    // build: a missing submitted block is metadata drift that reads as "the
    // decision is unresolved", and an author who trusts it re-branches bytes the
    // ledger already holds.
    ...(typeof args.submittedCandidate === 'string' && args.submittedCandidate.length > 0
      ? { submitted: { candidate: args.submittedCandidate, ...(typeof args.submittedOrdinal === 'number' ? { ordinal: args.submittedOrdinal } : {}) } }
      : {}),
    ...(typeof args.notes === 'string' && args.notes.length > 0 ? { provenance: { notes: args.notes } } : {}),
    // DECISION HISTORY IS NOT A PROPERTY OF ONE TRANSITION. Two measured losses:
    // (a) priorDecisions was built only inside `newDecision && prior`, so an ORDINARY
    // correction of a record that had a history dropped it - the host reproduced
    // 1 -> 0 after "submitted b, newDecision=true, then correct the new decision";
    // (b) appending `prior` whole carried prior.priorDecisions INSIDE the new entry,
    // so successive explicit transitions duplicated every earlier decision at a
    // growing depth. History is now a FLAT list that every write carries forward;
    // an explicit transition appends exactly one snapshot of the decision it
    // supersedes, with the nested priorDecisions stripped and identity-deduplicated.
    ...(history.length > 0 ? { priorDecisions: history } : {}),
  };
  // Refuse to write a record this method's own reader would call incomplete. This
  // is the whole point: the schema check runs BEFORE the file exists, so a wrong
  // shape cannot be mistaken for a recorded decision.
  const missing = DECISION_REQUIRED.filter(([, check]) => !check(record)).map(([label]) => label);
  if (missing.length > 0) {
    throw new Error(
      'recordDecision: refusing to write an incomplete record; a record that fails the reader is worse than none, '
      + `because it looks like a decision. Unsupported: ${missing.join(', ')}`,
    );
  }
  writeFileSync(target, JSON.stringify(record, null, 2) + '\n', 'utf8');
  const decision = decisionState({ decisionPath: target });
  // Spread the reader's object: every key it returns is declared in the output
  // schema, and adding a key to the reader later cannot silently break the contract.
  return { written: true, path: target, preserved: priorSubmitted !== null, decision: { ...decision } };
}

/**
 * The retained decision history for the record about to be written.
 *
 * HISTORY BELONGS TO THE FILE, NOT TO THE TRANSITION. Measured on revision 21:
 * after "submitted b, newDecision=true (no submitted identity), then correct the new
 * decision with newDecision=false", priorDecisions went 1 -> 0, because the array was
 * only assembled inside the `newDecision && prior` branch. An ordinary correction
 * must carry the file's existing history forward untouched.
 *
 * NO HEURISTIC IDENTITY. An earlier draft deduplicated entries by
 * `recordedAt + falsifier` and the host reproduced the consequence: two genuinely
 * DIFFERENT decisions that happened to share a timestamp and a falsifier collapsed
 * into one, and a real retained decision was silently discarded. A "key" assembled
 * from two convenient fields is exactly how a preservation tool loses evidence, so
 * dedup is gone: every explicit transition appends ONE complete flat snapshot of the
 * decision it supersedes (nested `priorDecisions` stripped, nothing else removed), and
 * a correction never edits the list.
 *
 * INVALID EXISTING HISTORY IS AN ERROR, NEVER A FILTER. The host also reproduced
 * `priorDecisions: [null, <earlier>]` being silently filtered to `[<earlier>]` by an
 * ordinary correction, i.e. the file was rewritten with evidence deleted. Anything
 * that is not an array of JSON objects now throws before a byte is written; the
 * caller holds the original file and can inspect it, which is the only safe outcome
 * for a record the tool does not fully understand.
 */
function decisionHistory(prior, newDecision, target) {
  if (prior === null || typeof prior !== 'object' || !Object.hasOwn(prior, 'priorDecisions')) {
    return newDecision && prior !== null && typeof prior === 'object' ? [flatSnapshot(prior)] : [];
  }
  const held = prior.priorDecisions;
  if (!Array.isArray(held)) {
    throw new Error(
      `recordDecision: the decision record at ${target} has a priorDecisions field that is `
      + `${Array.isArray(held) ? 'an array' : describeType(held)}, not an array of retained decisions. `
      + 'Refusing to write: rewriting it would either delete retained history or invent one. '
      + 'Inspect and repair (or move aside) the file first; nothing has been modified.',
    );
  }
  for (const [i, entry] of held.entries()) {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error(
        `recordDecision: the decision record at ${target} has priorDecisions[${i}] of type `
        + `${entry === null ? 'null' : Array.isArray(entry) ? 'array' : typeof entry}, not a retained decision object. `
        + 'Refusing to write: filtering an unreadable history entry would silently delete evidence, and coercing it '
        + 'would invent evidence. Inspect and repair (or move aside) the file first; nothing has been modified.',
      );
    }
  }
  // EXISTING ENTRIES ARE PRESERVED VERBATIM. An earlier draft mapped every held
  // entry through the flattener, and the host reproduced the loss: an older decision
  // that lived only inside `old.priorDecisions` disappeared on an ordinary
  // correction, because nothing proves a nested decision is duplicated at top level.
  // Only the NEWLY appended snapshot of the current record drops its own
  // `priorDecisions`, because that exact list is already carried here.
  if (!newDecision) return held;
  return [...held, flatSnapshot(prior)];
}

/**
 * One retained decision, flattened. Its own retained history is not copied into it:
 * that is what made successive transitions duplicate every earlier decision one level
 * deeper. Every other field is preserved verbatim.
 */
function flatSnapshot(entry) {
  const { priorDecisions: _nested, ...rest } = entry;
  return rest;
}


/** Small type describer so a rejection message names what the caller actually sent. */
function describeType(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v;
}

/** One instrument reading; `injected` is the load evidence the optimizer reads back. */
function instrumentValue(args) {
  const elapsed = Math.round((Date.now() - START) / 100) / 10;
  return {
    method: 'evolution-research-method',
    revision: 24,
    injected: [...inject],
    sessionElapsedSeconds: elapsed,
    sessionElapsedMinutes: Math.round(elapsed / 6) / 10,
    measuredAt: new Date().toISOString(),
    handoff: handoffShape(),
    decision: decisionState(args),
  };
}

/**
 * Pacing reading. Reads an optional evolution_status artifact, never writes it.
 *
 * The three fields exist because the pacing rule branches on them and prose was
 * not enough: seconds elapsed, how many candidates the contract admits, and
 * whether anything has been frozen yet in this session's ledger view.
 * `highestOrdinal` is the newest ordinal the artifact carries, `contractCap` is the
 * cap the objective text declares when it can be parsed, and `newestCandidate` is
 * the digest/phase that ordinal belongs to - the three facts the pacing rule
 * branches on. When no status
 * artifact is supplied, `ledger` says "unread" and the counts are omitted rather
 * than reported as zero, because a zero would be indistinguishable from a measured
 * absence of submissions.
 */
function paceValue(args) {
  const elapsed = Math.round((Date.now() - START) / 100) / 10;
  const value = {
    method: 'evolution-research-method',
    revision: 24,
    sessionElapsedSeconds: elapsed,
    sessionElapsedMinutes: Math.round(elapsed / 6) / 10,
    measuredAt: new Date().toISOString(),
    ledger: 'unread',
    note: 'No evolution_status artifact supplied; pass statusFile to read whether anything is frozen.',
  };
  const statusFile = typeof args.statusFile === 'string' ? args.statusFile : '';
  if (statusFile.length === 0) return value;
  let status;
  try {
    status = extractStatusObject(readFileSync(statusFile, 'utf8'));
  } catch (e) {
    value.ledger = 'unreadable';
    value.note = 'Could not parse the status artifact: ' + String(e && e.message ? e.message : e)
      + '. That is a read failure, not evidence about the candidate.';
    return value;
  }
  const candidates = Array.isArray(status.candidates) ? status.candidates : [];
  const order = candidates.map((c) => c.ordinal);
  const newest = candidates.length > 0
    ? candidates.reduce((a, b) => ((b.ordinal ?? -1) > (a.ordinal ?? -1) ? b : a))
    : undefined;
  const text = status.specification && typeof status.specification.objective === 'string'
    ? status.specification.objective
    : '';
  const capMatch = text.match(/admits up to (\d+) total H candidates/i);
  value.ledger = 'read';
  value.candidateCount = candidates.length;
  const ordinals = order.filter((n) => typeof n === 'number');
  // Absent is an explicit `null`: the native output gate rejects an own property
  // whose value is undefined as lossy JSON, and 0 would read as a measured ordinal.
  value.highestOrdinal = ordinals.length > 0 ? Math.max(...ordinals) : null;
  if (capMatch) value.contractCap = Number(capMatch[1]);
  if (newest) {
    value.newestCandidate = {
      digest: String(newest.digest),
      ordinal: newest.ordinal,
      phase: String(newest.phase),
    };
  }
  value.note = value.highestOrdinal === null
    ? 'Ledger read but carries no ordinal; cannot tell whether this session froze anything.'
    : 'Highest frozen ordinal in this view is ' + value.highestOrdinal
      + '. Compare it with the ordinal you saw at session start: unchanged means nothing has been frozen yet.';
  return value;
}

/**
 * Per-task summary instrument (revision 19).
 *
 * WHY THIS EXISTS, measured rather than intended. In checkpoint 017 of this study
 * the optimizer needed three questions that `matrix` and `searchMap` do not answer
 * from one spill, and re-derived their arithmetic by hand in ad-hoc python passes:
 * (1) over the candidates that actually have a FULL panel, what is the per-task
 * solve count, so a champion miss solved by 11 of 14 full candidates can be told
 * apart from one solved by 1 of 14 - `matrix` counts raw solvers, so a ledger with
 * 47 mostly-partial candidates reports 43 solvers for a task that only 11 of the 14
 * full panels pass; (2) what exactly does each recent candidate gain and lose
 * against the champion per task, for several candidates at once over the same miss
 * set, where `matrix` diffs only one named candidate; and (3) which champion misses
 * the study has already solved somewhere, ranked by that full-panel rate.
 *
 * What it does NOT do: it selects nothing, scores nothing, re-runs nothing and
 * never returns a task answer - only candidate digests, task ids and counts. A
 * candidate is panelComplete only when it has a terminal observation for every
 * manifest task; a partial line is reported as a coverage count and excluded from
 * the rate, never silently normalised into one.
 */
function perTaskSummaryValue(args) {
  let statusText = '';
  if (typeof args.statusFile === 'string' && args.statusFile.length > 0) {
    statusText = readFileSync(args.statusFile, 'utf8');
  } else if (typeof args.status === 'string') {
    statusText = args.status;
  } else {
    throw new Error('perTaskSummary: pass statusFile (path to the spilled evolution_status text) or status');
  }
  const status = extractStatusObject(statusText);
  const mat = buildMatrix(status);
  const champion = typeof args.candidate === 'string' && args.candidate.length > 0
    ? args.candidate
    : status.champion;
  if (typeof champion !== 'string' || champion.length === 0) {
    throw new Error('perTaskSummary: no champion in the status and no candidate arg given');
  }
  // Candidate identity is a CONTRACT, not a hint. The first native use of this
  // tool passed short prefixes ("692511ea", "b60d26cc", "ded8c99a") and it answered
  // with three 0/180 rows: stateOf() returns 'missing' for a digest it never saw,
  // every task became "unobserved and excluded", and a fabricated empty summary was
  // printed for a candidate that does not exist. That output is indistinguishable
  // from a real candidate that failed to deliver, which is the most expensive class
  // of wrong evidence this study can produce - it reports "0/180, net 0" for bytes
  // that were never compared. Unknown, abbreviated or malformed identities are now
  // rejected BEFORE any summary is built. No prefix guessing is added: a prefix is
  // exactly the ambiguity that produced the false rows, and resolving one would
  // silently compare the wrong candidate.
  const known = new Set(mat.order);
  if (typeof args.candidate === 'string' && args.candidate.length > 0 && !known.has(args.candidate)) {
    throw new Error(
      `perTaskSummary: unknown candidate '${args.candidate}'. Use a full canonical digest from the ledger `
      + `(${known.size} candidates are known). An unknown identity is not a candidate with zero passes; `
      + 'abbreviated or prefixed digests are not resolved.',
    );
  }
  const compare = Array.isArray(args.compare)
    ? args.compare.filter((d) => typeof d === 'string' && d.length > 0 && d !== champion).slice(0, 8)
    : [];
  const unknownCompare = compare.filter((d) => !known.has(d));
  if (unknownCompare.length > 0) {
    throw new Error(
      `perTaskSummary: unknown candidate(s) in compare: ${unknownCompare.join(', ')}. `
      + `Every entry must be a full canonical digest from the ledger (${known.size} candidates are known). `
      + 'An unknown identity is not a candidate with zero passes; abbreviated or prefixed digests are not '
      + 'resolved, and silently dropping one would make a comparison look complete when a requested cell is missing.',
    );
  }

  // Panel completeness is about TERMINAL observations only. A queued, executing,
  // delivered or scoring run is neither a pass nor a fail nor a small panel: it is
  // an unobserved outcome. Counting it as observed (the first draft of this tool
  // did, using `stateOf(...) !== 'missing'`) promoted a candidate that had observed
  // 2 of 2 tasks with 1 pass and 1 executing to a "full panel" and moved pending
  // work into the denominator, which is exactly the denominator error the method
  // text forbids. Measured against a synthetic two-candidate fixture during native
  // review: expected fullPanelCount 1, actual 2. Terminal, pending and missing are
  // therefore counted separately and only terminal==tasks grants a full panel.
  const panel = mat.order.map((digest) => {
    let terminal = 0;
    let pending = 0;
    let missing = 0;
    for (const task of mat.tasks) {
      const s = stateOf(mat, digest, task);
      if (s === 'pending') pending += 1;
      else if (s === 'missing') missing += 1;
      else terminal += 1;
    }
    return { digest, terminal, pending, missing, complete: terminal === mat.tasks.length };
  });
  const fullPanel = panel.filter((p) => p.complete).map((p) => p.digest);

  const rows = [];
  for (const task of mat.tasks) {
    const champState = stateOf(mat, champion, task);
    // An unobserved champion outcome is not a miss, and a champion PASS is not a
    // repair target; only terminal non-pass outcomes are listed.
    if (champState === 'pass' || champState === 'pending' || champState === 'missing') continue;
    let fullPass = 0;
    for (const digest of fullPanel) if (stateOf(mat, digest, task) === 'pass') fullPass += 1;
    let anyPass = 0;
    for (const digest of mat.order) {
      if (digest !== champion && stateOf(mat, digest, task) === 'pass') anyPass += 1;
    }
    rows.push({ task, champion: champState, fullPanelPass: fullPass, anyPass });
  }
  rows.sort((a, b) => (b.fullPanelPass - a.fullPanelPass) || a.task.localeCompare(b.task));

  const flips = compare.map((digest) => {
    const gained = [];
    const lost = [];
    let unobserved = 0;
    for (const task of mat.tasks) {
      const a = stateOf(mat, champion, task);
      const b = stateOf(mat, digest, task);
      if (a === 'pending' || b === 'pending' || a === 'missing' || b === 'missing') {
        unobserved += 1;
        continue;
      }
      if (a !== 'pass' && b === 'pass') gained.push(task);
      else if (a === 'pass' && b !== 'pass') lost.push(task);
    }
    gained.sort();
    lost.sort();
    const summary = summarizeCandidate(mat, digest);
    return {
      candidate: digest,
      pass: summary.pass,
      gained,
      lost,
      net: gained.length - lost.length,
      unobserved,
    };
  });

  return {
    champion,
    manifestSize: mat.tasks.length,
    fullPanelCount: fullPanel.length,
    fullPanelCandidates: fullPanel,
    partialPanelCount: panel.filter((p) => !p.complete).length,
    // Pending and never-started work is reported as its own number: an executing
    // task is not a zero-quality observation and must never be quoted as one.
    pendingObservationCount: panel.reduce((n, p) => n + p.pending + p.missing, 0),
    championMisses: rows.slice(0, 40),
    championMissesTotal: rows.length,
    flips,
  };
}

const PER_TASK_MISS_ROW = {
  type: 'object',
  additionalProperties: false,
  properties: {
    task: { type: 'string' },
    champion: { type: 'string' },
    fullPanelPass: { type: 'number' },
    anyPass: { type: 'number' },
  },
  required: ['task', 'champion', 'fullPanelPass', 'anyPass'],
};

const PER_TASK_FLIP = {
  type: 'object',
  additionalProperties: false,
  properties: {
    candidate: { type: 'string' },
    pass: { type: 'number' },
    gained: { type: 'array', items: { type: 'string' } },
    lost: { type: 'array', items: { type: 'string' } },
    net: { type: 'number' },
    unobserved: { type: 'number' },
  },
  required: ['candidate', 'pass', 'gained', 'lost', 'net', 'unobserved'],
};

const PER_TASK_SUMMARY_OUTPUT = {
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      champion: { type: 'string' },
      manifestSize: { type: 'number' },
      fullPanelCount: { type: 'number' },
      fullPanelCandidates: { type: 'array', items: { type: 'string' } },
      partialPanelCount: { type: 'number' },
      pendingObservationCount: { type: 'number' },
      championMisses: { type: 'array', items: PER_TASK_MISS_ROW },
      championMissesTotal: { type: 'number' },
      flips: { type: 'array', items: PER_TASK_FLIP },
    },
    required: [
      'champion',
      'manifestSize',
      'fullPanelCount',
      'fullPanelCandidates',
      'partialPanelCount',
      'pendingObservationCount',
      'championMisses',
      'championMissesTotal',
      'flips',
    ],
  },
  render(_args, value) {
    const v = value;
    const lines = [];
    lines.push('per-task summary against champion ' + v.champion.slice(0, 12)
      + ' over ' + v.manifestSize + ' tasks; ' + v.fullPanelCount
      + ' candidate(s) have a full panel'
      + (v.partialPanelCount > 0
        ? '; ' + v.partialPanelCount + ' have a partial panel and are excluded from the rate'
        : '')
      + (v.pendingObservationCount > 0
        ? '; ' + v.pendingObservationCount + ' observation(s) are pending or missing - unobserved, never zero quality'
        : ''));
    lines.push('champion misses (' + v.championMissesTotal
      + '), ranked by how many FULL-panel candidates pass them:');
    for (const m of v.championMisses.slice(0, 30)) {
      lines.push('  ' + m.task + '  champ=' + m.champion
        + '  fullPanel=' + m.fullPanelPass + '/' + v.fullPanelCount
        + '  anyCandidate=' + m.anyPass);
    }
    if (v.championMissesTotal > v.championMisses.length) {
      lines.push('  ... ' + (v.championMissesTotal - v.championMisses.length) + ' more not shown');
    }
    for (const f of v.flips) {
      lines.push('flip ' + f.candidate.slice(0, 12) + ': ' + f.pass + '/' + v.manifestSize
        + ', net ' + f.net + ' (gained ' + f.gained.length + ', lost ' + f.lost.length + ')'
        + (f.unobserved > 0 ? ', ' + f.unobserved + ' unobserved and excluded' : ''));
      lines.push('  gained: ' + (f.gained.length ? f.gained.join(', ') : '(none)'));
      lines.push('  lost:   ' + (f.lost.length ? f.lost.join(', ') : '(none)'));
    }
    return [{ type: 'text', text: lines.join('\n') }];
  },
};

const PER_TASK_SUMMARY_PARAMETERS = {
  type: 'object',
  additionalProperties: false,
  properties: {
    statusFile: { type: 'string', description: 'Path to the spilled evolution_status text.' },
    status: { type: 'string', description: 'Inline status JSON, for small ledgers only.' },
    candidate: { type: 'string', description: 'Candidate digest to treat as champion; defaults to the ledger champion.' },
    compare: {
      type: 'array',
      items: { type: 'string' },
      description: 'Up to 8 candidate digests to diff against the champion, per task, gained and lost.',
    },
  },
  required: ['statusFile'],
};

const PACE_PARAMETERS = {
  type: 'object',
  additionalProperties: false,
  properties: {
    statusFile: {
      type: 'string',
      description: 'Path to the spilled evolution_status text. Omit to read only the session clock.',
    },
  },
};

const PACE_OUTPUT = {
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      method: { type: 'string' },
      revision: { type: 'number' },
      sessionElapsedSeconds: { type: 'number' },
      sessionElapsedMinutes: { type: 'number' },
      measuredAt: { type: 'string' },
      ledger: { type: 'string' },
      candidateCount: { type: 'number' },
      highestOrdinal: { oneOf: [{ type: 'number' }, { type: 'null' }] },
      contractCap: { type: 'number' },
      newestCandidate: {
        type: 'object',
        additionalProperties: false,
        properties: {
          digest: { type: 'string' },
          ordinal: { type: 'number' },
          phase: { type: 'string' },
        },
        required: ['digest', 'ordinal', 'phase'],
      },
      note: { type: 'string' },
    },
    required: ['method', 'revision', 'sessionElapsedSeconds', 'sessionElapsedMinutes', 'measuredAt', 'ledger', 'note'],
  },
  render(_args, value) {
    const v = value;
    const lines = [
      'pace: ' + v.sessionElapsedSeconds + 's (' + v.sessionElapsedMinutes + ' min) at ' + v.measuredAt,
      'ledger: ' + v.ledger,
    ];
    if (typeof v.candidateCount === 'number') lines.push('candidates in view: ' + v.candidateCount);
    if (typeof v.highestOrdinal === 'number') lines.push('highest ordinal: ' + v.highestOrdinal);
    if (typeof v.contractCap === 'number') lines.push('contract cap: ' + v.contractCap);
    if (v.newestCandidate) {
      lines.push('newest: ' + v.newestCandidate.digest.slice(0, 12) + ' (ordinal '
        + v.newestCandidate.ordinal + ', ' + v.newestCandidate.phase + ')');
    }
    lines.push(v.note);
    return [{ type: 'text', text: lines.join('\n') }];
  },
};

const INSTRUMENT_OUTPUT = {
  /**
   * Raw compiled JSON Schema subset that ctx.tools.register() validates
   * directly (assertSupportedJsonSchema). required is the object-level array
   * on the "object" node only; per-property required markers are rejected by
   * the raw-schema walker (native load QA of revision 3).
   */
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      method: { type: 'string' },
      revision: { type: 'number' },
      injected: { type: 'array', items: { type: 'string' } },
      sessionElapsedSeconds: { type: 'number' },
      sessionElapsedMinutes: { type: 'number' },
      measuredAt: { type: 'string' },
      handoff: {
        type: 'object',
        additionalProperties: false,
        properties: {
          present: { type: 'boolean' },
          status: { type: 'string' },
          action: { type: 'string' },
          extra: { type: 'array', items: { type: 'string' } },
          missing: { type: 'array', items: { type: 'string' } },
          note: { type: 'string' },
        },
        required: ['present', 'status', 'action', 'extra', 'missing', 'note'],
      },
      decision: {
        type: 'object',
        additionalProperties: false,
        properties: {
          present: { type: 'boolean' },
          status: { type: 'string' },
          path: { type: 'string' },
          lifecycle: { type: 'string' },
          parent: { type: 'string' },
          mechanism: { type: 'string' },
          target: { type: 'string' },
          falsifier: { type: 'string' },
          falsifierChars: { type: 'number' },
          missingFields: { type: 'array', items: { type: 'string' } },
          note: { type: 'string' },
        },
        required: ['present', 'status', 'path', 'lifecycle', 'parent', 'mechanism', 'target', 'falsifier', 'falsifierChars', 'missingFields', 'note'],
      },
    },
    required: ['method', 'revision', 'injected', 'sessionElapsedSeconds', 'sessionElapsedMinutes', 'measuredAt', 'handoff', 'decision'],
  },
  render(_args, value) {
    const v = value;
    const lines = [
      'method ' + v.method + ' revision ' + v.revision,
      'injected services: ' + v.injected.join(', '),
      'session elapsed: ' + v.sessionElapsedSeconds + 's (' + v.sessionElapsedMinutes + ' min) at ' + v.measuredAt,
    ];
    if (v.handoff !== undefined) {
      lines.push('checkpoint handoff: ' + v.handoff.status + (v.handoff.action ? ' (action ' + v.handoff.action + ')' : ''));
      lines.push('  ' + v.handoff.note);
    }
    if (v.decision !== undefined) {
      lines.push('decision record: ' + v.decision.status);
      lines.push('  ' + v.decision.note);
    }
    return [{ type: 'text', text: lines.join('\n') }];
  },
};

/**
 * Register the two instruments. Registration is a hard requirement of this plugin:
 * a failure here fails the load instead of being swallowed, because the method text
 * tells the optimizer to rely on these tools.
 * @param ctx owning optimizer context.
 */
function registerInstruments(ctx) {
  const tools = ctx.tools;
  if (tools === undefined || typeof tools.register !== 'function') {
    throw new Error('evolution-research-method: tools service unavailable; cannot register checkpoint/methodInstrument');
  }
  ctx.effect(() => tools.register({
    name: 'checkpoint',
    description:
      'Report the real wall-clock time elapsed in this optimizer session. Call it before making any claim about remaining budget, phase duration or how long a step took, and before deciding that evidence collection may continue.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    output: INSTRUMENT_OUTPUT,
    execute: async () => instrumentValue(),
  }), 'evolution-research-method: checkpoint tool');

  ctx.effect(() => tools.register({
    name: 'matrix',
    description:
      'Compute the cross-candidate per-task matrix from an evolution_status artifact without re-parsing spilled JSON by hand. Pass statusFile = the path of the spilled status text; the champion defaults to the ledger champion and can be overridden with candidate. Returns the champion settled count over the whole manifest, the misses ranked by how many other candidates solve them, the tasks only the champion solves, the tasks nobody solves, per-candidate counts, and with against=<digest> the gained/lost task lists against that candidate.',
    parameters: MATRIX_PARAMETERS,
    output: MATRIX_OUTPUT,
    execute: async (args) => matrixValue(args),
  }), 'evolution-research-method: matrix tool');

  ctx.effect(() => tools.register({
    name: 'taskEvidence',
    description:
      'Route a missed task to its delivered bytes: given the spilled evolution_status path and a task id, return the champion run id for that task plus the run ids of the other candidates that already pass it. Replaces hand-parsing the ledger to find run ids before evolution_materialize. Returns ids and digests only, never task answers.',
    parameters: TASK_EVIDENCE_PARAMETERS,
    output: TASK_EVIDENCE_OUTPUT,
    execute: async (args) => taskEvidenceValue(args),
  }), 'evolution-research-method: taskEvidence tool');

  ctx.effect(() => tools.register({
    name: 'mechanism',
    description:
      'Record and check the mechanism-selection slate for the next candidate, using the same criteria for prompt, tool, workflow, plugin-config, reuse and composition options. Requires each option to name its observed failure mechanism, the evidence and the counter-evidence for it, its uncertainty, expected correctness impact, regression surface, what the experiment distinguishes, an explicit feasibility of true/false/unknown with a reason, and a selected-or-deferred disposition with a reason when deferred. It flags an option whose shared-failure check is unstated and one whose feasibility is unknown. Family is a recorded label only: the tool never validates it against a threshold, counts families, or weights them, so a one-family slate is legitimate when the alternatives were considered and deferred with reasons. It does not choose and does not score.',
    parameters: MECHANISM_PARAMETERS,
    output: MECHANISM_OUTPUT,
    execute: async (args) => mechanismValue(args),
  }), 'evolution-research-method: mechanism tool');

  ctx.effect(() => tools.register({
    name: 'recordDecision',
    description:
      'Write the decision record in the EXACT shape this method validates, so the shape cannot drift: it takes the decision content (parent, mechanism family, predicted target, supporting and counter evidence, deferred alternatives with reasons, expected correctness, regression surface, resource feasibility, what it distinguishes, uncertainty and the ROOT falsifier), refuses to write a record its own reader would call incomplete, writes it, and returns the reader verdict. The root falsifier is written from the caller unchanged - there is no nested copy to go stale. It chooses nothing: every field is supplied by the caller; only malformed containers are rejected. Optional path is for ISOLATED fixtures; omit it for the live /workspace/decision-state.json.',
    parameters: DECISION_WRITE_PARAMETERS,
    output: DECISION_WRITE_OUTPUT,
    execute: async (args) => recordDecisionValue(args),
  }), 'evolution-research-method: recordDecision tool');

  ctx.effect(() => tools.register({
    name: 'methodInstrument',
    description:
      'Verify that this research method loaded: returns its revision and the services it actually injected, the shape of any checkpoint handoff already written, and the decision-state record (status, lifecycle, missing fields, full falsifier). Call it once per session; if it is unavailable, the harness did not load this plugin. The optional decisionPath exists only to inspect an ISOLATED fixture: never point it at the live record and never write the live record from a test.',
    parameters: METHOD_INSTRUMENT_PARAMETERS,
    output: INSTRUMENT_OUTPUT,
    execute: async (args) => instrumentValue(args),
  }), 'evolution-research-method: methodInstrument tool');

  ctx.effect(() => tools.register({
    name: 'pace',
    description:
      'Read the session clock and, with statusFile, whether anything has been frozen yet: seconds elapsed, candidate count in view, the highest ordinal, the contract cap the objective text declares, and the newest candidate. Call it before collecting more evidence and before any decision about continuing analysis; a ledger whose highest ordinal is unchanged from session start means this session has frozen nothing. Omit statusFile to read only the clock. It reports, never submits or chooses.',
    parameters: PACE_PARAMETERS,
    output: PACE_OUTPUT,
    execute: async (args) => paceValue(args),
  }), 'evolution-research-method: pace tool');

  ctx.effect(() => tools.register({
    name: 'searchMap',
    description:
      'Report what this study has actually been doing, from a spilled evolution_status artifact: per candidate its every recorded parent, ordinal, settled pass count, gained/lost/unobserved counts against its primary parent (unobserved outcomes are excluded, never counted as misses), its relationship to the current champion, its exact recorded claim, and its measured median/p90 run time. Derives parent concentration, the pace-versus-quality split, the frozen-assembly relation to the primary parent (identity only, not a changed-file count), and the plateau numbers: how many tasks at least one candidate passes, how many champion misses are already solved by some other candidate, how many are unsolved by every OBSERVED candidate, and how many remain unresolved because some outcome is not observed. It reports concentration only - it never selects, never scores and never re-runs a task.',
    parameters: SEARCH_MAP_PARAMETERS,
    output: SEARCH_MAP_OUTPUT,
    execute: async (args) => searchMapValue(args),
  }), 'evolution-research-method: searchMap tool');

  ctx.effect(() => tools.register({
    name: 'perTaskSummary',
    description:
      'One spill, three answers the other instruments do not give: (1) the champion misses ranked by how many candidates with a FULL 180-task panel pass them, with the raw solver count beside it, so a task 11 of 14 full panels solve is not confused with one 1 of 14 solves; (2) per-task gained/lost lists for up to 8 named candidates against the champion at once; (3) which champion misses the study has already solved somewhere. Partial-panel candidates are counted and excluded from the rate rather than silently changing the denominator, and an unobserved outcome is excluded from a diff, never counted as a miss. It selects nothing, scores nothing and re-runs nothing.',
    parameters: PER_TASK_SUMMARY_PARAMETERS,
    output: PER_TASK_SUMMARY_OUTPUT,
    execute: async (args) => perTaskSummaryValue(args),
  }), 'evolution-research-method: perTaskSummary tool');
}

export function apply(ctx) {
  ctx.systemPrompt.section({
    name: 'evolution-research-method',
    order: 500,
    interpolate: false,
    text: METHOD_TEXT,
  });
  registerInstruments(ctx);
}
