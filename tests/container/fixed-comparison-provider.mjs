// Deterministic protocol fixture only. Drives real native DSH tools; makes no research-quality claim.
import { LlmAdapter, ToolCallId } from '@deepseek-ai/dsh-llm';
import { appendFileSync } from 'node:fs';

export const inject = ['llm'];
export function apply(ctx) {
  class FixedComparisonFixture extends LlmAdapter {
    calls = 0;
    async resolveModel(provider, id) {
      return { provider, id, name: 'Fixed comparison protocol fixture', context: { contextWindow: 262144 } };
    }
    async *stream(options) {
      const text = JSON.stringify(options.messages);
      const modes = ['direct', 'inspect', 'failure'].filter((mode) =>
        text.includes(`fixed-comparison-fixture:${mode}`),
      );
      if (modes.length !== 1) throw Error('Expected exactly one frozen method marker');
      const mode = modes[0];
      appendFileSync(
        '/trace/fixed-comparison-requests.jsonl',
        JSON.stringify({
          mode,
          tools: options.tools.map((tool) => tool.name),
          messages: options.messages,
        }) + '\n',
      );
      if (mode === 'failure') throw Error('Deliberate frozen method protocol failure');
      const tool =
        mode === 'inspect' && this.calls === 0
          ? 'evolution_status'
          : this.calls < (mode === 'inspect' ? 2 : 1)
            ? 'evolution_finish'
            : null;
      this.calls++;
      if (tool) {
        if (!options.tools.some((entry) => entry.name === tool)) throw Error(`Native tool missing: ${tool}`);
        yield { type: 'block-start', index: 0, blockType: 'tool-call' };
        yield {
          type: 'block-end',
          index: 0,
          block: {
            type: 'tool-call',
            id: ToolCallId(`fixed-${mode}-${this.calls}`),
            name: tool,
            arguments: JSON.stringify(
              tool === 'evolution_finish'
                ? { reason: `Frozen ${mode} protocol fixture concludes without a mutation; no quality claim` }
                : {},
            ),
          },
        };
        yield { type: 'usage', usage: { inputTokens: 11, outputTokens: 3 } };
        yield { type: 'finish', reason: 'tool-calls' };
      } else {
        yield { type: 'block-start', index: 0, blockType: 'text' };
        yield {
          type: 'block-end',
          index: 0,
          block: { type: 'text', text: 'Fixed comparison fixture completed' },
        };
        yield { type: 'usage', usage: { inputTokens: 13, outputTokens: 2 } };
        yield { type: 'finish', reason: 'stop' };
      }
    }
  }
  ctx.llm.registerAdapter(['fixed-comparison-fixture'], new FixedComparisonFixture());
}
