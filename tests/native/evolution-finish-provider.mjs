// Native protocol fixture only; no external model, mutation strategy or quality claim.
import { appendFileSync } from 'node:fs';
import { LlmAdapter, ToolCallId } from '@deepseek-ai/dsh-llm';

export const inject = ['llm'];
export function apply(ctx) {
  class Fixture extends LlmAdapter {
    requests = 0;
    async resolveModel(provider, id) {
      return { provider, id, name: 'Evolution finish fixture', context: { contextWindow: 262144 } };
    }
    async *stream(options) {
      options.signal?.throwIfAborted();
      appendFileSync(
        process.env.HE_EVOLUTION_FINISH_REQUESTS,
        JSON.stringify({ tools: options.tools.map((tool) => tool.name) }) + '\n',
      );
      if (this.requests++ === 0) {
        if (!options.tools.some((tool) => tool.name === 'evolution_finish'))
          throw Error('Native evolution_finish schema missing');
        yield { type: 'block-start', index: 0, blockType: 'tool-call' };
        yield {
          type: 'block-end',
          index: 0,
          block: {
            type: 'tool-call',
            id: ToolCallId('evolution-finish-fixture'),
            name: 'evolution_finish',
            arguments: JSON.stringify({ reason: 'Explicit protocol fixture conclusion' }),
          },
        };
        yield { type: 'finish', reason: 'tool-calls' };
      } else {
        yield { type: 'block-start', index: 0, blockType: 'text' };
        yield {
          type: 'block-end',
          index: 0,
          block: { type: 'text', text: 'continued-after-evolution-finish-rejection' },
        };
        yield { type: 'finish', reason: 'stop' };
      }
    }
  }
  ctx.llm.registerAdapter(['evolution-finish-fixture'], new Fixture());
}
