import test from 'node:test';
import assert from 'node:assert/strict';
import { Context } from '@deepseek-ai/cordis';
import SystemPrompt from '@deepseek-ai/dsh-system-prompt';
import Tools from '@deepseek-ai/dsh-tools';
import { ToolCallId } from '@deepseek-ai/dsh-llm';
import * as Study from '../../src/study-plugin.js';
import { serveStudy } from '../../src/study-api.js';
import { StudyBranchReceipt } from '../../src/study-control.js';

test('native study tools send actual validated requests and unload their registrations', async () => {
  const requests: Array<{ operation: string; input: unknown }> = [];
  const abort = new AbortController();
  process.env.HE_STUDY_TEST_CAPABILITY = 'd'.repeat(64);
  const server = await serveStudy(
    {
      status: () => ({ phase: 'developing' }),
      search: async (jobID) => ({ jobID }),
      evidence: async (input) => {
        requests.push({ operation: 'evidence', input });
        return [];
      },
      materialize: async (input) => {
        requests.push({ operation: 'materialize', input });
        return { path: '/evidence/fixture/input.bin' };
      },
      branch: async (parent, draft) => {
        requests.push({ operation: 'branch', input: { parent, draft } });
        return StudyBranchReceipt.parse({
          draft,
          path: `/workspace/${draft}`,
          targetRole: 'search-optimizer',
          parent: {
            candidateId: parent,
            sourceDigest: 'b'.repeat(64),
            methodIdentity: 'c'.repeat(64),
            composition: 'plugins.yml',
          },
        });
      },
      submit: async (input) => {
        requests.push({ operation: 'submit', input });
        return { id: 'b'.repeat(64), phase: 'preparing' };
      },
      events: async (input) => ({ cursor: input.cursor, events: [], hasMore: false }),
      finish: async (reason) => ({ reason }),
    },
    process.env.HE_STUDY_TEST_CAPABILITY,
    0,
    '127.0.0.1',
    abort.signal,
  );
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing address');
  const ctx = new Context();
  try {
    await ctx.plugin(SystemPrompt);
    await ctx.plugin(Tools);
    const fork = ctx.plugin(Study, {
      endpoint: `http://127.0.0.1:${address.port}`,
      tokenEnv: 'HE_STUDY_TEST_CAPABILITY',
    });
    await fork;
    assert.deepEqual(
      ctx.tools
        .schemas()
        .map((tool) => tool.name)
        .sort(),
      [
        'optimizer_study_branch',
        'optimizer_study_evidence',
        'optimizer_study_finish',
        'optimizer_study_materialize',
        'optimizer_study_search',
        'optimizer_study_status',
        'optimizer_study_submit',
        'optimizer_study_wait',
      ],
    );
    const call = async (name: string, args: Record<string, unknown>) =>
      ctx.tools.execute({
        callId: ToolCallId(name),
        name,
        arguments: args,
        signal: AbortSignal.timeout(5000),
      });
    assert.equal((await call('optimizer_study_status', {})).isError, false);
    assert.equal(
      (await call('optimizer_study_branch', { parent: 'a'.repeat(64), draft: 'new-method' })).isError,
      false,
    );
    const proposal = {
      draft: 'new-method',
      parents: ['a'.repeat(64)],
      actions: ['compose'],
      evidence: ['observed development behavior'],
      hypothesis: 'Independent tests can distinguish a failed mechanism',
      expectedChange: 'Choose an evidence-supported composition',
    };
    const submission = await call('optimizer_study_submit', { ...proposal, composition: 'plugins.yml' });
    assert.equal(submission.isError, false);
    assert.deepEqual(requests[1], { operation: 'submit', input: { proposal, composition: 'plugins.yml' } });
    assert.equal(
      (
        await call('optimizer_study_wait', {
          experimentId: 'b503531b-e3c9-4d15-b189-2466e996709b',
          sequence: 0,
        })
      ).isError,
      false,
    );
    assert.equal(
      (await call('optimizer_study_finish', { reason: 'No unresolved development runs' })).isError,
      false,
    );
    assert.equal(
      (await call('optimizer_study_branch', { parent: 'a'.repeat(64), draft: '../escape' })).isError,
      true,
    );
    assert.equal(requests.length, 2);
    assert.equal((await call('optimizer_study_search', { jobID: 'c'.repeat(64) })).isError, false);
    assert.equal(
      (await call('optimizer_study_evidence', { kind: 'method', id: 'b'.repeat(64), area: 'source' }))
        .isError,
      false,
    );
    assert.deepEqual(requests[2], {
      operation: 'evidence',
      input: { kind: 'method', id: 'b'.repeat(64), area: 'source' },
    });
    assert.equal(
      (
        await call('optimizer_study_materialize', {
          kind: 'run',
          jobID: 'c'.repeat(64),
          id: 'd'.repeat(64),
          area: 'input',
          file: 'input.bin',
        })
      ).isError,
      false,
    );
    assert.deepEqual(requests[3], {
      operation: 'materialize',
      input: {
        kind: 'search',
        jobID: 'c'.repeat(64),
        reference: { kind: 'run', id: 'd'.repeat(64), area: 'input', file: 'input.bin' },
      },
    });
    assert.equal(
      (await call('optimizer_study_evidence', { kind: 'run', id: 'd'.repeat(64), area: 'input' })).isError,
      true,
    );
    assert.equal(
      (
        await call('optimizer_study_evidence', {
          kind: 'method',
          jobID: 'c'.repeat(64),
          id: 'b'.repeat(64),
          area: 'source',
        })
      ).isError,
      true,
    );
    assert.equal(
      (
        await call('optimizer_study_materialize', {
          kind: 'run',
          jobID: 'c'.repeat(64),
          id: 'd'.repeat(64),
          area: 'evaluation',
          file: 'secret.json',
        })
      ).isError,
      true,
    );
    assert.equal(requests.length, 4);
    const episode = { kind: 'optimizer', jobID: 'c'.repeat(64), episode: 0 };
    assert.equal((await call('optimizer_study_evidence', episode)).isError, false);
    assert.deepEqual(requests[4], { operation: 'evidence', input: episode });
    assert.equal(
      (await call('optimizer_study_materialize', { ...episode, file: 'metrics.json' })).isError,
      false,
    );
    assert.deepEqual(requests[5], { operation: 'materialize', input: { ...episode, file: 'metrics.json' } });
    for (const invalid of [
      { ...episode, episode: -1 },
      { ...episode, id: 'd'.repeat(64) },
      { ...episode, area: 'trace' },
    ])
      assert.equal((await call('optimizer_study_evidence', invalid)).isError, true);
    assert.equal(requests.length, 6);
    await fork.dispose();
    assert.deepEqual(ctx.tools.schemas(), []);
  } finally {
    await ctx.fiber.dispose();
    delete process.env.HE_STUDY_TEST_CAPABILITY;
    abort.abort(new Error('test cleanup'));
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
