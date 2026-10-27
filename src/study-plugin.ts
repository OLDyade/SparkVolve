import type { Context } from '@deepseek-ai/cordis';
import { defineTool } from '@deepseek-ai/dsh-tools';
import type { Config } from './plugin.js';
export { Config } from './plugin.js';

export const name = 'harness-optimizer-study';
export const inject = ['tools'];

/** Meta research is another native DSH preset, with its own restricted host capability. */
export function apply(ctx: Context, config: Config): void {
  const endpoint = new URL(config.endpoint);
  if (!['http:', 'https:'].includes(endpoint.protocol)) throw new Error('Study endpoint must use HTTP(S)');
  const token = process.env[config.tokenEnv];
  if (!token) throw new Error(`Missing study capability: ${config.tokenEnv}`);
  async function request(route: string, body: unknown, signal: AbortSignal): Promise<string> {
    const response = await fetch(new URL(route, endpoint), {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`Study controller ${response.status}: ${text}`);
    return text;
  }
  const output = {
    schema: { type: 'string' as const },
    render: (_args: unknown, value: unknown) => [{ type: 'text' as const, text: String(value) }],
  };
  ctx.tools.register(
    defineTool({
      name: 'optimizer_study_search',
      description:
        'Inspect an admitted development search by jobID from study status: public task identities, actual harness candidates, run IDs, outcomes and probes. Use these recorded IDs for original evidence. Sealed validation and private graders are unavailable.',
      parameters: { jobID: { type: 'string', required: true } },
      output,
      execute: async (args, exec) => request('/study/search', args, exec.signal),
    }),
  );
  const evidenceParameters = {
    kind: { type: 'string' as const, enum: ['method', 'optimizer', 'run', 'candidate', 'probe'] },
    id: { type: 'string' as const, description: 'Required except for optimizer episode evidence.' },
    jobID: {
      type: 'string' as const,
      description: 'Required for optimizer/run/candidate/probe; forbidden for method.',
    },
    area: { type: 'string' as const, description: 'Required except for optimizer episode evidence.' },
    episode: {
      type: 'integer' as const,
      description: 'Required only for optimizer: ordinal from optimizerEpisodes.',
    },
    file: { type: 'string' as const },
  };
  const reference = (args: {
    kind?: string;
    id?: string;
    jobID?: string;
    area?: string;
    episode?: number;
    file?: string;
  }) => {
    if (args.kind === 'optimizer') {
      if (!args.jobID || args.episode === undefined || args.id !== undefined || args.area !== undefined)
        throw new Error('Optimizer evidence requires jobID and episode, without id or area');
      return {
        kind: 'optimizer',
        jobID: args.jobID,
        episode: args.episode,
        ...(args.file === undefined ? {} : { file: args.file }),
      };
    }
    if (!args.id || !args.area || args.episode !== undefined)
      throw new Error('Method and task evidence require id and area, without episode');
    if (args.kind === 'method') {
      if (args.jobID !== undefined) throw new Error('Method evidence does not accept a search job');
      return {
        kind: 'method',
        id: args.id,
        area: args.area,
        ...(args.file === undefined ? {} : { file: args.file }),
      };
    }
    if (!args.jobID) throw new Error('Search evidence requires a registered development jobID');
    return {
      kind: 'search',
      jobID: args.jobID,
      reference: {
        kind: args.kind,
        id: args.id,
        area: args.area,
        ...(args.file === undefined ? {} : { file: args.file }),
      },
    };
  };
  ctx.tools.register(
    defineTool({
      name: 'optimizer_study_evidence',
      description:
        'Read authorized original development evidence. optimizer: jobID and episode from optimizerEpisodes, for the optimizer session trace, receipt and metrics (no id/area). method areas: source/artifact/build/qa/behavior-qa; run: input/delivery/trace; candidate: source/build/artifact/qa; probe: source/suite/build/artifact/logs/observations. Omit file for exact inventory; supplied files return base64. For binary processing use optimizer_study_materialize. No assessment or final-validation files.',
      parameters: { ...evidenceParameters, kind: { ...evidenceParameters.kind, required: true } },
      output,
      execute: async (args, exec) => request('/study/evidence', reference(args), exec.signal),
    }),
  );
  ctx.tools.register(
    defineTool({
      name: 'optimizer_study_materialize',
      description:
        'Publish an authorized, explicitly inventoried development evidence file as exact bytes at a read-only /evidence path. Uses the same kind/id/jobID/area authorization as optimizer_study_evidence. Returns byte count, SHA-256 and provenance; inspect with native file or format tools. Never transcribe base64 into an output file.',
      parameters: {
        ...evidenceParameters,
        kind: { ...evidenceParameters.kind, required: true },
        file: { type: 'string', required: true },
      },
      output,
      execute: async (args, exec) => request('/study/materialize', reference(args), exec.signal),
    }),
  );
  ctx.tools.register(
    defineTool({
      name: 'optimizer_study_status',
      description:
        'Read registered optimizer methods, development search-instance outcomes, fixed budgets and event cursor. Each method searches the same initial harness under the same budget. Development scores guide method research; final validation is unavailable to this session.',
      parameters: {},
      output,
      execute: async (_args, exec) => request('/study/status', {}, exec.signal),
    }),
  );
  ctx.tools.register(
    defineTool({
      name: 'optimizer_study_branch',
      description:
        'Publish a writable source draft of a registered optimizer method. Returns its exact /workspace path, draft name, frozen parent candidate/source/method identities and built-bundle composition entry. targetRole search-optimizer means this draft will optimize harnesses in the inner searches; the running meta optimizer stays unchanged. Repeating the same parent and draft preserves existing edits. Use native coding tools at the returned path. Parent is the registered method candidate ID from status.',
      parameters: { parent: { type: 'string', required: true }, draft: { type: 'string', required: true } },
      output,
      execute: async (args, exec) => request('/study/branch', args, exec.signal),
    }),
  );
  ctx.tools.register(
    defineTool({
      name: 'optimizer_study_submit',
      description:
        'Reserve and freeze a changed optimizer Bundle for its own locked build and native QA, followed by the registered development searches. Supply a composition path inside the built bundle. Parent values are registered SOURCE digests. Build failure consumes the method slot; identical source cannot be resampled. Returns admission identity; wait for actual outcomes.',
      parameters: {
        draft: { type: 'string', required: true },
        composition: { type: 'string', required: true },
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
      execute: async (args, exec) => {
        const { composition, ...proposal } = args;
        return request('/study/submit', { composition, proposal }, exec.signal);
      },
    }),
  );
  ctx.tools.register(
    defineTool({
      name: 'optimizer_study_wait',
      description:
        'Wait on the committed development event cursor. An empty timeout page does not cancel or retry any method or child search. Continue from the returned cursor and drain hasMore pages. Final validation events are not exposed.',
      parameters: {
        experimentId: { type: 'string', required: true },
        sequence: { type: 'integer', required: true },
      },
      output,
      execute: async (args, exec) => request('/study/events', { cursor: args }, exec.signal),
    }),
  );
  ctx.tools.register(
    defineTool({
      name: 'optimizer_study_finish',
      description:
        'Conclude method development once all admitted development work has settled. After the host records the rationale, mark the current native agent turn complete at its committed result batch; DSH drains already submitted steering and context first. The coordinator then selects by the preregistered rule and independently validates, without returning validation feedback for further tuning.',
      parameters: { reason: { type: 'string', required: true } },
      output,
      execute: async (args, exec) => {
        const result = await request('/study/finish', args, exec.signal);
        exec.signal.throwIfAborted();
        exec.concludeTurn();
        return result;
      },
    }),
  );
}
