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
      const tool = ['evolution_status', 'evolution_wait', 'evolution_finish'][this.calls++];
      const findCursor = (value) => {
        if (typeof value === 'string') {
          try {
            return findCursor(JSON.parse(value));
          } catch {
            return undefined;
          }
        }
        if (!value || typeof value !== 'object') return undefined;
        if (value.cursor?.experimentId && Number.isInteger(value.cursor.sequence)) return value.cursor;
        for (const child of Object.values(value)) {
          const found = findCursor(child);
          if (found) return found;
        }
      };
      if (tool === 'evolution_finish' && !JSON.stringify(options.messages).includes('acceptance.wakeup'))
        throw new Error('Committed completion event did not reach the next model request');
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
                : tool === 'evolution_wait'
                  ? findCursor(options.messages)
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
