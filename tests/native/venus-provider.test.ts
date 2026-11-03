import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parse, stringify } from 'yaml';
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm';
import { DeepSeekHarness } from '@deepseek-ai/dsh-sdk-client';
import { serveEgress } from '../../src/egress.js';

test(
  'Venus native Chat adapter preserves frozen model, off mode and tool replay',
  { timeout: 60000 },
  async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'he-venus-native-'));
    const requests: any[] = [];
    const upstream = createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c);
      requests.push({ headers: req.headers, body: JSON.parse(Buffer.concat(chunks).toString()) });
      const first = requests.length === 1;
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const emit = (delta: object, finish_reason: string | null) =>
        res.write(
          'data: ' +
            JSON.stringify({
              id: 'chat-fixture',
              object: 'chat.completion.chunk',
              created: 1,
              model: 'deepseek-v4-flash-0731',
              choices: [{ index: 0, delta, finish_reason }],
            }) +
            '\n\n',
        );
      emit(
        first
          ? {
              role: 'assistant',
              tool_calls: [
                {
                  index: 0,
                  id: 'call_sum',
                  type: 'function',
                  function: { name: 'sum_integers', arguments: '{"a":37,"b":58}' },
                },
              ],
            }
          : { role: 'assistant', content: 'sum=95' },
        null,
      );
      emit({}, first ? 'tool_calls' : 'stop');
      res.end('data: [DONE]\n\n');
    });
    upstream.listen(0, '127.0.0.1');
    await once(upstream, 'listening');
    const addr = upstream.address();
    assert.ok(addr && typeof addr !== 'string');
    const broker = await serveEgress(
      {
        bindAddress: '127.0.0.1',
        port: 0,
        routes: [
          {
            id: 'venus',
            path: '/v1/chat/completions',
            method: 'POST',
            upstream: 'http://127.0.0.1:' + addr.port + '/v1/chat/completions',
            addresses: { kind: 'exact', values: ['127.0.0.1'] },
            credential: { env: 'FIXTURE_KEY', header: 'authorization', prefix: 'Bearer ' },
            body: {
              kind: 'json',
              equals: { model: 'deepseek/deepseek-v4-flash-0731' },
              maximum: { max_tokens: 393216 },
            },
            maxRequestBytes: 8388608,
            timeoutSeconds: 900,
          },
        ],
      },
      { credentials: { FIXTURE_KEY: 'broker-only-fixture' }, record: () => {} },
    );
    const baddr = broker.address();
    assert.ok(baddr && typeof baddr !== 'string');
    const patch = parse(await readFile('examples/venus/cordis.patch.yml', 'utf8'));
    patch[0].config.providers.venus.baseURL = 'http://127.0.0.1:' + baddr.port + '/v1';
    patch.push({
      insert: [{ id: 'fixture-tools', name: path.resolve('tests/native/deepseek-fixture-tools.mjs') }],
    });
    const file = path.join(root, 'patch.yml');
    await writeFile(file, stringify(patch));
    const runtime = new DeepSeekHarness({
      profile: 'sdk',
      patches: [file],
      dshHome: path.join(root, 'home'),
      cwd: root,
      provider: 'venus',
      model: 'deepseek/deepseek-v4-flash-0731',
      reasoningEffort: ReasoningEffortId('off'),
      maxTokens: 393216,
      requestTimeoutMs: 900000,
      env: { ...process.env, VENUS_API_KEY: 'placeholder' },
    });
    try {
      const result = await runtime.run('Calculate 37 plus 58 using sum_integers.');
      assert.equal(result.finalResponse, 'sum=95');
      assert.equal(requests.length, 2);
      for (const r of requests) {
        assert.equal(r.headers.authorization, 'Bearer broker-only-fixture');
        assert.equal(r.body.model, 'deepseek/deepseek-v4-flash-0731');
        assert.equal(r.body.enable_thinking, false);
        assert.equal(r.body.max_tokens, 393216);
        assert.equal(r.body.stream, true);
      }
      assert.ok(
        requests[1].body.messages.some(
          (m: any) =>
            m.role === 'tool' && m.tool_call_id === 'call_sum' && JSON.stringify(m.content).includes('95'),
        ),
      );
    } finally {
      await runtime.close();
      await broker.shutdown();
      upstream.closeAllConnections();
      await new Promise<void>((resolve) => upstream.close(() => resolve()));
      await rm(root, { recursive: true, force: true });
    }
  },
);
