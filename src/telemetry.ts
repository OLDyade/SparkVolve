import type { Context } from '@deepseek-ai/cordis';
import { appendFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import Schema from '@deepseek-ai/schemastery';
import type { StreamChunk, TokenUsage } from '@deepseek-ai/dsh-llm';
import '@deepseek-ai/dsh-system-prompt';

export const name = 'evolution-runtime-observer';
export const inject = ['llm', 'systemPrompt'];
export const Config = Schema.object({
  file: Schema.string().required(),
  provider: Schema.string().required(),
  model: Schema.string().required(),
  startedAt: Schema.number().required(),
  timeoutSeconds: Schema.number().required(),
});
export interface Config {
  file: string;
  provider: string;
  model: string;
  startedAt: number;
  timeoutSeconds: number;
}
export function apply(ctx: Context, config: Config): void {
  ctx.systemPrompt.context({
    name: 'evolution:execution-budget',
    order: 220,
    required: true,
    interpolate: false,
    text: () =>
      `Execution budget: ${config.timeoutSeconds}s; elapsed: ${Math.max(0, Math.floor((Date.now() - config.startedAt) / 1000))}s. The external controller enforces this wall-clock limit.`,
  });
  ctx.on('llm/stream', async function* (options, next): AsyncIterable<StreamChunk> {
    const id = randomUUID(),
      started = Date.now();
    const record = (event: unknown): void =>
      appendFileSync(config.file, `${JSON.stringify(event)}\n`, { mode: 0o600 });
    if (options.provider !== config.provider || options.model !== config.model)
      throw new Error('Model route violates the frozen experiment contract');
    record({
      id,
      kind: 'started',
      at: new Date(started).toISOString(),
      provider: options.provider,
      model: options.model,
      reasoningEffort: options.reasoningEffort,
      maxTokens: options.maxTokens,
      messages: options.messages,
      tools: options.tools,
    });
    let usage: TokenUsage | null = null;
    let finished = false;
    try {
      for await (const chunk of next()) {
        if (chunk.type === 'usage') usage = chunk.usage;
        if (chunk.type === 'finish') finished = true;
        yield chunk;
      }
      if (!finished) throw new Error('Model stream ended without a finish event');
      record({ id, kind: 'result', durationMs: Date.now() - started, usage });
    } catch (error) {
      record({ id, kind: 'failed', durationMs: Date.now() - started, usage, error: String(error) });
      throw error;
    } finally {
      if (!finished) record({ id, kind: 'closed_incomplete', at: new Date().toISOString() });
    }
  });
}
