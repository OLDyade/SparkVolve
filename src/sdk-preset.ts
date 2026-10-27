import type { Context } from '@deepseek-ai/cordis';
import Schema from '@deepseek-ai/schemastery';
import '@deepseek-ai/dsh-agent';
import '@deepseek-ai/dsh-agent-preset-registry';
import '@deepseek-ai/dsh-session-projection';

export const name = 'evolution-sdk-preset';
export const inject = ['agentPresets', 'sessionProjections'];
export const Config = Schema.object({ preset: Schema.string().required() });

/** SDK roots opt into a native composition before AgentLoop releases queued input. */
export function apply(ctx: Context, config: { preset: string }): void {
  ctx.on('agent/created', async ({ agent, source }) => {
    // Native child creation already inherits its parent's exact retained revision.
    if (ctx.agentPresets.composedPreset(agent.ctx) !== undefined) return;
    const recorded = ctx.sessionProjections.stateOf(agent.session, 'agentPreset');
    if (recorded) {
      await ctx.agentPresets.mount(agent.ctx, recorded);
      return;
    }
    if (source !== 'startup') throw new Error('Cannot resume an optimizer session without a recorded preset');
    if (agent.session.header.origin === 'subagent')
      throw new Error('Optimizer child was created without its native preset composition');
    await ctx.agentPresets.select(agent, config.preset);
  });
}
