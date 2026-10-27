// Deterministic protocol fixture. This is not an optimizer, benchmark solver or quality result.
import { LlmAdapter, ToolCallId } from '@deepseek-ai/dsh-llm';
import { appendFileSync } from 'node:fs';
export const inject = ['llm'];
export function apply(ctx) {
  class Fixture extends LlmAdapter {
    calls = 0;
    async resolveModel(provider, id) {
      return { provider, id, name: 'Protocol fixture', context: { contextWindow: 262144 } };
    }
    async *stream(options) {
      options.signal?.throwIfAborted();
      if (process.env.HE_FIXTURE_FINISH_ERROR) {
        yield {
          type: 'finish',
          reason: { kind: 'error', failure: { code: 'TRANSPORT', message: 'Fixture connection error' } },
        };
        return;
      }
      appendFileSync(
        process.env.HE_FIXTURE_REQUESTS,
        JSON.stringify({ model: options.model, tools: options.tools, messages: options.messages }) + '\n',
      );
      if (this.calls++ === 0) {
        if (!options.tools.some((tool) => tool.name === 'evolution_status'))
          throw new Error('Evolution tool missing from actual model request');
        yield { type: 'block-start', index: 0, blockType: 'tool-call' };
        yield {
          type: 'block-end',
          index: 0,
          block: {
            type: 'tool-call',
            id: ToolCallId('fixture-status'),
            name: 'evolution_status',
            arguments: '{}',
          },
        };
        yield { type: 'usage', usage: { inputTokens: 10, outputTokens: 4 } };
        yield { type: 'finish', reason: 'tool-calls' };
      } else {
        yield { type: 'block-start', index: 0, blockType: 'text' };
        yield { type: 'block-end', index: 0, block: { type: 'text', text: 'native-evolution-connected' } };
        yield { type: 'usage', usage: { inputTokens: 15, outputTokens: 2 } };
        yield { type: 'finish', reason: 'stop' };
      }
    }
  }
  ctx.llm.registerAdapter(['evolution-fixture'], new Fixture());
}
