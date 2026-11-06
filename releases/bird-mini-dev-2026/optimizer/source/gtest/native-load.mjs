// NATIVE LOAD + DISPATCH verification (revision 22).
//
// Why this file exists: the previous G revision shipped a tool that failed real
// native load QA while every isolated fixture passed, because the fixture replaced
// `tools.register` with a sink that never ran the registry precondition. So this
// script does NOT stub the registry. It builds a real Cordis Context with the real
// `dsh-system-prompt` and `dsh-tools` services, applies the plugin exactly as the
// loader does, and then executes each read-only instrument through the real tool
// dispatcher and validates the returned value against its own declared output
// schema - the two things a sink cannot prove.
//
// Run: node gtest/native-load.mjs   (requires the native packages on NODE_PATH;
// the build container has none, which is why this is not part of `npm run build`.)
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const { Context } = await import('@deepseek-ai/cordis');
const SystemPrompt = (await import('@deepseek-ai/dsh-system-prompt')).default;
const Tools = (await import('@deepseek-ai/dsh-tools')).default;
const mod = await import('../index.mjs');

const ctx = new Context();
await ctx.plugin(SystemPrompt, {});
await ctx.plugin(Tools, {});
await ctx.plugin({ inject: mod.inject, apply: mod.apply }, {});

// 1. Every registered tool must satisfy the precondition the native registry
//    enforces, read back from the LIVE service rather than from our own sink.
const names = ['checkpoint', 'methodInstrument', 'matrix', 'taskEvidence', 'mechanism',
  'recordDecision', 'pace', 'searchMap', 'perTaskSummary'];
const live = new Map();
for (const name of names) {
  const tool = ctx.tools.get?.(name) ?? ctx.tools.tools?.get?.(name);
  assert.ok(tool, 'tool ' + name + ' is not registered on the live native service');
  live.set(name, tool);
  assert.equal(typeof tool.output?.render, 'function', name + ' must declare output.render');
  assert.ok(tool.output?.schema && typeof tool.output.schema === 'object', name + ' must declare output.schema');
  assert.equal(tool.output.schema.type, 'object', name + ' output.schema root must be an object');
  assert.ok(tool.parameters && typeof tool.parameters === 'object', name + ' must declare parameters');
}
console.log('native load OK: ' + live.size + ' tool(s) registered on the real tools service');

// 2. Execute the read-only instruments through the REAL dispatcher and validate the
//    results against their own output schemas. A fixture that never dispatches can
//    pass while the tool cannot run at all.
// The native registry's executor takes ONE typed exec object (name, arguments,
// callId, signal), not (name, args). Arguments must be losslessly JSON-serializable.
let callSeq = 0;
const call = async (name, args) => ctx.tools.execute({
  callId: 'gtest-call-' + (++callSeq),
  name,
  arguments: args ?? {},
  signal: new AbortController().signal,
});

// The dispatcher runs the definition's `execute` and then the definition's
// `output.render`, so the content is the RENDERED text, not the raw value. The raw
// value is what `execute` returns and what the registry validates against
// output.schema; both halves are exercised, and the render text is asserted to be
// exactly what the declared render produces for that value.
const dispatch = async (name, args, opts = {}) => {
  const definition = live.get(name);
  const value = await definition.execute(args ?? {});
  const result = await call(name, args);
  const blocks = Array.isArray(result) ? result : result?.content;
  assert.ok(Array.isArray(blocks) && blocks.length > 0, name + ' returned no content block');
  const text = blocks.map((b) => b.text ?? '').join('\n');
  const expected = definition.output.render(args ?? {}, value)
    .map((b) => b.text ?? '').join('\n');
  // Renders that print a live clock or a fresh timestamp cannot be compared byte for
  // byte across two calls; strip only those timing tokens and require the rest to
  // match exactly, so a structural render drift still fails.
  const timing = (t) => t
    .replace(/\d{4}-\d{2}-\d{2}T[0-9:.]+Z/g, '<ts>')
    .replace(/(\d+(?:\.\d+)?)s \(/g, '<elapsed>s (')
    .replace(new RegExp('session elapsed: [^\\n]*'), 'session elapsed: <clock>')
    .replace(new RegExp('at <ts>[^\\n]*'), 'at <ts>');
  // recordDecision MUTATES the path it describes, so two executions legitimately
  // render different `preserved` lines; for it the render is only required to name
  // the path and the verdict, and the byte-level assertions live in the fixtures.
  if (opts.compareRender === false) {
    assert.ok(text.includes(value.path), name + ' render must name the written path');
    assert.ok(/reader verdict: /.test(text), name + ' render must report the reader verdict');
  } else {
    assert.equal(timing(text), timing(expected),
      name + ' dispatcher content must be the declared render output');
  }
  return { result, value, text };
};

const validate = (name, value) => {
  const schema = live.get(name).output.schema;
  const walk = (node, v, path) => {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'object') {
      assert.ok(v !== null && typeof v === 'object' && !Array.isArray(v), path + ' must be an object');
      for (const key of node.required ?? []) assert.ok(Object.hasOwn(v, key), path + '.' + key + ' missing');
      if (node.additionalProperties === false) {
        for (const key of Object.keys(v)) {
          assert.ok(Object.hasOwn(node.properties ?? {}, key), path + '.' + key + ' is undeclared');
        }
      }
      for (const [key, child] of Object.entries(node.properties ?? {})) {
        if (Object.hasOwn(v, key)) walk(child, v[key], path + '.' + key);
      }
      return;
    }
    if (node.type === 'array') {
      assert.ok(Array.isArray(v), path + ' must be an array');
      for (const [i, item] of v.entries()) walk(node.items, item, path + '[' + i + ']');
      return;
    }
    if (node.type === 'number') assert.equal(typeof v, 'number', path + ' must be a number');
    if (node.type === 'string') assert.equal(typeof v, 'string', path + ' must be a string');
    if (node.type === 'boolean') assert.equal(typeof v, 'boolean', path + ' must be a boolean');
  };
  walk(schema, value, name);
};

// methodInstrument: the load evidence the next session reads back.
{
  const { value } = await dispatch('methodInstrument', {});
  validate('methodInstrument', value);
  assert.equal(value.revision, 24, 'revision must report this source');
  assert.ok(value.injected.includes('systemPrompt') && value.injected.includes('tools'));
  assert.ok(['absent', 'complete', 'complete-submitted', 'incomplete'].includes(value.decision.status)
    || typeof value.decision.status === 'string');
  console.log('methodInstrument OK: revision ' + value.revision + ', decision status ' + value.decision.status);
}

// recordDecision against an ISOLATED fixture, then re-read it through the live path.
{
  const dir = mkdtempSync(join(tmpdir(), 'rd-native-'));
  const path = join(dir, 'decision.json');
  const args = {
    path,
    parent: 'c'.repeat(64),
    mechanismFamily: 'tool',
    mechanism: 'native dispatch fixture',
    parentRationale: 'native dispatch fixture',
    predictedTarget: 'bird-000',
    supportingEvidence: ['native fixture'],
    counterEvidence: 'native fixture',
    alternatives: [{ option: 'native alternative', deferReason: 'native deferral' }],
    expectedCorrectness: 'native fixture',
    regressionSurface: 'native fixture',
    resourceFeasibility: 'native fixture',
    distinguishes: 'native fixture',
    uncertainty: 'native fixture',
    falsifier: 'native fixture falsifier',
    submittedCandidate: 'b'.repeat(64),
  };
  const { value } = await dispatch('recordDecision', args, { compareRender: false });
  validate('recordDecision', value);
  assert.equal(value.written, true);
  assert.equal(value.decision.status, 'complete-submitted');

  // Corruption must now be REFUSED through the real dispatcher, not merely in the
  // isolated fixture harness.
  writeFileSync(path, '{corrupt', 'utf8');
  const failed = await call('recordDecision', args).catch((error) => error);
  if (failed instanceof Error) {
    assert.match(String(failed.message), /not valid JSON/);
  } else {
    // The registry materializes tool-body failures as a structured error result
    // instead of throwing; either surface is acceptable as long as it is a refusal.
    const text = JSON.stringify(failed);
    assert.ok(failed?.isError === true || /not valid JSON/i.test(text), 'a corrupt record must be refused, got ' + text);
  }
  assert.equal(readFileSync(path, 'utf8'), '{corrupt', 'corrupt bytes must be preserved');

  // History: explicit transition then ordinary correction keeps the retained entry.
  const fresh = join(dir, 'history.json');
  const { submittedCandidate: _omit, ...unfrozen } = args;
  await call('recordDecision', { ...args, path: fresh });
  await call('recordDecision', { ...unfrozen, path: fresh, newDecision: true, falsifier: 'second' });
  await call('recordDecision', { ...unfrozen, path: fresh, falsifier: 'second', mechanism: 'corrected' });
  const stored = JSON.parse(readFileSync(fresh, 'utf8'));
  assert.equal(stored.priorDecisions.length, 1, 'history must survive an ordinary correction');
  assert.equal(stored.priorDecisions[0].submitted.candidate, 'b'.repeat(64));
  console.log('recordDecision OK: native write, corrupt-refusal and history preservation verified');
  rmSync(dir, { recursive: true, force: true });
}

// pace / matrix / searchMap / perTaskSummary on a small synthetic status file: these
// are the instruments the next session read-back depends on, so a dispatcher-level
// smoke test is worth one fixture.
{
  const dir = mkdtempSync(join(tmpdir(), 'st-native-'));
  const statusPath = join(dir, 'status.json');
  const tasks = ['bird-001', 'bird-002', 'bird-003'];
  const mkCandidate = (digest, ordinal, scores) => ({
    digest, ordinal, phase: ordinal === 1 ? 'scored' : 'scored',
    name: 'c' + ordinal,
    runs: scores.map((score, i) => ({
      task: tasks[i], phase: 'scored', score, candidate: digest, attempt: 0,
    })),
  });
  const status = {
    champion: 'a'.repeat(64),
    cursor: { experimentId: 'x', viewDigest: 'y', sequence: 1 },
    specification: { objective: 'admits up to 9 total H candidates' },
    candidates: [
      mkCandidate('a'.repeat(64), 0, [1, 0, 1]),
      mkCandidate('b'.repeat(64), 1, [1, 1, 0]),
    ],
  };
  writeFileSync(statusPath, JSON.stringify(status), 'utf8');
  for (const [name, args] of [
    ['pace', { statusFile: statusPath }],
    ['matrix', { statusFile: statusPath }],
    ['searchMap', { statusFile: statusPath }],
    ['perTaskSummary', { statusFile: statusPath }],
  ]) {
    const { value } = await dispatch(name, args);
    validate(name, value);
    console.log('dispatch OK: ' + name);
  }
  rmSync(dir, { recursive: true, force: true });
}

console.log('native verification complete');
