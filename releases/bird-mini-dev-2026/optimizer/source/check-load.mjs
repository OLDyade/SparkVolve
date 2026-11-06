// Build-time load contract. `node --check` only proves the module parses; it does
// not prove the plugin can REGISTER its tools, which is where revision b8641751
// failed native load QA. The native registry rejects a tool whose
// `output { schema, render, presentationMeta? }` lacks a `render` function, so a
// parse check passes on a package that cannot load at all.
//
// This runs in the build container, which has no @deepseek-ai/* packages, so it
// records registrations with a minimal sink and then asserts the contract the
// native registry enforces. A sink is sufficient HERE because the failure mode is
// a missing/wrongly-typed member on the definition itself, not registry behaviour;
// the real registry is exercised separately against the full native Context.
import assert from 'node:assert/strict';

const mod = await import('./index.mjs');
assert.equal(typeof mod.apply, 'function', 'plugin must export apply()');
assert.ok(Array.isArray(mod.inject), 'plugin must declare inject[]');
for (const service of ['systemPrompt', 'tools']) {
  assert.ok(mod.inject.includes(service), `plugin must inject ${service}, which it uses`);
}

const registered = new Map();
const sections = [];
const ctx = {
  systemPrompt: { section: (s) => { sections.push(s); } },
  effect: (fn) => fn(),
  on: () => {},
  tools: { register: (definition) => { registered.set(definition.name, definition); return () => {}; } },
};
mod.apply(ctx);

assert.ok(registered.size > 0, 'plugin registered no tools');
assert.ok(sections.length > 0, 'plugin registered no system-prompt section');

for (const [name, definition] of registered) {
  // Exactly the native tools.register() precondition.
  assert.ok(definition.output && typeof definition.output === 'object',
    `tool "${name}" must declare output`);
  assert.equal(typeof definition.output.render, 'function',
    `tool "${name}" must declare output.render - the native registry throws without it`);
  assert.ok(definition.output.schema && typeof definition.output.schema === 'object',
    `tool "${name}" must declare output.schema`);
  assert.equal(definition.output.schema.type, 'object',
    `tool "${name}" output.schema root must be type object`);
  assert.equal(typeof definition.description, 'string',
    `tool "${name}" must declare a description`);
  assert.ok(definition.parameters && typeof definition.parameters === 'object',
    `tool "${name}" must declare parameters`);
}
console.log('load contract OK: ' + registered.size + ' tool(s) - ' + [...registered.keys()].join(', '));
