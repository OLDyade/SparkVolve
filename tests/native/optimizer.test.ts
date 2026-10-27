import test from 'node:test';
import assert from 'node:assert/strict';
import { Context } from '@deepseek-ai/cordis';
import SystemPrompt from '@deepseek-ai/dsh-system-prompt';

test('the versioned optimizer method is an actual disposable Cordis contribution', async () => {
  const ctx = new Context();
  try {
    await ctx.plugin(SystemPrompt);
    const module = await import(new URL('../../optimizers/evidence-driven/index.mjs', import.meta.url).href);
    const fork = ctx.plugin(module);
    await fork;
    const assembly = await ctx.systemPrompt.assemble();
    assert.ok(
      assembly.sections.some(
        (section) =>
          section.name === 'evolution-research-method' && section.text.includes('evolution_finish'),
      ),
    );
    await fork.dispose();
    assert.equal(
      (await ctx.systemPrompt.assemble()).sections.some(
        (section) => section.name === 'evolution-research-method',
      ),
      false,
    );
  } finally {
    await ctx.fiber.dispose();
  }
});
