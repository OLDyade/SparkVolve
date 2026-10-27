// Protocol-only fixture. No benchmark solutions or research quality claims.
import { LlmAdapter, ToolCallId } from '@deepseek-ai/dsh-llm';
import { appendFileSync } from 'node:fs';
export const inject = ['llm'];
export function apply(ctx) {
  class Fixture extends LlmAdapter {
    calls = 0;
    async resolveModel(provider, id) {
      return { provider, id, name: 'Optimizer protocol fixture', context: { contextWindow: 262144 } };
    }
    async *stream(options) {
      appendFileSync(
        '/trace/model-requests.jsonl',
        JSON.stringify({ tools: options.tools, messages: options.messages }) + '\n',
      );
      if (!JSON.stringify(options.messages).includes('Evolve the Harness, Not the Model.'))
        throw new Error('Native optimizer preset lost its research method');
      const tool = ['evolution_status', 'evolution_finish'][this.calls++];
      if (tool) {
        if (!options.tools.some((t) => t.name === tool)) throw new Error(`Missing native tool ${tool}`);
        yield { type: 'block-start', index: 0, blockType: 'tool-call' };
        yield {
          type: 'block-end',
          index: 0,
          block: {
            type: 'tool-call',
            id: ToolCallId(`fixture-${this.calls}`),
            name: tool,
            arguments: JSON.stringify(
              tool === 'evolution_finish'
                ? { reason: 'Protocol lifecycle acceptance completed; no quality claim' }
                : {},
            ),
          },
        };
        yield { type: 'finish', reason: 'tool-calls' };
      } else {
        yield { type: 'block-start', index: 0, blockType: 'text' };
        yield { type: 'block-end', index: 0, block: { type: 'text', text: 'optimizer-preset-connected' } };
        yield { type: 'finish', reason: 'stop' };
      }
    }
  }
  ctx.llm.registerAdapter(['optimizer-fixture'], new Fixture());
}
