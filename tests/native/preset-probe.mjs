// Test-only observations and an explicitly selected ordinary session in the same SDK process.
import { appendFileSync } from 'node:fs';
import { scopeOf } from '@deepseek-ai/dsh-scope';
export const inject = ['agentPresets', 'sessionProjections', 'tools', 'systemPrompt'];
export function apply(ctx, config) {
  if (config.selectOrdinary) {
    ctx.on('agent/created', async ({ agent }) => {
      if (agent.id === 'ordinary-session') await ctx.agentPresets.select(agent, 'ordinary');
    });
    return;
  }
  ctx.on('agent/created', async ({ agent, source }) => {
    let observed = false;
    agent.ctx.on('agent/pre-step', async (_payload, next) => {
      if (observed) return next();
      observed = true;
      const scope = scopeOf(agent.ctx);
      const prompt = await ctx.systemPrompt.assemble({ scope, agent });
      appendFileSync(
        config.file,
        JSON.stringify({
          id: agent.id,
          source,
          recorded: ctx.sessionProjections.stateOf(agent.session, 'agentPreset'),
          composed: ctx.agentPresets.composedPreset(agent.ctx),
          globalTools: ctx.tools.schemas().map((t) => t.name),
          tools: ctx.tools.schemas(scope).map((t) => t.name),
          sections: prompt.sections.map((s) => s.name),
        }) + '\n',
      );
      return next();
    });
  });
}
