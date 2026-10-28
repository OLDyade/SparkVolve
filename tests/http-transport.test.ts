import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { installTransport } from '../src/http-transport.js';

test('transport owns matching fetch primitives, enforces header/body budgets and restores globals', async () => {
  const original = globalThis.fetch,
    request = globalThis.Request;
  let requests = 0;
  const server = createServer((req, res) => {
    requests++;
    if (req.url === '/ok') res.end('ready');
    if (req.url === '/body') {
      res.writeHead(200);
      res.write('start');
    }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const addr = server.address();
  assert.ok(addr && typeof addr !== 'string');
  const url = `http://127.0.0.1:${addr.port}`;
  assert.throws(() => installTransport(0), /positive/);
  const close = installTransport(0.1);
  try {
    assert.notEqual(globalThis.Request, request);
    assert.throws(() => installTransport(1), /already installed/);
    assert.equal(await (await fetch(new Request(url + '/ok'))).text(), 'ready');
    await assert.rejects(
      fetch(url + '/headers'),
      (error: any) => error.cause?.code === 'UND_ERR_HEADERS_TIMEOUT',
    );
    const response = await fetch(url + '/body');
    await assert.rejects(response.text(), (error: any) => error.cause?.code === 'UND_ERR_BODY_TIMEOUT');
    await assert.rejects(fetch(url + '/abort', { signal: AbortSignal.timeout(20) }), {
      name: 'TimeoutError',
    });
    assert.equal(requests, 4, 'No hidden retry');
  } finally {
    await close();
    server.closeAllConnections();
    server.close();
  }
  assert.equal(globalThis.fetch, original);
  assert.equal(globalThis.Request, request);
});
