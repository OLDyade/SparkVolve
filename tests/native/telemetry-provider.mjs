// Protocol fixture: real DSH loop/tool pipeline, deterministic local adapter, no quality claim.
import { LlmAdapter, ToolCallId } from '@deepseek-ai/dsh-llm';
import { defineTool } from '@deepseek-ai/dsh-tools';
export const inject = ['llm', 'tools'];
export function apply(ctx) {
  ctx.tools.register(
    defineTool({
      name: 'telemetry_probe',
      description: 'Return a value or expose a fixture error.',
      parameters: { fail: { type: 'boolean', required: true } },
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
      execute: ({ fail }) => {
        if (fail) throw Error('expected tool failure');
        return 'observed-value';
      },
    }),
  );
  class Fixture extends LlmAdapter {
    calls = 0;
    async resolveModel(provider, id) {
      return { provider, id, name: 'Telemetry fixture', context: { contextWindow: 262144 } };
    }
    async *stream() {
      const turn = ++this.calls;
      if (turn < 3) {
        yield { type: 'block-start', index: 0, blockType: 'tool-call' };
        yield {
          type: 'block-end',
          index: 0,
          block: {
            type: 'tool-call',
            id: ToolCallId(`telemetry-${turn}`),
            name: 'telemetry_probe',
            arguments: JSON.stringify({ fail: turn === 2 }),
          },
        };
      } else {
        yield { type: 'block-start', index: 0, blockType: 'text' };
        yield { type: 'block-end', index: 0, block: { type: 'text', text: 'telemetry-complete' } };
      }
      yield { type: 'usage', usage: { inputTokens: turn * 10, outputTokens: turn } };
      yield { type: 'finish', reason: turn < 3 ? 'tool-calls' : 'stop' };
    }
  }
  ctx.llm.registerAdapter(['telemetry-fixture'], new Fixture());
}
