import type { Context } from '@deepseek-ai/cordis';
import Schema from '@deepseek-ai/schemastery';
import { auditRows } from '@deepseek-ai/dsh-agent-preset-registry';
import '@deepseek-ai/dsh-agent';
import '@deepseek-ai/dsh-tools';
import { atomicJSON } from './artifacts.js';
import { ToolCallId } from '@deepseek-ai/dsh-llm';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

export const name = 'evolution-composition-probe';
export const inject = ['loader', 'agents', 'tools'];
export const Config = Schema.object({
  report: Schema.string().required(),
  workspace: Schema.string().required(),
  behaviorModule: Schema.string(),
});

/** QA-only observer: opens an actual Agent without requesting a model turn. */
export function apply(
  ctx: Context,
  config: { report: string; workspace: string; behaviorModule?: string },
): void {
  ctx.on('agent/created', async ({ agent }) => {
    const audit = await auditRows(ctx.loader);
    const presets = ctx.get('agentPresets');
    const roster = presets ? await presets.list() : [];
    const broken = roster.filter((preset) => preset.broken);
    const report = {
      passed: audit.failed.length === 0 && audit.pending.length === 0 && broken.length === 0,
      audit,
      presets: roster,
      compositions: presets?.inspectCompositions(agent.ctx) ?? [],
      tools: agent.ctx.tools.schemas(),
      entries: [...ctx.loader.entries()].map((entry) => ({
        id: entry.id,
        module: entry.options.name,
        disabled: entry.disabled,
        state: entry.fiber?.state ?? null,
      })),
    };
    await atomicJSON(config.report, report);
    if (!report.passed) throw new Error('Native composition QA failed; inspect composition.json');
    if (config.behaviorModule) {
      const observations: unknown[] = [];
      const file = path.join(path.dirname(config.report), 'behavior.json');
      try {
        const suite = await import(pathToFileURL(config.behaviorModule).href);
        if (typeof suite.probe !== 'function')
          throw new Error('Suite must export async probe({agent, ctx, call, workspace})');
        let sequence = 0;
        await suite.probe({
          agent,
          ctx: agent.ctx,
          workspace: config.workspace,
          call: async (name: string, args: Record<string, unknown>) => {
            const callSequence = ++sequence;
            const result = await agent.ctx.tools.execute({
              callId: ToolCallId(`probe-${callSequence}`),
              name,
              arguments: args,
              agent,
              signal: new AbortController().signal,
            });
            observations.push(
              JSON.parse(JSON.stringify({ sequence: callSequence, name, arguments: args, result })),
            );
            await atomicJSON(file, { status: 'running', observations });
            return result;
          },
        });
        await atomicJSON(file, { status: 'passed', observations });
      } catch (error) {
        await atomicJSON(file, { status: 'failed', observations, error: String(error) });
        throw error;
      }
    }
    return undefined;
  });
}
