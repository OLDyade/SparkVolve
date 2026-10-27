import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { Context } from '@deepseek-ai/cordis';
import SystemPrompt from '@deepseek-ai/dsh-system-prompt';
import Tools from '@deepseek-ai/dsh-tools';
import { ToolCallId } from '@deepseek-ai/dsh-llm';
import { DeepSeekHarness } from '@deepseek-ai/dsh-sdk-client';
import { stringify } from 'yaml';
import * as Study from '../../src/study-plugin.js';
import type { StudyControl } from '../../src/study-control.js';
import { serveStudy } from '../../src/study-api.js';
import { closeControlServer } from '../../src/control-transport.js';
import { evolutionPreset, sdkPreset } from '../../src/preset.js';

function control(finish: StudyControl['finish']): StudyControl {
  const unused = async () => {
    throw Error('Unexpected capability in finish protocol test');
  };
  return {
    status: () => ({}),
    branch: unused,
    submit: unused,
    events: unused,
    search: unused,
    evidence: unused,
    materialize: unused,
    finish,
  };
}

test('native finish marks only host-acknowledged successful results; rejection and cancellation do not conclude', async () => {
  const ctx = new Context(),
    lifetime = new AbortController();
  let mode: 'accept' | 'reject' | 'wait' = 'accept';
  let entered!: () => void, release!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  const token = 'd'.repeat(64),
    env = 'HE_NATIVE_FINISH_CAPABILITY';
  process.env[env] = token;
  const server = await serveStudy(
    control(async (reason) => {
      if (mode === 'reject') throw Error('Development work still pending');
      if (mode === 'wait') {
        entered();
        await waiting;
      }
      return { concluded: true, reason };
    }),
    token,
    0,
    '127.0.0.1',
    lifetime.signal,
  );
  const address = server.address();
  if (!address || typeof address === 'string') throw Error('Missing finish address');
  try {
    await ctx.plugin(SystemPrompt);
    await ctx.plugin(Tools);
    await ctx.plugin(Study, { endpoint: `http://127.0.0.1:${address.port}`, tokenEnv: env });
    const call = (signal = AbortSignal.timeout(5000)) =>
      ctx.tools.execute({
        callId: ToolCallId('finish-native'),
        name: 'optimizer_study_finish',
        arguments: { reason: 'Explicit native test conclusion' },
        signal,
      });
    const accepted = await call();
    assert.equal(accepted.isError, false);
    assert.equal(accepted.concludesTurn, true);
    assert.match(String(accepted.value), /"concluded":true/);
    mode = 'reject';
    const rejected = await call();
    assert.equal(rejected.isError, true);
    assert.equal(rejected.concludesTurn, undefined);
    assert.match(JSON.stringify(rejected.content), /work still pending/);
    mode = 'wait';
    const aborted = new AbortController(),
      pending = call(aborted.signal);
    await started;
    aborted.abort(Error('Cancelled native finish observation'));
    release();
    const cancelled = await pending;
    assert.equal(cancelled.isError, true);
    assert.equal(cancelled.concludesTurn, undefined);
  } finally {
    release();
    lifetime.abort();
    await ctx.fiber.dispose();
    delete process.env[env];
    await closeControlServer(server);
  }
});

test(
  'actual SDK native loop commits finish success without another model request, and continues after host rejection',
  { timeout: 60_000 },
  async (t) => {
    for (const succeeds of [true, false])
      await t.test(succeeds ? 'host accepted' : 'host rejected', async () => {
        const root = await mkdtemp(path.join(os.tmpdir(), 'he-study-finish-sdk-'));
        const abort = new AbortController(),
          token = 'a'.repeat(64);
        let finishes = 0;
        const server = await serveStudy(
          control(async (reason) => {
            finishes++;
            if (!succeeds) throw Error('Development fixture is still pending');
            return { concluded: true, reason };
          }),
          token,
          0,
          '127.0.0.1',
          abort.signal,
        );
        const address = server.address();
        if (!address || typeof address === 'string') throw Error('Missing address');
        const patch = path.join(root, 'patch.yml');
        await writeFile(
          patch,
          stringify([
            {
              insert: [
                { id: 'study-finish-provider', name: path.resolve('tests/native/study-finish-provider.mjs') },
                ...sdkPreset('evolution', path.resolve('dist/sdk-preset.js')),
                evolutionPreset({
                  plugin: path.resolve('dist/study-plugin.js'),
                  endpoint: `http://127.0.0.1:${address.port}`,
                  tokenEnv: 'HE_FINISH_CAPABILITY',
                }),
              ],
            },
          ]),
        );
        const requestsFile = path.join(root, 'requests.jsonl');
        const runtime = new DeepSeekHarness({
          profile: 'sdk',
          patches: [patch],
          dshHome: path.join(root, 'home'),
          cwd: root,
          provider: 'study-finish-fixture',
          model: 'protocol-fixture',
          initializeTimeoutMs: 30_000,
          requestTimeoutMs: 30_000,
          env: { ...process.env, HE_FINISH_CAPABILITY: token, HE_FINISH_REQUESTS: requestsFile },
        });
        try {
          const result = await runtime.run('Exercise native study finish protocol.');
          const requests = (await readFile(requestsFile, 'utf8'))
            .trim()
            .split('\n')
            .map((row) => JSON.parse(row));
          assert.equal(finishes, 1);
          assert.equal(requests.length, succeeds ? 1 : 2);
          assert.ok(result.events.some((event) => event.type === 'tool/result'));
          assert.ok(result.events.some((event) => event.type === 'turn/end'));
          if (!succeeds) assert.equal(result.finalResponse, 'continued-after-finish-rejection');
        } finally {
          await runtime.close();
          abort.abort();
          await closeControlServer(server);
          await rm(root, { recursive: true, force: true });
        }
      });
  },
);
