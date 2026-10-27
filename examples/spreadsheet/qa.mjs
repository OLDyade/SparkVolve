// The example contract requires index.mjs to activate against native DSH services.
// Syntax checking alone misses failures that DSH treats as optional plugin warnings.
import { Context } from '@deepseek-ai/cordis';
import SystemPrompt from '@deepseek-ai/dsh-system-prompt';
import Tools from '@deepseek-ai/dsh-tools';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const ctx = new Context();
try {
  await ctx.plugin(SystemPrompt);
  await ctx.plugin(Tools);
  await ctx.plugin(await import(pathToFileURL(path.resolve(process.argv[2])).href));
  console.log(JSON.stringify({ activated: true, tools: ctx.tools.schemas().map((tool) => tool.name) }));
} finally {
  await ctx.fiber.dispose();
}
