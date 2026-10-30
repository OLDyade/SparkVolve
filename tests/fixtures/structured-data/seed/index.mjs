import { defineTool } from '@deepseek-ai/dsh-tools';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const inject = ['tools'];
export function apply(ctx) {
  const output = { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] };
  ctx.tools.register(
    defineTool({
      name: 'data_read',
      description:
        'Read a UTF-8 data file verbatim, including every JSONL record. No parsing, filtering, inferred schema or repair is applied.',
      parameters: { file: { type: 'string', required: true } },
      output,
      execute: ({ file }) => readFile(file, 'utf8'),
    }),
  );
  ctx.tools.register(
    defineTool({
      name: 'data_write',
      description:
        'Write caller-supplied JSON to an explicit file in /workspace. Does not infer records, transform values, or verify task correctness. An existing destination is explicitly replaced.',
      parameters: {
        destination: { type: 'string', required: true },
        value: { type: 'json', required: true },
      },
      output,
      execute: async ({ destination, value }) => {
        const resolved = path.resolve(destination);
        if (!resolved.startsWith('/workspace/')) throw new Error('Destination must be inside /workspace');
        const content = JSON.stringify(value, null, 2) + '\n';
        await writeFile(resolved, content);
        return JSON.stringify({ destination: resolved, bytes: Buffer.byteLength(content) });
      },
    }),
  );
}
