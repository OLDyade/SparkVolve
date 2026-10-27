// Deterministic transport/authorization fixture, not an optimizer or an efficacy experiment.
import { LlmAdapter, ToolCallId } from '@deepseek-ai/dsh-llm';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

export const inject = ['llm'];
export function apply(ctx) {
  class FeedbackFixture extends LlmAdapter {
    calls = 0;
    stage = 'status';
    queue = [];
    async resolveModel(provider, id) {
      return { provider, id, name: 'Host feedback protocol fixture', context: { contextWindow: 262144 } };
    }
    async *stream(options) {
      if (++this.calls > 90) throw new Error('Protocol fixture exceeded its finite action budget');
      const objects = [];
      const walk = (value) => {
        if (typeof value === 'string') {
          try {
            walk(JSON.parse(value));
          } catch {
            /* Ordinary message text is not JSON. */
          }
        } else if (value && typeof value === 'object') {
          objects.push(value);
          for (const child of Object.values(value)) walk(child);
        }
      };
      walk(options.messages);
      const last = (predicate) => objects.findLast(predicate);
      const state = last((value) => value.cursor && value.specification && Array.isArray(value.candidates));
      appendFileSync(
        '/trace/host-feedback-requests.jsonl',
        JSON.stringify({
          call: this.calls,
          stage: this.stage,
          tools: options.tools.map((tool) => tool.name),
          messages: options.messages,
        }) + '\n',
      );
      let next;
      if (this.stage === 'status') {
        next = ['evolution_status', {}];
        this.stage = 'prepare';
      } else if (this.stage === 'prepare') {
        if (!state) throw new Error('Native status response missing');
        this.mode = state.specification.hostSearchProtocol.feedback;
        this.seed = state.candidates[0].digest;
        this.task = state.specification.tasks[0].id;
        this.run = state.runs?.[0]?.id ?? 'e'.repeat(64);
        this.zeroCursor = { ...state.cursor, sequence: 0 };
        this.proposal = {
          draft: 'protocol-change',
          parents: [this.seed],
          actions: ['tune'],
          evidence: ['Public protocol source'],
          hypothesis: 'A comment-only change preserves the fixture behavior',
          expectedChange: 'Different source identity, identical task behavior; no quality claim',
        };
        this.queue = [
          ['evolution_input', { task: this.task }],
          ['evolution_input', { task: this.task, file: 'message.txt' }],
          ['evolution_materialize', { kind: 'task', id: this.task, area: 'input', file: 'message.txt' }],
          ['check-materialized', {}],
          ['evolution_candidate', { candidate: this.seed, area: 'source', file: 'index.mjs' }],
          ['evolution_candidate', { candidate: this.seed, area: 'artifact' }],
          ['evolution_candidate', { candidate: this.seed, area: 'qa' }],
          ['evolution_wait', this.zeroCursor],
          ['evolution_evidence', { run: this.run, area: 'input', file: 'message.txt' }],
          ['evolution_evidence', { run: this.run, area: 'delivery', file: 'result.txt' }],
          ['evolution_materialize', { kind: 'run', id: this.run, area: 'delivery', file: 'result.txt' }],
          ['evolution_evidence', { run: this.run, area: 'trace', file: 'feedback-private.txt' }],
          ['evolution_library', {}],
          ['evolution_asset', { archive: 'a'.repeat(64) }],
          ['evolution_import', { archive: 'a'.repeat(64), draft: 'forbidden-import' }],
          [
            'evolution_probe',
            { draft: 'missing', suite: 'missing', entry: 'probe.mjs', hypothesis: 'Must be unauthorized' },
          ],
          ['evolution_probe_evidence', { probe: 'a'.repeat(64), area: 'observations' }],
          [
            'evolution_materialize',
            { kind: 'probe', id: 'a'.repeat(64), area: 'observations', file: 'private.txt' },
          ],
          [
            'evolution_materialize',
            { kind: 'asset', id: 'a'.repeat(64), area: 'source', file: 'private.txt' },
          ],
          ['evolution_branch', { parent: this.seed, draft: 'protocol-change' }],
          [
            'bash',
            {
              description: 'Append a fixture comment to candidate source',
              command:
                "printf '\\n// native feedback fixture source change\\n' >> /workspace/protocol-change/index.mjs",
            },
          ],
          ['evolution_submit', this.proposal],
        ];
        this.stage = 'actions';
      }
      if (this.stage === 'actions' && !next) {
        next = this.queue.shift();
        if (!next) {
          this.stage = 'settle';
          next = ['evolution_status', {}];
        }
      } else if (this.stage === 'settle' && !next) {
        if (!state) throw new Error('Candidate status missing');
        const candidate = state.candidates.find((candidate) => candidate.ordinal === 1);
        if (!candidate) throw new Error('Native submission did not register the mutation');
        if (['frozen', 'running'].includes(candidate.phase)) {
          next = ['evolution_wait', state.cursor];
          this.stage = 'refresh';
        } else {
          if (!['settled', 'champion', 'rejected'].includes(candidate.phase))
            throw new Error(`Fixture candidate failed mechanically: ${candidate.phase}`);
          this.queue = [
            ['evolution_candidate', { candidate: candidate.digest, area: 'build' }],
            ['evolution_submit', this.proposal],
            ['evolution_branch', { parent: candidate.digest, draft: 'forbidden-descendant' }],
            ['evolution_submit', { ...this.proposal, parents: [candidate.digest] }],
            ['evolution_wait', this.zeroCursor],
            ['evolution_finish', { reason: 'Native host feedback boundary acceptance; no efficacy claim' }],
          ];
          this.stage = 'ending';
          next = this.queue.shift();
        }
      } else if (this.stage === 'refresh' && !next) {
        next = ['evolution_status', {}];
        this.stage = 'settle';
      } else if (this.stage === 'ending' && !next) next = this.queue.shift();

      if (next?.[0] === 'check-materialized') {
        const materialized = last(
          (value) => value.path?.startsWith('/evidence/') && value.reference?.kind === 'task',
        );
        if (!materialized) throw new Error('Native task materialization missing');
        const actual = readFileSync(materialized.path);
        if (createHash('sha256').update(actual).digest('hex') !== materialized.sha256)
          throw new Error('Materialized bytes do not match the exact receipt');
        let denied;
        try {
          appendFileSync(materialized.path, 'forbidden');
        } catch (error) {
          denied = error.code;
        }
        if (!['EROFS', 'EACCES'].includes(denied)) throw new Error('Evidence file is writable');
        for (const forbidden of ['/evaluation', '/var/run/docker.sock', '/runs', '/experiment.sqlite']) {
          try {
            readFileSync(forbidden);
            throw new Error(`Private mount exposed: ${forbidden}`);
          } catch (error) {
            if (error.code !== 'ENOENT') throw error;
          }
        }
        writeFileSync(
          '/trace/host-feedback-materialized.json',
          JSON.stringify({
            mode: this.mode,
            ...materialized,
            observedSha256: materialized.sha256,
            writeDenied: denied,
          }),
        );
        next = [
          'bash',
          { description: 'Read the exact public input snapshot', command: `cat '${materialized.path}'` },
        ];
      }
      if (next) {
        const [name, args] = next;
        if (!options.tools.some((tool) => tool.name === name)) throw new Error(`Native tool absent: ${name}`);
        yield { type: 'block-start', index: 0, blockType: 'tool-call' };
        yield {
          type: 'block-end',
          index: 0,
          block: {
            type: 'tool-call',
            id: ToolCallId(`feedback-${this.calls}`),
            name,
            arguments: JSON.stringify(args),
          },
        };
        yield { type: 'usage', usage: { inputTokens: 7, outputTokens: 3 } };
        yield { type: 'finish', reason: 'tool-calls' };
      } else {
        yield { type: 'block-start', index: 0, blockType: 'text' };
        yield {
          type: 'block-end',
          index: 0,
          block: { type: 'text', text: 'Host feedback fixture complete' },
        };
        yield { type: 'usage', usage: { inputTokens: 5, outputTokens: 2 } };
        yield { type: 'finish', reason: 'stop' };
      }
    }
  }
  ctx.llm.registerAdapter(['host-feedback-fixture'], new FeedbackFixture());
}
