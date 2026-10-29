// Deterministic protocol adapter only: no model service, optimizer decision or quality claim.
import { appendFileSync } from 'node:fs';
import { LlmAdapter, ToolCallId } from '@deepseek-ai/dsh-llm';
export const inject = ['llm'];
export function apply(ctx) {
  class Fixture extends LlmAdapter {
    requests = 0;
    async resolveModel(provider, id) {
      return { provider, id, name: 'Study finish protocol fixture', context: { contextWindow: 262144 } };
    }
    async *stream(options) {
      options.signal?.throwIfAborted();
      appendFileSync(
        process.env.SPARKVOLVE_FINISH_REQUESTS,
        JSON.stringify({ tools: options.tools, messages: options.messages }) + '\n',
      );
      if (this.requests++ === 0) {
        if (!options.tools.some((tool) => tool.name === 'optimizer_study_finish'))
          throw Error('Native study finish schema missing');
        yield { type: 'block-start', index: 0, blockType: 'tool-call' };
        yield {
          type: 'block-end',
          index: 0,
          block: {
            type: 'tool-call',
            id: ToolCallId('finish-protocol'),
            name: 'optimizer_study_finish',
            arguments: JSON.stringify({ reason: 'Protocol fixture development conclusion' }),
          },
        };
        yield { type: 'finish', reason: 'tool-calls' };
      } else {
        yield { type: 'block-start', index: 0, blockType: 'text' };
        yield {
          type: 'block-end',
          index: 0,
          block: { type: 'text', text: 'continued-after-finish-rejection' },
        };
        yield { type: 'finish', reason: 'stop' };
      }
    }
  }
  ctx.llm.registerAdapter(['study-finish-fixture'], new Fixture());
}
