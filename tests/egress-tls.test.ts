import test from 'node:test';
import assert from 'node:assert/strict';
import https from 'node:https';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import type { EgressEvent } from '../src/egress.js';

const exec = promisify(execFile);
test(
  'runtime preserves TLS authentication and never stores injected credentials in its ledger',
  { timeout: 30000 },
  async (t) => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'he-egress-tls-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const key = path.join(root, 'test-only.key');
    const cert = path.join(root, 'test-only.pem');
    await exec(
      'openssl',
      [
        'req',
        '-x509',
        '-newkey',
        'rsa:2048',
        '-nodes',
        '-keyout',
        key,
        '-out',
        cert,
        '-days',
        '1',
        '-subj',
        '/CN=127.0.0.1',
        '-addext',
        'subjectAltName=IP:127.0.0.1',
      ],
      { timeout: 10000 },
    );
    let calls = 0,
      streaming = false;
    const provider = https.createServer(
      { key: await readFile(key), cert: await readFile(cert) },
      (req, res) => {
        calls++;
        assert.equal(req.headers.authorization, 'Bearer test-only-tls-secret');
        res.setHeader('content-type', 'text/event-stream');
        if (streaming) res.write('data: first\n\n');
        else res.end('data: [DONE]\n\n');
      },
    );
    await new Promise<void>((resolve) => provider.listen(0, '127.0.0.1', resolve));
    t.after(
      () =>
        new Promise<void>((resolve) => {
          provider.close(() => resolve());
          provider.closeAllConnections();
        }),
    );
    const address = provider.address();
    assert.ok(address && typeof address !== 'string');
    const config = path.join(root, 'config.json');
    await writeFile(
      config,
      JSON.stringify({
        bindAddress: '127.0.0.1',
        port: 0,
        routes: [
          {
            id: 'tls',
            path: '/model',
            method: 'GET',
            upstream: `https://127.0.0.1:${address.port}/`,
            addresses: { kind: 'exact', values: ['127.0.0.1'] },
            credential: { env: 'TEST_KEY', header: 'authorization', prefix: 'Bearer ' },
            body: { kind: 'empty' },
            maxRequestBytes: 1,
            timeoutSeconds: 5,
          },
        ],
      }),
    );
    for (const mode of ['untrusted', 'trusted', 'shutdown']) {
      const trusted = mode !== 'untrusted';
      streaming = mode === 'shutdown';
      const ledger = path.join(root, `requests-${mode}.jsonl`);
      const env: NodeJS.ProcessEnv = { ...process.env, TEST_KEY: 'test-only-tls-secret' };
      delete env.NODE_TLS_REJECT_UNAUTHORIZED;
      delete env.NODE_EXTRA_CA_CERTS;
      if (trusted) env.NODE_EXTRA_CA_CERTS = cert;
      const child = spawn(
        process.execPath,
        [
          '--import',
          fileURLToPath(new URL('../node_modules/tsx/dist/loader.mjs', import.meta.url)),
          fileURLToPath(new URL('../src/runtime/egress.ts', import.meta.url)),
          config,
          ledger,
        ],
        { env, stdio: ['ignore', 'pipe', 'pipe'] },
      );
      const exit = once(child, 'exit');
      const ready = Promise.withResolvers<number>();
      let stdout = '',
        stderr = '';
      child.stdout.on('data', (chunk) => {
        stdout += chunk;
        if (stdout.includes('\n'))
          ready.resolve((JSON.parse(stdout.split('\n')[0]!) as { address: { port: number } }).address.port);
      });
      child.stderr.on('data', (chunk) => {
        stderr += chunk;
      });
      child.once('error', ready.reject);
      child.once('exit', () => ready.reject(new Error(`Egress exited before readiness: ${stderr}`)));
      try {
        const response = await fetch(`http://127.0.0.1:${await ready.promise}/model`);
        assert.equal(response.status, trusted ? 200 : 502);
        if (streaming) {
          const reader = response.body!.getReader();
          assert.equal(new TextDecoder().decode((await reader.read()).value), 'data: first\n\n');
          child.kill('SIGTERM');
          await assert.rejects(reader.read());
        } else {
          const text = await response.text();
          if (trusted) assert.equal(text, 'data: [DONE]\n\n');
          else assert.equal((JSON.parse(text) as { error: string }).error, 'upstream_error');
        }
      } finally {
        if (!child.killed) child.kill('SIGTERM');
        assert.equal((await exit)[0], 0, stderr);
      }
      const events = (await readFile(ledger, 'utf8'))
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line) as EgressEvent);
      assert.equal(events.length, 2);
      assert.equal(events[1]!.outcome, streaming ? 'cancelled' : trusted ? 'completed' : 'upstream_error');
      const observed = events[1]!.transport;
      assert.ok(observed?.tcpConnectedMs !== undefined);
      if (trusted) {
        assert.ok(observed.tlsConnectedMs! >= observed.tcpConnectedMs);
        assert.equal(observed.tlsAuthorized, true);
        assert.ok(observed.responseHeadersMs! >= observed.tlsConnectedMs!);
      } else {
        assert.equal(events[1]!.failure?.stage, 'tls');
        assert.equal(observed.tlsConnectedMs, undefined);
        assert.equal(observed.responseHeadersMs, undefined);
      }
      assert.doesNotMatch(JSON.stringify({ events, stdout, stderr }), /test-only-tls-secret/);
    }
    assert.equal(calls, 2, 'Untrusted TLS connection must not send an authenticated HTTP request');
  },
);
