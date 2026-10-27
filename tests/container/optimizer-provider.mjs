// Protocol-only fixture. No benchmark solutions or research quality claims.
import { LlmAdapter, ToolCallId } from '@deepseek-ai/dsh-llm';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
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
      const tool = ['evolution_status', 'evolution_wait', 'evolution_materialize', 'evolution_finish'][
        this.calls++
      ];
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
      const findSnapshot = (value) => {
        if (typeof value === 'string') {
          try {
            return findSnapshot(JSON.parse(value));
          } catch {
            return undefined;
          }
        }
        if (!value || typeof value !== 'object') return undefined;
        if (value.path?.startsWith('/evidence/') && value.sha256) return value;
        for (const child of Object.values(value)) {
          const found = findSnapshot(child);
          if (found) return found;
        }
      };
      if (tool === 'evolution_finish') {
        const snapshot = findSnapshot(options.messages);
        if (!snapshot)
          throw new Error('Native materialization response did not reach the next model request');
        const bytes = readFileSync(snapshot.path);
        const observedSha256 = createHash('sha256').update(bytes).digest('hex');
        if (observedSha256 !== snapshot.sha256 || bytes.length !== 6643)
          throw new Error('Materialized evidence bytes changed');
        let fileWriteError;
        try {
          appendFileSync(snapshot.path, 'forbidden');
        } catch (error) {
          fileWriteError = error.code;
        }
        if (!['EACCES', 'EROFS'].includes(fileWriteError)) throw new Error('Frozen evidence is writable');
        let writeError;
        try {
          writeFileSync('/evidence/forbidden-new-file', 'forbidden');
        } catch (error) {
          writeError = error.code;
        }
        if (writeError !== 'EROFS') throw new Error(`Evidence mount is not read-only: ${writeError}`);
        writeFileSync('/workspace/observed.bin', bytes);
        writeFileSync(
          '/trace/materialization.json',
          JSON.stringify({ ...snapshot, observedSha256, writeError, fileWriteError }),
        );
      }
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
                  : tool === 'evolution_materialize'
                    ? { kind: 'run', id: 'e'.repeat(64), area: 'input', file: 'original.bin' }
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
