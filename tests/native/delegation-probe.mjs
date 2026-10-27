// Exercise the official in-process provider, including its own child factory and disposal.
import { appendFileSync } from 'node:fs';
export const inject = ['subagents', 'agentPresets'];
export function apply(ctx, config) {
  ctx.on('agent/created', ({ agent }) => {
    if (agent.session.header.origin === 'subagent') {
      appendFileSync(
        config.file,
        JSON.stringify({ kind: 'child', preset: ctx.agentPresets.composedPreset(agent.ctx), id: agent.id }) +
          '\n',
      );
      return;
    }
    let delegated = false;
    agent.ctx.on('agent/pre-step', async ({ signal }, next) => {
      if (!delegated) {
        delegated = true;
        const activation = await ctx.subagents.startActivation({
          provider: 'spawn',
          label: 'Preset inheritance acceptance',
          request: {
            parent: agent,
            prompt: [{ type: 'text', text: 'Call evolution_status and report the receipt.' }],
          },
          delivery: 'caller',
          signal,
        });
        try {
          const result = await activation.result;
          appendFileSync(config.file, JSON.stringify({ kind: 'result', result }) + '\n');
        } finally {
          await activation.dispose();
        }
      }
      return next();
    });
  });
}
