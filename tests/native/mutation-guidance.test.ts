import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Context } from '@deepseek-ai/cordis';
import SystemPrompt, { renderPrompt } from '@deepseek-ai/dsh-system-prompt';
import Tools from '@deepseek-ai/dsh-tools';

test('mutation guidance is literal native prompt text, including formula-template braces', async () => {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const parent = await mkdtemp(path.join(os.tmpdir(), 'he-literal-guidance-'));
  const ctx = new Context();
  try {
    await symlink(path.join(root, 'node_modules'), path.join(parent, 'node_modules'), 'dir');
    const { prepareMutationSeed } = await import(
      new URL('../../scripts/verify-feedback-study.mjs', import.meta.url).href
    );
    const seed = path.join(parent, 'seed');
    await prepareMutationSeed(path.join(root, 'examples/spreadsheet/seed'), seed);
    const literal = 'Templates use {{C}}, {{R+1}} and {{unknown_variable}} as ordinary examples.';
    await writeFile(path.join(seed, 'guidance.md'), literal);
    await ctx.plugin(SystemPrompt);
    await ctx.plugin(Tools);
    const fork = ctx.plugin(await import(pathToFileURL(path.join(seed, 'index.mjs')).href));
    await fork;
    assert.ok(renderPrompt(await ctx.systemPrompt.assemble()).includes(literal));
    assert.deepEqual(
      ctx.tools
        .schemas()
        .map((tool) => tool.name)
        .sort(),
      ['workbook_inspect', 'workbook_write'],
    );
    await fork.dispose();
    assert.equal(renderPrompt(await ctx.systemPrompt.assemble()).includes(literal), false);
    assert.deepEqual(ctx.tools.schemas(), []);
  } finally {
    await ctx.fiber.dispose();
    await rm(parent, { recursive: true, force: true });
  }
});
