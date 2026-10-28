import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parse, stringify } from 'yaml';
import { DeepSeekHarness } from '@deepseek-ai/dsh-sdk-client';
import { serveEgress, type EgressEvent } from '../../src/egress.js';

test(
  'official native Messages adapter preserves tool replay through contracted egress',
  { timeout: 60000 },
  async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'he-official-native-'));
    const requests: Record<string, any>[] = [];
    const upstream = createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk);
      requests.push({
        url: req.url,
        headers: req.headers,
        body: JSON.parse(Buffer.concat(chunks).toString()),
      });
      const turn = requests.length;
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const emit = (type: string, data: object) =>
        res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
      emit('message_start', {
        message: {
          id: `msg_${turn}`,
          type: 'message',
          role: 'assistant',
          model: 'deepseek-flash',
          content: [],
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: 100, output_tokens: 0 },
        },
      });
      if (turn === 1) {
        emit('content_block_start', {
          index: 0,
          content_block: { type: 'tool_use', id: 'call_sum', name: 'sum_integers', input: {} },
        });
        emit('content_block_delta', {
          index: 0,
          delta: { type: 'input_json_delta', partial_json: '{"a":37,"b":58}' },
        });
      } else {
        emit('content_block_start', { index: 0, content_block: { type: 'text', text: '' } });
        emit('content_block_delta', { index: 0, delta: { type: 'text_delta', text: 'sum=95' } });
      }
      emit('content_block_stop', { index: 0 });
      emit('message_delta', {
        delta: { stop_reason: turn === 1 ? 'tool_use' : 'end_turn', stop_sequence: null },
        usage: { output_tokens: 20 },
      });
      emit('message_stop', {});
      res.end();
    });
    upstream.listen(0, '127.0.0.1');
    await once(upstream, 'listening');
    const address = upstream.address();
    assert.ok(address && typeof address !== 'string');
    const events: EgressEvent[] = [];
    const broker = await serveEgress(
      {
        bindAddress: '127.0.0.1',
        port: 0,
        routes: [
          {
            id: 'official',
            path: '/anthropic/v1/messages',
            method: 'POST',
            upstream: `http://127.0.0.1:${address.port}/anthropic/v1/messages`,
            addresses: { kind: 'exact', values: ['127.0.0.1'] },
            credential: { env: 'FIXTURE_KEY', header: 'x-api-key', prefix: '' },
            body: { kind: 'json', equals: { model: 'deepseek-flash' }, maximum: { max_tokens: 32768 } },
            maxRequestBytes: 8388608,
            timeoutSeconds: 600,
            forwardHeaders: ['anthropic-version', 'anthropic-beta', 'accept'],
          },
        ],
      },
      { credentials: { FIXTURE_KEY: 'broker-only-fixture' }, record: (event) => events.push(event) },
    );
    const brokerAddress = broker.address();
    assert.ok(brokerAddress && typeof brokerAddress !== 'string');
    const patch = parse(await readFile('examples/deepseek/cordis.patch.yml', 'utf8'));
    patch[0].config.baseURL = `http://127.0.0.1:${brokerAddress.port}/anthropic`;
    patch[0].config.reasoningEffort = 'off';
    patch.push({
      insert: [{ id: 'fixture-tools', name: path.resolve('tests/native/deepseek-fixture-tools.mjs') }],
    });
    const patchFile = path.join(root, 'patch.yml');
    await writeFile(patchFile, stringify(patch));
    const runtime = new DeepSeekHarness({
      profile: 'sdk',
      patches: [patchFile],
      dshHome: path.join(root, 'home'),
      cwd: root,
      provider: 'deepseek-official',
      model: 'deepseek-flash',
      maxTokens: 32768,
      requestTimeoutMs: 600000,
      env: { ...process.env, DEEPSEEK_API_KEY: 'client-placeholder' },
    });
    try {
      const result = await runtime.run('Calculate 37 plus 58 using sum_integers.');
      assert.equal(result.finalResponse, 'sum=95');
      assert.equal(requests.length, 2);
      for (const request of requests) {
        assert.equal(request.headers['x-api-key'], 'broker-only-fixture');
        assert.equal(request.headers['anthropic-version'], '2023-06-01');
        assert.equal(request.url, '/anthropic/v1/messages');
        assert.equal(request.body.model, 'deepseek-flash');
        assert.equal(request.body.thinking.type, 'disabled');
      }
      const blocks = requests[1]!.body.messages.flatMap((message: any) => message.content);
      assert.ok(
        blocks.some(
          (block: any) =>
            block.type === 'tool_result' &&
            block.tool_use_id === 'call_sum' &&
            JSON.stringify(block.content).includes('95'),
        ),
      );
      assert.equal(events.filter((event) => event.phase === 'started').length, 2);
      assert.equal(events.filter((event) => event.outcome === 'completed').length, 2);
    } finally {
      await runtime.close();
      await broker.shutdown();
      upstream.closeAllConnections();
      await new Promise<void>((resolve) => upstream.close(() => resolve()));
      await rm(root, { recursive: true, force: true });
    }
  },
);
