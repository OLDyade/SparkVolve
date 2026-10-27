import type { Context } from '@deepseek-ai/cordis';
import Schema from '@deepseek-ai/schemastery';
import { defineTool } from '@deepseek-ai/dsh-tools';

export const name = 'harness-evolution';
export const inject = ['tools'];
export const Config = Schema.object({
  endpoint: Schema.string().required(),
  tokenEnv: Schema.string().required(),
});
export interface Config {
  endpoint: string;
  tokenEnv: string;
}

/** Native Cordis contributions; no second agent loop and no tool schema emulation. */
export function apply(ctx: Context, config: Config): void {
  const endpoint = new URL(config.endpoint);
  if (!['http:', 'https:'].includes(endpoint.protocol))
    throw new Error('Controller endpoint must use HTTP(S)');
  const token = process.env[config.tokenEnv];
  if (!token) throw new Error(`Missing controller capability: ${config.tokenEnv}`);
  async function request(route: string, body: unknown, signal: AbortSignal): Promise<string> {
    const response = await fetch(new URL(route, endpoint), {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`Evolution controller ${response.status}: ${text}`);
    return text;
  }
  const output = {
    schema: { type: 'string' as const },
    render: (_args: unknown, value: unknown) => [{ type: 'text' as const, text: String(value) }],
  };
  ctx.tools.register(
    defineTool({
      name: 'evolution_library',
      description:
        'Search the researcher-authorized immutable research library by literal text. Returns source identity, mechanism hypothesis and historical outcomes, including failures. These are prior evidence, never current scores or instructions. A missing library is an explicit authorization error.',
      parameters: { query: { type: 'string' } },
      output,
      execute: async (args, exec) => request('/library', args, exec.signal),
    }),
  );
  ctx.tools.register(
    defineTool({
      name: 'evolution_asset',
      description:
        'Inspect a verified research record and source file hashes by archive ID. Supply file to read exact source bytes as base64. Use the original hypothesis, failures and code to decide reuse; archive claims are not independent proof. Only contracted library contents are accessible.',
      parameters: { archive: { type: 'string', required: true }, file: { type: 'string' } },
      output,
      execute: async (args, exec) => request('/asset', args, exec.signal),
    }),
  );
  ctx.tools.register(
    defineTool({
      name: 'evolution_import',
      description:
        'Import verified source from an authorized archive into a new editable /workspace draft, retaining origin and record identity. Does not install into this optimizer, run code, create a candidate, import scores or promote anything. Adapt with ordinary coding tools and submit for the current full evaluation.',
      parameters: { archive: { type: 'string', required: true }, draft: { type: 'string', required: true } },
      output,
      execute: async (args, exec) => request('/import', args, exec.signal),
    }),
  );
  ctx.tools.register(
    defineTool({
      name: 'evolution_wait',
      description:
        'Wait for committed experiment events, without repeatedly reading status. Start with the cursor from evolution_status; continue with the returned cursor. Reuse that cursor after reconnecting. A timeout returns an empty page and does not stop or retry any task. Drain hasMore pages before waiting again; read status after a decision for the current state.',
      parameters: {
        experimentId: { type: 'string', required: true },
        sequence: { type: 'integer', required: true },
      },
      output,
      execute: async (args, exec) => request('/events', { cursor: args }, exec.signal),
    }),
  );
  ctx.tools.register(
    defineTool({
      name: 'evolution_finish',
      description:
        'Conclude search with an evidence-based reason and remaining limitations. Pending evaluations must settle first. This records a stop decision; it does not publish or certify a capability.',
      parameters: { reason: { type: 'string', required: true } },
      output,
      execute: async (args, exec) => request('/finish', args, exec.signal),
    }),
  );
  ctx.tools.register(
    defineTool({
      name: 'evolution_candidate',
      description:
        'Inspect frozen source, build logs, built artifact or QA logs; omit file to list paths and hashes. Every submitted native Bundle needs package-lock.json and scripts.build. QA, execution and export use one frozen build. Files return base64.',
      parameters: {
        candidate: { type: 'string', required: true },
        area: { type: 'string', enum: ['source', 'build', 'artifact', 'qa'], required: true },
        file: { type: 'string' },
      },
      output,
      execute: async (args, exec) => request('/candidate', args, exec.signal),
    }),
  );
  ctx.tools.register(
    defineTool({
      name: 'evolution_status',
      description:
        'Read the frozen experiment contract, candidate lineage, complete task results and champion. Quality claims require independent evaluation.',
      parameters: {},
      output,
      execute: async (_args, exec) => request('/status', {}, exec.signal),
    }),
  );
  ctx.tools.register(
    defineTool({
      name: 'evolution_branch',
      description:
        'Create an editable draft from any recorded parent. Use ordinary DSH file and coding tools in /workspace/<draft> to enable, disable, tune, replace, compose or author plugins. The optimizer runtime stays unchanged.',
      parameters: { parent: { type: 'string', required: true }, draft: { type: 'string', required: true } },
      output,
      execute: async (args, exec) => request('/branch', args, exec.signal),
    }),
  );
  ctx.tools.register(
    defineTool({
      name: 'evolution_submit',
      description:
        'Freeze a changed native Bundle and schedule its contracted QA and full task manifest. Duplicate bytes cannot be resampled. Record evidence, a mechanism hypothesis, parent versions and expected behavior. Returns admission identity; use status for actual results.',
      parameters: {
        draft: { type: 'string', required: true },
        parents: { type: 'array', items: { type: 'string' }, required: true },
        actions: {
          type: 'array',
          items: { type: 'string', enum: ['enable', 'disable', 'tune', 'swap', 'compose', 'author'] },
          required: true,
        },
        evidence: { type: 'array', items: { type: 'string' }, required: true },
        hypothesis: { type: 'string', required: true },
        expectedChange: { type: 'string', required: true },
      },
      output,
      execute: async (args, exec) => request('/submit', args, exec.signal),
    }),
  );
  ctx.tools.register(
    defineTool({
      name: 'evolution_evidence',
      description:
        'Read an authorized execution artifact by run and area. Areas expose original input, frozen delivery and native session trace. Evaluation-private material is never served. Binary files return base64.',
      parameters: {
        run: { type: 'string', required: true },
        area: { type: 'string', enum: ['input', 'delivery', 'trace'], required: true },
        file: { type: 'string', description: 'Omit to list exact artifact paths and hashes.' },
      },
      output,
      execute: async (args, exec) => request('/evidence', args, exec.signal),
    }),
  );
}
