import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { Context } from '@deepseek-ai/cordis';
import SystemPrompt from '@deepseek-ai/dsh-system-prompt';
import Tools from '@deepseek-ai/dsh-tools';
import { ToolCallId } from '@deepseek-ai/dsh-llm';
import { DeepSeekHarness } from '@deepseek-ai/dsh-sdk-client';
import { stringify } from 'yaml';
import * as Evolution from '../../src/plugin.js';
import { closeControlServer } from '../../src/control-transport.js';
import { evolutionPreset, sdkPreset } from '../../src/preset.js';

type ResponseMode = 'accept' | 'reject' | 'pending';

/** Host acknowledgement fixture; the actual native tool and SDK run unmodified. */
async function host(token: string, initial: ResponseMode) {
  let mode = initial,
    calls = 0;
  let entered!: () => void, release!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  const errors: unknown[] = [];
  const server = createServer((request, response) => {
    void (async () => {
      assert.equal(request.method, 'POST');
      assert.equal(request.url, '/finish');
      assert.equal(request.headers.authorization, `Bearer ${token}`);
      let body = '';
      for await (const chunk of request) body += String(chunk);
      const { reason } = JSON.parse(body) as { reason: string };
      assert.equal(typeof reason, 'string');
      assert.ok(reason.length > 0);
      calls++;
      if (mode === 'pending') {
        entered();
        await pending;
      }
      response.setHeader('content-type', 'application/json');
      if (mode === 'reject') {
        response.writeHead(409).end(JSON.stringify({ error: 'Candidate evaluation remains pending' }));
      } else {
        response.end(JSON.stringify({ conclusion: { reason, champion: null } }));
      }
    })().catch((error) => {
      errors.push(error);
      if (!response.destroyed) response.writeHead(500).end('Fixture protocol violation');
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw Error('Missing fixture address');
  return {
    endpoint: `http://127.0.0.1:${address.port}`,
    started,
    release,
    setMode(next: ResponseMode) {
      mode = next;
    },
    calls: () => calls,
    async close() {
      release();
      await closeControlServer(server);
      assert.deepEqual(errors, []);
    },
  };
}

test('evolution_finish concludes only after acknowledged HTTP success; rejection and cancellation do not conclude', async () => {
  const ctx = new Context(),
    token = 'e'.repeat(64),
    tokenEnv = 'HE_EVOLUTION_FINISH_NATIVE_TOKEN';
  const control = await host(token, 'accept');
  process.env[tokenEnv] = token;
  try {
    await ctx.plugin(SystemPrompt);
    await ctx.plugin(Tools);
    await ctx.plugin(Evolution, { endpoint: control.endpoint, tokenEnv });
    const call = (signal = AbortSignal.timeout(5000)) =>
      ctx.tools.execute({
        callId: ToolCallId('ordinary-finish-native'),
        name: 'evolution_finish',
        arguments: { reason: 'Explicit native conclusion' },
        signal,
      });
    const accepted = await call();
    assert.equal(accepted.isError, false);
    assert.equal(accepted.concludesTurn, true);
    assert.match(String(accepted.value), /"conclusion":/);

    control.setMode('reject');
    const rejected = await call();
    assert.equal(rejected.isError, true);
    assert.equal(rejected.concludesTurn, undefined);
    assert.match(JSON.stringify(rejected.content), /evaluation remains pending/);

    control.setMode('pending');
    const abort = new AbortController(),
      result = call(abort.signal);
    await control.started;
    abort.abort(Error('Caller cancelled pending finish'));
    control.release();
    const cancelled = await result;
    assert.equal(cancelled.isError, true);
    assert.equal(cancelled.concludesTurn, undefined);
    assert.equal(control.calls(), 3);
  } finally {
    control.release();
    await ctx.fiber.dispose();
    delete process.env[tokenEnv];
    await control.close();
  }
});

test(
  'ordinary evolution finish uses the actual SDK loop for success, rejection and runtime cancellation',
  { timeout: 60_000 },
  async (t) => {
    for (const mode of ['accept', 'reject', 'pending'] as const)
      await t.test(mode, async () => {
        const root = await mkdtemp(path.join(os.tmpdir(), 'he-evolution-finish-sdk-')),
          token = 'f'.repeat(64);
        const control = await host(token, mode);
        const patch = path.join(root, 'patch.yml'),
          requestsFile = path.join(root, 'requests.jsonl');
        await writeFile(
          patch,
          stringify([
            {
              insert: [
                {
                  id: 'evolution-finish-provider',
                  name: path.resolve('tests/native/evolution-finish-provider.mjs'),
                },
                ...sdkPreset('evolution', path.resolve('dist/sdk-preset.js'), 'sdk'),
                evolutionPreset({
                  plugin: path.resolve('dist/plugin.js'),
                  endpoint: control.endpoint,
                  tokenEnv: 'HE_EVOLUTION_FINISH_SDK_TOKEN',
                }),
              ],
            },
          ]),
        );
        const runtime = new DeepSeekHarness({
          profile: 'sdk',
          patches: [patch],
          dshHome: path.join(root, 'home'),
          cwd: root,
          provider: 'evolution-finish-fixture',
          model: 'protocol-fixture',
          initializeTimeoutMs: 30_000,
          requestTimeoutMs: 30_000,
          env: {
            ...process.env,
            HE_EVOLUTION_FINISH_SDK_TOKEN: token,
            HE_EVOLUTION_FINISH_REQUESTS: requestsFile,
          },
        });
        try {
          const run = runtime.run('Exercise native evolution finish.');
          if (mode === 'pending') {
            // The installed SDK cancels an owned turn by closing its runtime, not a prompt-cancel RPC.
            const rejected = assert.rejects(run, /closed|shutdown|exit|EOF/i);
            await control.started;
            await runtime.close();
            control.release();
            await rejected;
          } else {
            const result = await run;
            assert.ok(result.events.some((event) => event.type === 'tool/result'));
            assert.ok(result.events.some((event) => event.type === 'turn/end'));
            if (mode === 'reject')
              assert.equal(result.finalResponse, 'continued-after-evolution-finish-rejection');
          }
          const requests = (await readFile(requestsFile, 'utf8')).trim().split('\n');
          assert.equal(control.calls(), 1);
          assert.equal(requests.length, mode === 'reject' ? 2 : 1);
        } finally {
          control.release();
          await runtime.close();
          await control.close();
          await rm(root, { recursive: true, force: true });
        }
      });
  },
);
