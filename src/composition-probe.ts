import type { Context } from '@deepseek-ai/cordis';
import Schema from '@deepseek-ai/schemastery';
import { auditRows } from '@deepseek-ai/dsh-agent-preset-registry';
import '@deepseek-ai/dsh-agent';
import '@deepseek-ai/dsh-tools';
import { atomicJSON } from './artifacts.js';

export const name = 'evolution-composition-probe';
export const inject = ['loader', 'agents', 'tools'];
export const Config = Schema.object({ report: Schema.string().required() });

/** QA-only observer: opens an actual Agent without requesting a model turn. */
export function apply(ctx: Context, config: { report: string }): void {
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
    return undefined;
  });
}
