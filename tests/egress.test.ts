import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { once } from 'node:events';
import {
  EgressConfig,
  resolveEgressAddress,
  serveEgress,
  type EgressEvent,
  type Route,
} from '../src/egress.js';

const body = JSON.stringify({
  model: 'contracted-model',
  max_tokens: 32,
  messages: [{ role: 'user', content: 'hello' }],
});
const deferred = <T = void>() => Promise.withResolvers<T>();
function port(server: http.Server): number {
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  return address.port;
}
function cleanup(t: TestContext, server: http.Server) {
  t.after(
    () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      }),
  );
}
async function upstream(t: TestContext, handler: http.RequestListener) {
  const server = http.createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  cleanup(t, server);
  return server;
}
function route(server: http.Server, overrides: Partial<Route> = {}): Route {
  return {
    id: 'model',
    path: '/v1/chat/completions',
    method: 'POST',
    upstream: `http://upstream.invalid:${port(server)}/provider/chat`,
    addresses: { kind: 'exact', values: ['127.0.0.1'] },
    credential: { env: 'TEST_KEY', header: 'authorization', prefix: 'Bearer ' },
    body: { kind: 'json', equals: { model: 'contracted-model' }, maximum: { max_tokens: 64 } },
    maxRequestBytes: 1024,
    timeoutSeconds: 5,
    ...overrides,
  };
}
async function broker(
  t: TestContext,
  routes: Route[],
  options: Partial<Parameters<typeof serveEgress>[1]> = {},
) {
  const events: EgressEvent[] = [];
  const finished = deferred<EgressEvent>();
  const server = await serveEgress(
    { bindAddress: '127.0.0.1', port: 0, routes },
    {
      credentials: { TEST_KEY: 'trusted-test-secret' },
      resolve: async () => [{ address: '127.0.0.1', family: 4 }],
      record: (event) => {
        events.push(event);
        if (event.phase === 'finished') finished.resolve(event);
      },
      ...options,
    },
  );
  cleanup(t, server);
  return { server, events, finished: finished.promise, base: `http://127.0.0.1:${port(server)}` };
}
function post(base: string, data = body, path = '/v1/chat/completions') {
  return fetch(base + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer untrusted-client-value' },
    body: data,
  });
}

test('resolver failure records its native code and stage without leaking exception contents', async (t) => {
  const provider = await upstream(t, (_req, res) => res.end('unexpected'));
  const service = await broker(t, [route(provider)], {
    resolve: async () => {
      throw Object.assign(Error('private request and credential'), { code: 'EAI_AGAIN' });
    },
  });
  assert.equal((await post(service.base)).status, 502);
  const event = await service.finished;
  assert.equal(event.outcome, 'upstream_error');
  assert.deepEqual(event.failure, { stage: 'resolve', code: 'EAI_AGAIN' });
  assert.equal(event.address, undefined);
  assert.equal(event.transport?.resolvedMs, undefined);
  assert.equal(event.transport?.socketAssignedMs, undefined);
  assert.equal(JSON.stringify(service.events).includes('private request'), false);
});

test(
  'egress uses the exact route, pinned DNS address and broker credential without altering request bytes',
  { timeout: 10000 },
  async (t) => {
    let calls = 0,
      resolutions = 0;
    const received = deferred<{ body: string; headers: http.IncomingHttpHeaders; url: string | undefined }>();
    const provider = await upstream(t, (req, res) => {
      calls++;
      const chunks: Buffer[] = [];
      req.on('data', (chunk) => chunks.push(chunk));
      req.on('end', () => {
        received.resolve({ body: Buffer.concat(chunks).toString(), headers: req.headers, url: req.url });
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        res.end('data: {"ok":true}\n\ndata: [DONE]\n\n');
      });
    });
    const gateway = await broker(t, [route(provider)], {
      resolve: async (host) => {
        assert.equal(host, 'upstream.invalid');
        resolutions++;
        return [{ address: '127.0.0.1', family: 4 }];
      },
    });
    const response = await post(gateway.base);
    assert.equal(response.status, 200);
    assert.equal(await response.text(), 'data: {"ok":true}\n\ndata: [DONE]\n\n');
    const actual = await received.promise;
    assert.equal(actual.body, body);
    assert.equal(actual.url, '/provider/chat');
    assert.equal(actual.headers.host, `upstream.invalid:${port(provider)}`);
    assert.equal(actual.headers.authorization, 'Bearer trusted-test-secret');
    assert.equal(calls, 1);
    assert.equal(resolutions, 1);
    assert.equal((await gateway.finished).outcome, 'completed');
    assert.equal(gateway.events.length, 2);
    assert.equal(gateway.events[0]!.id, gateway.events[1]!.id);
    assert.doesNotMatch(JSON.stringify(gateway.events), /trusted-test-secret|untrusted-client-value|hello/);
  },
);

test(
  'route, model, output budget, encoding and body limits deny requests before any provider call',
  { timeout: 10000 },
  async (t) => {
    let calls = 0;
    const provider = await upstream(t, (_req, res) => {
      calls++;
      res.end();
    });
    const gateway = await broker(t, [route(provider)]);
    for (const path of ['/unknown', '/v1/chat/completions?target=elsewhere', '/v1/chat/%63ompletions'])
      assert.equal((await post(gateway.base, body, path)).status, 403);
    assert.equal((await fetch(gateway.base + '/v1/chat/completions')).status, 403);
    for (const data of [
      '{}',
      'null',
      '[]',
      '{',
      body.replace('contracted-model', 'another-model'),
      body.replace('32', '65'),
      body.replace('32', '0'),
      body.replace('32', '1.5'),
      JSON.stringify({ padding: 'x'.repeat(1024) }),
    ])
      assert.equal((await post(gateway.base, data)).status, 403);
    const compressed = await fetch(gateway.base + '/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'content-encoding': 'gzip' },
      body,
    });
    assert.equal(compressed.status, 403);
    assert.equal(calls, 0);
    assert.ok(
      gateway.events
        .filter((event) => event.phase === 'finished')
        .every((event) => event.outcome === 'denied'),
    );
  },
);

test(
  'streaming delivers the first event before provider completion and client cancellation closes upstream',
  { timeout: 10000 },
  async (t) => {
    const closed = deferred();
    const provider = await upstream(t, (req, res) => {
      req.resume();
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write('data: first\n\n');
      res.on('close', () => closed.resolve());
      // Intentionally remains open until the client cancels.
    });
    const gateway = await broker(t, [route(provider)]);
    const cancel = new AbortController();
    const response = await fetch(gateway.base + '/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
      signal: cancel.signal,
    });
    const reader = response.body!.getReader();
    assert.equal(new TextDecoder().decode((await reader.read()).value), 'data: first\n\n');
    cancel.abort();
    await closed.promise;
    assert.equal((await gateway.finished).outcome, 'cancelled');
  },
);

test('deadline terminates an unresponsive upstream and does not retry', { timeout: 10000 }, async (t) => {
  let calls = 0;
  const closed = deferred();
  const provider = await upstream(t, (req, res) => {
    calls++;
    req.resume();
    res.on('close', () => closed.resolve());
  });
  const gateway = await broker(t, [route(provider, { timeoutSeconds: 1 })]);
  await assert.rejects(post(gateway.base));
  await closed.promise;
  assert.equal((await gateway.finished).outcome, 'timeout');
  assert.equal(calls, 1);
});

test(
  'upstream reset is recorded once; redirects and HTTP errors are never retried',
  { timeout: 10000 },
  async (t) => {
    let calls = 0;
    const provider = await upstream(t, (req, res) => {
      calls++;
      req.resume();
      if (calls === 1) req.socket.destroy();
      else if (calls === 2) {
        res.writeHead(307, { location: 'http://127.0.0.1:1/leak' });
        res.end('redirect');
      } else {
        res.writeHead(429, { 'retry-after': '7' });
        res.end('quota');
      }
    });
    const gateway = await broker(t, [route(provider)]);
    const reset = await post(gateway.base);
    assert.equal(reset.status, 502);
    assert.equal(((await reset.json()) as { error: string }).error, 'upstream_error');
    const failed = await gateway.finished;
    assert.equal(failed.failure?.stage, 'headers');
    assert.equal(failed.failure?.code, 'ECONNRESET');
    assert.ok(failed.transport?.tcpConnectedMs !== undefined);
    assert.ok(failed.transport?.requestFlushedMs !== undefined);
    assert.equal(failed.transport?.responseHeadersMs, undefined);
    assert.equal(failed.transport?.tlsConnectedMs, undefined);
    assert.equal(failed.transport?.reusedSocket, false);
    const redirect = await post(gateway.base);
    assert.equal(redirect.status, 307);
    assert.equal(await redirect.text(), 'redirect');
    assert.equal(redirect.headers.get('location'), null);
    const quota = await post(gateway.base);
    assert.equal(quota.status, 429);
    assert.equal(quota.headers.get('retry-after'), '7');
    assert.equal(await quota.text(), 'quota');
    assert.equal(calls, 3);
  },
);

test('transport measures delayed response headers separately from TCP and local request flush', async (t) => {
  let calls = 0;
  const provider = await upstream(t, (req, res) => {
    calls++;
    req.resume();
    setTimeout(() => res.end('ready'), 60);
  });
  const gateway = await broker(t, [route(provider)]);
  assert.equal(await (await post(gateway.base)).text(), 'ready');
  const { transport } = await gateway.finished;
  assert.ok(transport);
  for (const name of [
    'bodyReadMs',
    'resolvedMs',
    'socketAssignedMs',
    'tcpConnectedMs',
    'requestFlushedMs',
    'responseHeadersMs',
    'responseCompleteMs',
  ] as const)
    assert.ok(Number.isFinite(transport[name]), name);
  assert.ok(transport.responseHeadersMs! - transport.tcpConnectedMs! >= 40);
  assert.ok(transport.responseHeadersMs! >= transport.requestFlushedMs!);
  assert.ok(transport.responseCompleteMs! >= transport.responseHeadersMs!);
  assert.ok(transport.elapsedMs >= transport.responseCompleteMs!);
  assert.equal(transport.tlsConnectedMs, undefined);
  assert.equal(calls, 1);
});

test('DNS contract rejects private, mapped, reserved and mixed answers without a second resolution', async () => {
  const base: Route = {
    id: 'public',
    path: '/model',
    method: 'GET',
    upstream: 'https://provider.invalid/path',
    addresses: { kind: 'public' },
    credential: null,
    body: { kind: 'empty' },
    maxRequestBytes: 1,
    timeoutSeconds: 5,
  };
  for (const address of [
    '127.0.0.1',
    '10.1.2.3',
    '169.254.169.254',
    '192.168.1.1',
    '0.0.0.0',
    '224.0.0.1',
    '::1',
    '::ffff:127.0.0.1',
    'fc00::1',
    'fe80::1',
    '2001:db8::1',
  ]) {
    let resolutions = 0;
    await assert.rejects(
      resolveEgressAddress(base, async () => {
        resolutions++;
        return [
          { address: '1.1.1.1', family: 4 },
          { address, family: net.isIP(address) },
        ];
      }),
      /outside route contract/,
    );
    assert.equal(resolutions, 1);
  }
  assert.deepEqual(await resolveEgressAddress(base, async () => [{ address: '1.1.1.1', family: 4 }]), {
    address: '1.1.1.1',
    family: 4,
  });
  await assert.rejects(
    resolveEgressAddress(base, async () => []),
    /No resolved/,
  );
  await assert.rejects(
    resolveEgressAddress(base, async () => [{ address: '1.1.1.1', family: 6 }]),
    /Invalid DNS/,
  );
  await assert.rejects(
    resolveEgressAddress({ ...base, upstream: 'https://127.0.0.1/path' }, async () => {
      throw Error('must not resolve literal');
    }),
    /outside route contract/,
  );
});

test('CONNECT and protocol upgrades cannot open a tunnel', { timeout: 10000 }, async (t) => {
  let calls = 0;
  const provider = await upstream(t, (_req, res) => {
    calls++;
    res.end();
  });
  const gateway = await broker(t, [route(provider)]);
  for (const request of [
    'CONNECT example.com:443 HTTP/1.1\r\nHost: example.com\r\n\r\n',
    'GET /v1/chat/completions HTTP/1.1\r\nHost: localhost\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n',
  ]) {
    const socket = net.connect(port(gateway.server), '127.0.0.1');
    const chunks: Buffer[] = [];
    socket.on('data', (chunk) => chunks.push(chunk));
    await once(socket, 'connect');
    socket.end(request);
    await once(socket, 'close');
    assert.equal(Buffer.concat(chunks).length, 0);
  }
  assert.equal(calls, 0);
});

test(
  'missing credentials fail startup; evidence failure closes the broker and exposes an error',
  { timeout: 10000 },
  async (t) => {
    let calls = 0;
    const provider = await upstream(t, (_req, res) => {
      calls++;
      res.end();
    });
    const config = { bindAddress: '127.0.0.1', port: 0, routes: [route(provider)] };
    await assert.rejects(
      serveEgress(config, { credentials: {}, record: () => {} }),
      /Missing egress credential/,
    );
    const gateway = await serveEgress(config, {
      credentials: { TEST_KEY: 'secret' },
      record: () => {
        throw Error('disk full');
      },
    });
    const base = `http://127.0.0.1:${port(gateway)}`;
    const fault = once(gateway, 'error');
    const stopped = new Promise<void>((resolve) => gateway.once('close', resolve));
    await assert.rejects(post(base));
    assert.match((await fault)[0].message, /evidence write failed/);
    await stopped;
    assert.equal(gateway.listening, false);
    assert.equal(calls, 0);
    assert.equal(
      EgressConfig.safeParse({ ...config, routes: [route(provider), route(provider)] }).success,
      false,
    );
    assert.equal(
      EgressConfig.safeParse({ ...config, routes: [route(provider, { addresses: { kind: 'public' } })] })
        .success,
      false,
    );
  },
);
