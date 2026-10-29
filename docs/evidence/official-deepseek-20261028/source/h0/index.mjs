import { defineTool } from '@deepseek-ai/dsh-tools';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
export const inject = ['tools'];
export function apply(ctx) {
  const invoke = (args, signal) =>
    new Promise((resolve, reject) => {
      const child = spawn('python3', [fileURLToPath(new URL('./workbook.py', import.meta.url))], {
        signal,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      const out = [],
        err = [];
      child.stdout.on('data', (chunk) => out.push(chunk));
      child.stderr.on('data', (chunk) => err.push(chunk));
      child.on('error', reject);
      child.on('close', (code) =>
        code === 0
          ? resolve(Buffer.concat(out).toString())
          : reject(new Error(Buffer.concat(err).toString())),
      );
      child.stdin.end(JSON.stringify(args));
    });
  const output = { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] };
  ctx.tools.register(
    defineTool({
      name: 'workbook_inspect',
      description:
        'Read exact occupied cells, formulas and comments in an XLSX workbook. Source labels are facts; this tool does not infer business semantics.',
      parameters: { file: { type: 'string', required: true } },
      output,
      execute: (args, exec) => invoke({ operation: 'inspect', ...args }, exec.signal),
    }),
  );
  ctx.tools.register(
    defineTool({
      name: 'workbook_write',
      description:
        'Apply explicit caller-supplied values or formulas to a copy of an XLSX workbook. Preserve original input. Destination must be inside /workspace. Does not calculate formulas or certify correctness.',
      parameters: {
        source: { type: 'string', required: true },
        destination: { type: 'string', required: true },
        edits: {
          type: 'array',
          required: true,
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              sheet: { type: 'string', required: true },
              cell: { type: 'string', required: true },
              value: { type: 'json', required: true },
            },
          },
        },
      },
      output,
      execute: (args, exec) => invoke({ operation: 'write', ...args }, exec.signal),
    }),
  );
}
