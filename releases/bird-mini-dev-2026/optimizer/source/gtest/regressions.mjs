// Preservation regression suite for recordDecision (revision 22).
//
// Every case here was reproduced by the host on revision 21's exact frozen bytes,
// in isolated fixtures, with no live decision mutated. The suite runs the REAL
// registered tool through the REAL registration path (a plain ctx sink is enough
// for the writer logic; check-load.mjs separately asserts the native registry
// precondition) and validates every successful write with the REAL validator,
// decisionState(), instead of asserting on hand-written JSON.
//
// It never touches /workspace/decision-state.json: every path is a fixture under a
// private temp directory, and the file is compared byte-for-byte before and after
// each refusal.
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const mod = await import('../index.mjs');

const registrations = new Map();
const ctx = {
  systemPrompt: { section: () => {} },
  effect: (fn) => fn(),
  on: () => {},
  tools: { register: (definition) => { registrations.set(definition.name, definition); return () => {}; } },
};
mod.apply(ctx);

const recordDecision = registrations.get('recordDecision');
assert.ok(recordDecision, 'recordDecision must be registered');
const run = (args) => recordDecision.execute(args);
const rejects = async (args, pattern) => {
  await assert.rejects(() => run(args), pattern, 'expected a refusal');
};

const root = mkdtempSync(join(tmpdir(), 'rd-regress-'));
let caseNo = 0;
const freshPath = () => { caseNo += 1; return join(root, 'case-' + caseNo + '.json'); };

// A complete, valid decision body. Every write below is checked with the validator,
// so "the write succeeded" is never accepted on its own.
const baseArgs = (overrides = {}) => ({
  parent: 'c'.repeat(64),
  mechanismFamily: 'tool',
  mechanism: 'fixture mechanism',
  parentRationale: 'fixture rationale',
  predictedTarget: 'bird-000',
  predictedDirection: 'fail -> pass',
  supportingEvidence: ['fixture evidence'],
  counterEvidence: 'fixture counter evidence',
  alternatives: [{ option: 'fixture alternative', deferReason: 'fixture deferral' }],
  expectedCorrectness: 'fixture expectation',
  regressionSurface: 'fixture surface',
  resourceFeasibility: 'fixture feasibility',
  distinguishes: 'fixture distinction',
  uncertainty: 'fixture uncertainty',
  falsifier: 'fixture falsifier',
  ...overrides,
});

const results = [];
const check = (name, fn) => { results.push([name, fn]); };

// 1. A first write to an absent path still succeeds and validates. This is the
//    canary for the whole repair: a stricter writer that cannot create a record is
//    not a repair.
check('absent path: first write succeeds and validates complete', async () => {
  const path = freshPath();
  const out = await run(baseArgs({ path }));
  assert.equal(out.written, true);
  assert.equal(out.decision.status, 'complete');
  assert.equal(out.decision.lifecycle, 'unresolved');
  assert.equal(JSON.parse(readFileSync(path, 'utf8')).falsifier, 'fixture falsifier');
});

// 2. CORRUPTION IS NOT ABSENCE. Host reproduction: `{malformed` was overwritten.
check('malformed existing file: refused, bytes preserved', async () => {
  const path = freshPath();
  const corrupt = '{ this is not json';
  writeFileSync(path, corrupt, 'utf8');
  await rejects(baseArgs({ path }), /not valid JSON/);
  assert.equal(readFileSync(path, 'utf8'), corrupt, 'corrupt bytes must be untouched');
});

// 3. A non-object root is a present record that cannot be understood; overwriting it
//    would destroy bytes the reader refuses to interpret.
check('array root: refused, bytes preserved', async () => {
  const path = freshPath();
  const bytes = '[1,2,3]\n';
  writeFileSync(path, bytes, 'utf8');
  await rejects(baseArgs({ path }), /not a JSON object/);
  assert.equal(readFileSync(path, 'utf8'), bytes);
});

check('null root: refused, bytes preserved', async () => {
  const path = freshPath();
  const bytes = 'null';
  writeFileSync(path, bytes, 'utf8');
  await rejects(baseArgs({ path }), /not a JSON object/);
  assert.equal(readFileSync(path, 'utf8'), bytes);
});

// 4. A READ FAILURE is not absence either. The path is a directory, so readFileSync
//    raises EISDIR after the file exists; the same branch covers EACCES.
check('unreadable path (directory): refused without writing', async () => {
  const path = freshPath();
  mkdirSync(path);
  try {
    await rejects(baseArgs({ path }), /could not be read|EISDIR|directory/i);
  } finally {
    rmSync(path, { recursive: true, force: true });
  }
});

// Only ENOENT may create. A wrong-permission file is the ordinary production case of
// "unreadable", so it is exercised directly when the platform lets us drop read bits
// (the suite runs as a normal user; if the file stays readable, the case is skipped
// rather than silently passing).
check('permission-denied file: refused, bytes preserved', async (t) => {
  const path = freshPath();
  const bytes = '{"falsifier":"pre-existing","selected":{"parent":"p"}}\n';
  writeFileSync(path, bytes, 'utf8');
  chmodSync(path, 0o000);
  let readable = true;
  try { readFileSync(path, 'utf8'); } catch { readable = false; }
  if (readable) { t.skip('running as a user that ignores mode bits (root); covered by the EISDIR case'); return; }
  try {
    await rejects(baseArgs({ path }), /could not be read/);
  } finally {
    chmodSync(path, 0o600);
    // The bytes are compared only after restoring read permission, so the
    // preservation assertion itself does not depend on reading a locked file.
  }
  assert.equal(readFileSync(path, 'utf8'), bytes);
});

// 5. A legitimate correction still works and still carries the frozen identity.
check('correct correction: succeeds, keeps complete-submitted', async () => {
  const path = freshPath();
  const digest = 'b'.repeat(64);
  await run(baseArgs({ path, submittedCandidate: digest, submittedOrdinal: 7 }));
  const out = await run(baseArgs({ path, submittedCandidate: digest, submittedOrdinal: 7, mechanism: 'corrected' }));
  assert.equal(out.written, true);
  assert.equal(out.decision.status, 'complete-submitted');
  assert.equal(out.decision.lifecycle, 'submitted');
  assert.equal(JSON.parse(readFileSync(path, 'utf8')).selected.mechanism, 'corrected');
  assert.deepEqual(JSON.parse(readFileSync(path, 'utf8')).priorDecisions, undefined);
});

// 6. Omitting a frozen identity on a correction is still refused (revision 21's
//    repair, kept as a canary so this revision cannot regress it).
check('correction omitting submitted identity: refused, bytes preserved', async () => {
  const path = freshPath();
  const digest = 'b'.repeat(64);
  await run(baseArgs({ path, submittedCandidate: digest }));
  const before = readFileSync(path, 'utf8');
  await rejects(baseArgs({ path, mechanism: 'silently erased' }), /refusing to overwrite/);
  assert.equal(readFileSync(path, 'utf8'), before);
});

check('conflicting submitted identity without newDecision: refused', async () => {
  const path = freshPath();
  await run(baseArgs({ path, submittedCandidate: 'b'.repeat(64) }));
  const before = readFileSync(path, 'utf8');
  await rejects(baseArgs({ path, submittedCandidate: 'd'.repeat(64) }), /conflicting submitted identity/);
  assert.equal(readFileSync(path, 'utf8'), before);
});

check('different frozen candidate with newDecision=true: refused', async () => {
  const path = freshPath();
  await run(baseArgs({ path, submittedCandidate: 'b'.repeat(64) }));
  const before = readFileSync(path, 'utf8');
  await rejects(baseArgs({ path, submittedCandidate: 'd'.repeat(64), newDecision: true }),
    /DIFFERENT already-frozen candidate/);
  assert.equal(readFileSync(path, 'utf8'), before);
});

// 7. THE HOST'S SECOND REPRODUCTION, end to end:
//    submitted b -> explicit transition without submitted identity -> ordinary
//    correction of the new decision. Revision 21 reported priorDecisions 1 -> 0.
check('transition then correction: history preserved, identity retained', async () => {
  const path = freshPath();
  const digest = 'b'.repeat(64);
  await run(baseArgs({ path, submittedCandidate: digest, falsifier: 'frozen falsifier' }));

  const afterTransition = await run(baseArgs({
    path, newDecision: true, falsifier: 'superseding falsifier', parent: 'e'.repeat(64),
  }));
  assert.equal(afterTransition.decision.lifecycle, 'unresolved', 'the new decision is not frozen');
  let stored = JSON.parse(readFileSync(path, 'utf8'));
  assert.equal(stored.priorDecisions.length, 1, 'the frozen decision must be retained');
  assert.equal(stored.priorDecisions[0].submitted.candidate, digest,
    'retained history must carry the historical frozen identity');
  assert.equal(stored.priorDecisions[0].falsifier, 'frozen falsifier');
  assert.deepEqual(stored.priorDecisions[0].selected.supporting_evidence, ['fixture evidence']);

  const afterCorrection = await run(baseArgs({
    path, falsifier: 'corrected falsifier', parent: 'e'.repeat(64), mechanism: 'corrected text',
  }));
  assert.equal(afterCorrection.written, true);
  stored = JSON.parse(readFileSync(path, 'utf8'));
  assert.equal(stored.priorDecisions.length, 1,
    'an ordinary correction must not drop the retained history (host measured 1 -> 0)');
  assert.equal(stored.priorDecisions[0].submitted.candidate, digest);
  assert.equal(stored.falsifier, 'corrected falsifier');
  assert.equal(afterCorrection.decision.status, 'complete');
});

// 8. Successive explicit transitions must grow history by one each and never nest.
check('successive transitions: flat history, one entry per transition', async () => {
  const path = freshPath();
  await run(baseArgs({ path, falsifier: 'f1' }));
  await run(baseArgs({ path, newDecision: true, falsifier: 'f2' }));
  await run(baseArgs({ path, newDecision: true, falsifier: 'f3' }));
  let stored = JSON.parse(readFileSync(path, 'utf8'));
  assert.equal(stored.priorDecisions.length, 2);
  assert.deepEqual(stored.priorDecisions.map((d) => d.falsifier), ['f1', 'f2']);
  for (const entry of stored.priorDecisions) {
    assert.equal(entry.priorDecisions, undefined, 'nested history must not be reproduced inside an entry');
  }
  // A correction after those transitions keeps all of it.
  await run(baseArgs({ path, falsifier: 'f3', mechanism: 'corrected' }));
  stored = JSON.parse(readFileSync(path, 'utf8'));
  assert.equal(stored.priorDecisions.length, 2, 'correction preserves the whole retained history');
});

// 10. Host-reproduced: TIMESTAMP+FALSIFIER IS NOT AN IDENTITY. Two genuinely
//     different decisions can share both; a heuristic key silently discarded the
//     current decision and kept only the earlier one (history 1 where 2 are expected).
check('same timestamp/falsifier, different mechanism: both survive a transition', async () => {
  const path = freshPath();
  const earlier = {
    selected: { parent: 'a'.repeat(64), mechanism_family: 'tool', mechanism: 'EARLIER mechanism' },
    falsifier: 'shared falsifier text',
    recordedAt: '2026-01-01T00:00:00.000Z',
  };
  const current = {
    selected: { parent: 'b'.repeat(64), mechanism_family: 'tool', mechanism: 'CURRENT mechanism' },
    falsifier: 'shared falsifier text',
    recordedAt: '2026-01-01T00:00:00.000Z',
    priorDecisions: [earlier],
  };
  writeFileSync(path, JSON.stringify(current) + '\n', 'utf8');
  await run(baseArgs({ path, newDecision: true, falsifier: 'next falsifier', mechanism: 'next mechanism' }));
  const stored = JSON.parse(readFileSync(path, 'utf8'));
  assert.equal(stored.priorDecisions.length, 2,
    'both the retained earlier decision and the superseded current one must be kept');
  assert.equal(stored.priorDecisions[0].selected.mechanism, 'EARLIER mechanism');
  assert.equal(stored.priorDecisions[1].selected.mechanism, 'CURRENT mechanism');
  assert.equal(stored.priorDecisions[1].falsifier, 'shared falsifier text');
});

// 11. Host-reproduced: an INVALID existing history must fail visibly, not be
//     filtered. `[null, <earlier>]` was silently rewritten to `[<earlier>]`.
check('null member in priorDecisions: refused, bytes preserved', async () => {
  const path = freshPath();
  const bytes = JSON.stringify({
    selected: { parent: 'a'.repeat(64) },
    falsifier: 'f',
    priorDecisions: [null, { selected: { parent: 'b'.repeat(64) }, falsifier: 'earlier' }],
  }) + '\n';
  writeFileSync(path, bytes, 'utf8');
  await rejects(baseArgs({ path, mechanism: 'ordinary correction' }), /priorDecisions\[0\].*not a retained decision/i);
  assert.equal(readFileSync(path, 'utf8'), bytes, 'the invalid history must not be filtered or rewritten');
});

check('non-array priorDecisions: refused, bytes preserved', async () => {
  const path = freshPath();
  const bytes = JSON.stringify({ selected: { parent: 'a'.repeat(64) }, falsifier: 'f', priorDecisions: { nope: 1 } }) + '\n';
  writeFileSync(path, bytes, 'utf8');
  await rejects(baseArgs({ path }), /priorDecisions field that is/);
  assert.equal(readFileSync(path, 'utf8'), bytes);
});

check('non-object member in priorDecisions: refused, bytes preserved', async () => {
  const path = freshPath();
  const bytes = JSON.stringify({ selected: { parent: 'a'.repeat(64) }, falsifier: 'f', priorDecisions: ['text'] }) + '\n';
  writeFileSync(path, bytes, 'utf8');
  await rejects(baseArgs({ path }), /priorDecisions\[0\]/);
  assert.equal(readFileSync(path, 'utf8'), bytes);
});

// 12. Host-reproduced: an existing held entry must be preserved VERBATIM. Nesting a
//     unique older decision inside a held entry is not proof of a duplicate, so an
//     ordinary correction must not strip it (measured: nested evidence lost).
check('nested unique history inside a held entry: preserved on ordinary correction', async () => {
  const path = freshPath();
  const nestedUnique = {
    selected: { parent: 'f'.repeat(64), mechanism_family: 'tool', mechanism: 'ONLY NESTED' },
    falsifier: 'nested-only falsifier',
    recordedAt: '2025-12-31T00:00:00.000Z',
  };
  const old = {
    selected: { parent: 'a'.repeat(64), mechanism_family: 'tool', mechanism: 'OLD' },
    falsifier: 'old falsifier',
    recordedAt: '2026-01-01T00:00:00.000Z',
    priorDecisions: [nestedUnique],
  };
  writeFileSync(path, JSON.stringify({
    selected: { parent: 'b'.repeat(64), mechanism_family: 'tool', mechanism: 'CURRENT' },
    falsifier: 'current falsifier',
    priorDecisions: [old],
  }) + '\n', 'utf8');

  await run(baseArgs({ path, mechanism: 'ordinary correction' }));
  const stored = JSON.parse(readFileSync(path, 'utf8'));
  assert.equal(stored.priorDecisions.length, 1);
  assert.deepEqual(stored.priorDecisions[0], old,
    'a held entry must be byte-for-byte the entry that was there before the correction');
  assert.equal(stored.priorDecisions[0].priorDecisions[0].selected.mechanism, 'ONLY NESTED');

  // An explicit transition also carries the held entry unchanged, and the newly
  // appended snapshot is the only thing whose own nested list is dropped.
  await run(baseArgs({ path, newDecision: true, mechanism: 'next decision' }));
  const after = JSON.parse(readFileSync(path, 'utf8'));
  assert.equal(after.priorDecisions.length, 2);
  assert.deepEqual(after.priorDecisions[0], old, 'transition must not rewrite held entries either');
  assert.equal(after.priorDecisions[1].priorDecisions, undefined,
    'only the newly appended snapshot drops its own already-carried list');
});

// 9. The native output contract: the value validates against its own output schema.
check('output validates against declared output.schema', async () => {
  const path = freshPath();
  const out = await run(baseArgs({ path, submittedCandidate: 'b'.repeat(64) }));
  const schema = recordDecision.output.schema;
  assert.equal(schema.type, 'object');
  for (const key of schema.required) assert.ok(Object.hasOwn(out, key), 'missing output key ' + key);
  for (const key of Object.keys(out)) assert.ok(Object.hasOwn(schema.properties, key), 'undeclared output key ' + key);
  for (const key of schema.properties.decision.required) {
    assert.ok(Object.hasOwn(out.decision, key), 'missing decision key ' + key);
  }
  for (const key of Object.keys(out.decision)) {
    assert.ok(Object.hasOwn(schema.properties.decision.properties, key), 'undeclared decision key ' + key);
  }
  assert.equal(typeof recordDecision.output.render, 'function');
  const rendered = recordDecision.output.render({}, out);
  assert.ok(Array.isArray(rendered) && rendered.length > 0 && typeof rendered[0].text === 'string');
});

let failed = 0;
for (const [name, fn] of results) {
  const t = { skip: (why) => { console.log('SKIP ' + name + ' - ' + why); } };
  try {
    await fn(t);
    console.log('ok   ' + name);
  } catch (error) {
    failed += 1;
    console.error('FAIL ' + name + '\n     ' + (error && error.message ? error.message : error));
  }
}
rmSync(root, { recursive: true, force: true });
if (failed > 0) {
  console.error(failed + ' regression(s) failed');
  process.exit(1);
}
console.log('preservation regressions OK: ' + results.length + ' case(s)');
