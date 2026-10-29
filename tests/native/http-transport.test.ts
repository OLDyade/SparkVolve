import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { stringify } from 'yaml';
import { DeepSeekHarness } from '@deepseek-ai/dsh-sdk-client';
import { requestMetrics } from '../../src/metrics.js';

// Set SPARKVOLVE_HTTP_HEADER_DELAY_MS=305000 for a real socket regression beyond Node's
// former five-minute limit. Normal CI exercises the same native provider path.
const delay = Number(process.env.SPARKVOLVE_HTTP_HEADER_DELAY_MS ?? 250);
if (!Number.isFinite(delay) || delay < 0 || delay >= 600000) throw Error('Invalid header delay');
test(
  'native Pi/OpenAI transport honors a 600s budget without an independent 300s header limit',
  { timeout: 660000 },
  async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'he-http-native-'));
    const ledger = path.join(root, 'requests.jsonl');
    let calls = 0;
    const server = createServer(async (req, res) => {
      calls++;
      for await (const _ of req) {
        /* consume actual SDK request */
      }
      const timer = setTimeout(() => {
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        const chunk = (delta: object, finish: string | null) => ({
          id: 'native-http',
          object: 'chat.completion.chunk',
          created: 1,
          model: 'protocol-test',
          choices: [{ index: 0, delta, finish_reason: finish }],
        });
        res.write(
          `data: ${JSON.stringify(chunk({ role: 'assistant', content: 'transport-complete' }, null))}\n\n`,
        );
        res.write(`data: ${JSON.stringify(chunk({}, 'stop'))}\n\n`);
        res.end('data: [DONE]\n\n');
      }, delay);
      res.on('close', () => clearTimeout(timer));
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const addr = server.address();
    assert.ok(addr && typeof addr !== 'string');
    const patch = path.join(root, 'patch.yml');
    await writeFile(
      patch,
      stringify([
        {
          id: 'llm-pi-ai',
          config: {
            providers: {
              'http-fixture': {
                api: 'openai-completions',
                baseURL: `http://127.0.0.1:${addr.port}/v1`,
                apiKeyEnv: 'SPARKVOLVE_HTTP_FIXTURE_KEY',
                timeoutMs: 600000,
                streamIdleTimeoutMs: 600000,
                retryPolicy: { mode: 'normal', maxRetries: 0 },
                models: [
                  {
                    id: 'protocol-test',
                    contextWindow: 262144,
                    maxTokens: 1024,
                    input: ['text'],
                    compat: {
                      supportsDeveloperRole: false,
                      supportsStore: false,
                      maxTokensField: 'max_tokens',
                    },
                  },
                ],
              },
            },
          },
        },
        {
          insert: [
            {
              id: 'transport',
              name: path.resolve('dist/http-transport.js'),
              config: { timeoutSeconds: 600 },
            },
            {
              id: 'observer',
              name: path.resolve('dist/telemetry.js'),
              config: {
                file: ledger,
                provider: 'http-fixture',
                model: 'protocol-test',
                startedAt: Date.now(),
                timeoutSeconds: 600,
              },
            },
          ],
        },
      ]),
    );
    const runtime = new DeepSeekHarness({
      profile: 'sdk',
      patches: [patch],
      dshHome: path.join(root, 'home'),
      cwd: root,
      provider: 'http-fixture',
      model: 'protocol-test',
      initializeTimeoutMs: 30000,
      requestTimeoutMs: 600000,
      env: { ...process.env, SPARKVOLVE_HTTP_FIXTURE_KEY: 'local-protocol-fixture' },
    });
    const start = performance.now();
    try {
      const result = await runtime.run('Reply once.');
      assert.equal(result.finalResponse, 'transport-complete');
      assert.equal(calls, 1);
      assert.ok(performance.now() - start >= delay);
      const metrics = await requestMetrics(ledger);
      assert.equal(metrics.started, 1);
      assert.equal(metrics.unfinished, 0);
      const terminal = (await readFile(ledger, 'utf8'))
        .trim()
        .split('\n')
        .map((s) => JSON.parse(s))
        .filter((r) => r.kind === 'result');
      assert.equal(terminal.length, 1);
      console.log(
        JSON.stringify({ headerDelayMs: delay, elapsedMs: performance.now() - start, calls, root }),
      );
    } finally {
      await runtime.close();
      server.closeAllConnections();
      server.close();
      if (delay < 300000) await rm(root, { recursive: true, force: true });
    }
  },
);
