// Protocol fixture only: deterministic LLM output drives the REAL DSH Agent Loop and tool executor.
// Never used by the optimizer or shipped in the capability bundle.
import { LlmAdapter, ToolCallId } from '@deepseek-ai/dsh-llm';
import { defineTool } from '@deepseek-ai/dsh-tools';
import { readFile, writeFile, access } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
export const inject = ['llm', 'tools'];
export function apply(ctx) {
  ctx.tools.register(
    defineTool({
      name: 'fixture_deliver',
      description: 'Copy the public fixture input into a delivery; verify mount boundaries.',
      parameters: {},
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
      async execute() {
        // Keep the real task in flight long enough for deterministic controller crash injection.
        await delay(3000);
        for (const forbidden of ['/evaluation', '/var/run/docker.sock']) {
          try {
            await access(forbidden);
          } catch (error) {
            if (error.code === 'ENOENT') continue;
            throw error;
          }
          throw new Error(`Private mount exposed: ${forbidden}`);
        }
        try {
          await writeFile('/candidate/unauthorized', 'write');
          throw new Error('Candidate is writable');
        } catch (error) {
          if (!['EROFS', 'EACCES'].includes(error.code)) throw error;
        }
        const input = await readFile('/input/message.txt', 'utf8');
        await writeFile('/workspace/result.txt', input.toUpperCase());
        return 'fixture-delivered';
      },
    }),
  );
  class Fixture extends LlmAdapter {
    calls = 0;
    async resolveModel(provider, id) {
      return {
        provider,
        id,
        name: 'Container protocol fixture',
        context: { contextWindow: 262144 },
        reasoning: { efforts: [{ id: 'off', name: 'Off' }] },
      };
    }
    async *stream(options) {
      options.signal?.throwIfAborted();
      if (this.calls++ === 0) {
        if (!options.tools.some((tool) => tool.name === 'fixture_deliver'))
          throw new Error('Native fixture tool absent');
        yield { type: 'block-start', index: 0, blockType: 'tool-call' };
        yield {
          type: 'block-end',
          index: 0,
          block: {
            type: 'tool-call',
            id: ToolCallId('fixture-delivery'),
            name: 'fixture_deliver',
            arguments: '{}',
          },
        };
        yield { type: 'usage', usage: { inputTokens: 10, outputTokens: 4 } };
        yield { type: 'finish', reason: 'tool-calls' };
      } else {
        if (!JSON.stringify(options.messages).includes('fixture-delivered'))
          throw new Error('Native delivery tool failed');
        yield { type: 'block-start', index: 0, blockType: 'text' };
        yield { type: 'block-end', index: 0, block: { type: 'text', text: 'Container protocol completed' } };
        yield { type: 'usage', usage: { inputTokens: 15, outputTokens: 2 } };
        yield { type: 'finish', reason: 'stop' };
      }
    }
  }
  ctx.llm.registerAdapter(['container-fixture'], new Fixture());
}
