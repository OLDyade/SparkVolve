import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { Context } from '@deepseek-ai/cordis';
import SystemPrompt from '@deepseek-ai/dsh-system-prompt';
import Tools from '@deepseek-ai/dsh-tools';
import { ToolCallId } from '@deepseek-ai/dsh-llm';
import * as Evolution from '../../src/plugin.js';

test('native Cordis registers, executes and disposes evolution capabilities', async () => {
  const received: string[] = [];
  const server = createServer((req, res) => {
    assert.equal(req.headers.authorization, 'Bearer native-test-capability');
    received.push(req.url!);
    res.writeHead(200, { 'content-type': 'application/json' }).end('{"champion":null}');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Server did not bind');
  process.env.HE_TEST_CAPABILITY = 'native-test-capability';
  const ctx = new Context();
  try {
    await ctx.plugin(SystemPrompt);
    await ctx.plugin(Tools);
    const fork = ctx.plugin(Evolution, {
      endpoint: `http://127.0.0.1:${address.port}`,
      tokenEnv: 'HE_TEST_CAPABILITY',
    });
    await fork;
    assert.deepEqual(
      ctx.tools
        .schemas()
        .map((s) => s.name)
        .sort(),
      [
        'evolution_asset',
        'evolution_branch',
        'evolution_candidate',
        'evolution_evidence',
        'evolution_finish',
        'evolution_import',
        'evolution_library',
        'evolution_materialize',
        'evolution_probe',
        'evolution_probe_evidence',
        'evolution_status',
        'evolution_submit',
        'evolution_wait',
      ],
    );
    const result = await ctx.tools.execute({
      callId: ToolCallId('native-call'),
      name: 'evolution_status',
      arguments: {},
      signal: AbortSignal.timeout(5000),
    });
    assert.equal(result.isError, false);
    assert.deepEqual(received, ['/status']);
    await fork.dispose();
    assert.deepEqual(ctx.tools.schemas(), []);
  } finally {
    try {
      await ctx.fiber.dispose();
    } finally {
      delete process.env.HE_TEST_CAPABILITY;
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  }
});
