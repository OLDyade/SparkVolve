import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const mod = await import(new URL('../index.mjs', import.meta.url).pathname);
const reg = new Map();
mod.apply({
  systemPrompt: { section: () => {} }, effect: (fn) => fn(), on: () => {},
  tools: { register: (d) => { reg.set(d.name, d); return () => {}; } },
});
const rd = reg.get('recordDecision');
const dir = mkdtempSync(join(tmpdir(), 'class-target-'));
const base = {
  mechanismFamily: 'prompt', mechanism: 'class mechanism',
  parentRationale: 'why', supportingEvidence: ['e'], counterEvidence: 'c',
  alternatives: [{ option: 'o', deferReason: 'd' }],
  expectedCorrectness: 'x', regressionSurface: 'r', resourceFeasibility: 'f',
  distinguishes: 'd', uncertainty: 'u', falsifier: 'falsifier text',
};
// A FAILURE-CLASS target with several ids must be recordable (revision 23).
const classTarget = 'entity-grain denominator class: bird-411, bird-499, bird-318';
const out = await rd.execute({ ...base, path: join(dir, 'a.json'), parent: 'a'.repeat(64), predictedTarget: classTarget });
assert.equal(out.written, true);
assert.equal(out.decision.target, classTarget, 'the class target must survive verbatim, not be truncated to one id');
console.log('class target recorded OK:', out.decision.target);
// A recombination candidate: two mechanisms, each measured separately, named as one candidate.
const recomb = 'rule-12 decimal clause (measured in f546d1ec) + rule-10 grain clause (measured in 56460308)';
const out2 = await rd.execute({ ...base, path: join(dir, 'b.json'), parent: 'a'.repeat(64), predictedTarget: 'bird-111, bird-411', hypothesis: recomb });
assert.equal(out2.written, true);
console.log('multi-id target recorded OK:', out2.decision.target);
rmSync(dir, { recursive: true, force: true });
console.log('strategy contract OK');
