import { readFileSync } from 'node:fs';
import { defineTool } from '@deepseek-ai/dsh-tools';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const inject = ['tools', 'systemPrompt'];

const WORKER = fileURLToPath(new URL('./workbook.py', import.meta.url));

function invoke(args, signal) {
  return new Promise((resolve, reject) => {
    const child = spawn('python3', [WORKER], { signal, stdio: ['pipe', 'pipe', 'pipe'] });
    const out = [];
    const err = [];
    child.stdout.on('data', (chunk) => out.push(chunk));
    child.stderr.on('data', (chunk) => err.push(chunk));
    child.on('error', (error) => reject(error));
    child.on('close', (code) => {
      if (code === 0) {
        const text = Buffer.concat(out).toString();
        try {
          resolve(JSON.parse(text));
        } catch {
          reject(new Error(`workbook worker returned unreadable output: ${text.slice(0, 500)}`));
        }
        return;
      }
      const detail = Buffer.concat(err).toString().trim();
      reject(new Error(detail || `workbook worker exited with code ${code}`));
    });
    child.stdin.on('error', reject);
    child.stdin.end(JSON.stringify(args));
  });
}

const output = {
  schema: { type: 'json' },
  render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
};

export function apply(ctx) {
  ctx.systemPrompt.section({
    name: 'workbook-guidance',
    order: 500,
    interpolate: false,
    text: readFileSync(new URL('./guidance.md', import.meta.url), 'utf8'),
  });
  ctx.tools.register(
    defineTool({
      name: 'workbook_inspect',
      description:
        'Read a workbook as a model: literal cell values, formula text and the text of every cell comment, per sheet. ' +
        "Comments often carry the task's stated adjustments and calculation notes, so read them all before writing. " +
        'Formulas are reported as their stored text, never as computed results; this tool does not calculate, ' +
        'infer business meaning or refresh stored cached results.',
      parameters: {
        file: { type: 'string', required: true, description: 'Absolute path of the XLSX file to read.' },
        sheets: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional sheet names to limit the output to.',
        },
      },
      output,
      execute: (args, exec) => invoke({ operation: 'inspect', ...args }, exec.signal),
    }),
  );

  ctx.tools.register(
    defineTool({
      name: 'workbook_write',
      description:
        'Write caller-supplied values and formulas into an openpyxl copy of an XLSX workbook. ' +
        'Destination must be inside /workspace and differ from the source. The source file ' +
        'is never modified, and the destination is only written after every edit validates. Source cells the task ' +
        'calls intentionally blank should stay blank. ' +
        'This tool does not calculate formulas: use workbook_recalculate to observe engine results.',
      parameters: {
        source: { type: 'string', required: true, description: 'Absolute path of the template workbook.' },
        destination: {
          type: 'string',
          required: true,
          description: 'Absolute output path inside /workspace.',
        },
        edits: {
          type: 'array',
          required: true,
          description:
            'Cells to overwrite. A null value clears the cell; a leading "=" is stored as a formula.',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              sheet: { type: 'string', required: true, description: 'Existing worksheet name.' },
              cell: { type: 'string', required: true, description: 'A1-style cell reference such as "B7".' },
              value: { type: 'json', required: true, description: 'String, number, null, or formula text.' },
            },
          },
        },
      },
      output,
      execute: (args, exec) => invoke({ operation: 'write', ...args }, exec.signal),
    }),
  );

  ctx.tools.register(
    defineTool({
      name: 'workbook_recalculate',
      description:
        'Calculate an XLSX workbook with the installed spreadsheet engine (LibreOffice headless, isolated profile) ' +
        'and report, for every formula, its verbatim formula text plus the engine result or engine error such as ' +
        '#DIV/0!. Results are engine outputs; they are not checked against any expectation. With a destination the ' +
        'recalculated copy is saved (inside /workspace) for delivery. Engine failures are reported as tool errors. ' +
        "Values retain their workbook types; date values are serialized as ISO text. Follow the sheet's stated units. " +
        'Note: cells whose result the engine leaves without a stored value are reported as null.',
      parameters: {
        source: {
          type: 'string',
          required: true,
          description: 'Absolute path of the workbook to calculate.',
        },
        destination: {
          type: 'string',
          description: 'Optional absolute output path inside /workspace for the recalculated workbook.',
        },
        sheets: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional sheet names whose formulas are reported.',
        },
      },
      output,
      execute: (args, exec) => invoke({ operation: 'recalculate', ...args }, exec.signal),
    }),
  );
}
