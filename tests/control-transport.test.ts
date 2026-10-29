import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { mkdtemp, readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { channel } from 'node:diagnostics_channel';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { listenControlTransport, closeControlServer } from '../src/control-transport.js';
import { evolve } from '../src/experiment.js';
import { Controller } from '../src/controller.js';
import { Store } from '../src/store.js';
import { specification } from './fixtures.js';

const request = { host: '127.0.0.1', port: 0, endpoint: 'http://127.0.0.1:0' };
async function socket(port: number): Promise<Server> {
  const server = createServer((_req, res) => res.end('transport works'));
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      server.removeListener('error', reject);
      resolve();
    });
  });
  return server;
}
function saved(root: string) {
  const db = new DatabaseSync(path.join(root, 'control-transport.sqlite'));
  try {
    const row = db.prepare('SELECT record FROM transport WHERE id=1').get();
    return row ? JSON.parse(row.record as string) : null;
  } finally {
    db.close();
  }
}

test('port zero freezes the real socket and explicit endpoint zero; restart binds exactly the same identity', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'he-control-transport-'));
  const first = await listenControlTransport(root, request, socket);
  try {
    assert.ok(first.record.bound.port > 0);
    assert.equal(first.record.endpoint, `http://127.0.0.1:${first.record.bound.port}`);
    assert.deepEqual(saved(root), first.record);
    assert.equal(await (await fetch(first.record.controlEndpoint)).text(), 'transport works');
  } finally {
    await closeControlServer(first.server);
  }
  const second = await listenControlTransport(root, request, socket);
  try {
    assert.deepEqual(second.record, first.record);
    assert.equal(await (await fetch(second.record.endpoint)).text(), 'transport works');
  } finally {
    await closeControlServer(second.server);
  }
});

test('explicit proxy port is preserved; changed request and occupied original port never select a replacement', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'he-control-proxy-'));
  const proxy = { ...request, endpoint: 'https://192.0.2.1:9443' };
  const first = await listenControlTransport(root, proxy, socket);
  assert.equal(first.record.endpoint, proxy.endpoint);
  await closeControlServer(first.server);
  let binds = 0;
  await assert.rejects(
    listenControlTransport(root, { ...proxy, port: first.record.bound.port }, async (port) => {
      binds++;
      return socket(port);
    }),
    /contract changed/,
  );
  assert.equal(binds, 0);
  const occupied = await socket(first.record.bound.port);
  try {
    await assert.rejects(listenControlTransport(root, proxy, socket), { code: 'EADDRINUSE' });
  } finally {
    await closeControlServer(occupied);
  }
  assert.deepEqual(saved(root), first.record);
  const resumed = await listenControlTransport(root, proxy, socket);
  await closeControlServer(resumed.server);
  await assert.rejects(
    listenControlTransport(root, { ...proxy, endpoint: 'http://localhost:0' }, socket),
    /literal IP/,
  );
});

test('same-root concurrent first allocations contend before creating a second socket', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'he-control-concurrent-'));
  let opened!: () => void, release!: () => void;
  const ready = new Promise<void>((resolve) => {
    opened = resolve;
  });
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const first = listenControlTransport(root, request, async (port) => {
    const server = await socket(port);
    opened();
    await held;
    return server;
  });
  await ready;
  let competingBinds = 0;
  try {
    await assert.rejects(
      listenControlTransport(root, request, async (port) => {
        competingBinds++;
        return socket(port);
      }),
      /locked|busy/i,
    );
    assert.equal(competingBinds, 0);
  } finally {
    release();
  }
  const published = await first;
  assert.deepEqual(saved(root), published.record);
  await closeControlServer(published.server);
});

test('aborting after actual bind closes the socket and rolls back its unpublished identity', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'he-control-abort-'));
  const abort = new AbortController();
  let boundPort = 0;
  const events = channel('sparkvolve:control-transport');
  const listener = (message: unknown) => {
    const event = message as { root: string; phase: string; record: { bound: { port: number } } };
    if (event.root === root && event.phase === 'bound') {
      boundPort = event.record.bound.port;
      abort.abort(Error('cancel allocation'));
    }
  };
  events.subscribe(listener);
  try {
    await assert.rejects(listenControlTransport(root, request, socket, abort.signal), /cancel allocation/);
  } finally {
    events.unsubscribe(listener);
  }
  assert.equal(saved(root), null);
  const available = await socket(boundPort);
  await closeControlServer(available);
});

test('SIGKILL before or after commit recovers a complete transport record without ambiguous replacement', async () => {
  for (const phase of ['bound', 'committed']) {
    const root = await mkdtemp(path.join(os.tmpdir(), `he-control-killed-${phase}-`));
    const source = `
      import { createServer } from 'node:http';
      import { channel } from 'node:diagnostics_channel';
      import { writeFileSync } from 'node:fs';
      import { listenControlTransport } from ${JSON.stringify(pathToFileURL(path.resolve('src/control-transport.ts')).href)};
      const root=${JSON.stringify(root)};
      channel('sparkvolve:control-transport').subscribe(e=>{
        if(e.phase===${JSON.stringify(phase)}) { writeFileSync(root+'/observed.json',JSON.stringify(e.record)); process.kill(process.pid,'SIGKILL'); }
      });
      await listenControlTransport(root,${JSON.stringify(request)},async port=>{
        const s=createServer((q,r)=>r.end('ok'));
        await new Promise((resolve,reject)=>{s.once('error',reject);s.listen(port,'127.0.0.1',resolve)});return s;
      });`;
    const child = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '--eval', source], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', (data) => {
      stderr += data;
    });
    const ended = await new Promise<{ code: number | null; signal: string | null }>((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', (code, signal) => resolve({ code, signal }));
    });
    assert.equal(ended.signal, 'SIGKILL', stderr);
    const observed = JSON.parse(await readFile(path.join(root, 'observed.json'), 'utf8'));
    assert.deepEqual(saved(root), phase === 'committed' ? observed : null);
    const resumed = await listenControlTransport(root, request, socket);
    try {
      if (phase === 'committed') assert.deepEqual(resumed.record, observed);
    } finally {
      await closeControlServer(resumed.server);
    }
  }
});

test('evolve closes its committed HTTP socket when optimizer preparation fails', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'he-evolve-transport-failure-'));
  const spec = specification(),
    store = new Store(path.join(root, 'experiment.sqlite'), spec);
  class IdleController extends Controller {
    override async watch(signal: AbortSignal): Promise<void> {
      assert.ok(saved(root), 'Transport must commit before the execution pump can create containers');
      await new Promise<void>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      });
    }
  }
  const controller = new IdleController(root, path.join(root, 'dataset'), spec, store);
  try {
    await assert.rejects(
      evolve(controller, { ...request, signal: new AbortController().signal }),
      /Evolution stopped/,
    );
    const record = saved(root);
    assert.ok(record.bound.port > 0);
    const available = await socket(record.bound.port);
    await closeControlServer(available);
  } finally {
    store.close();
  }
});
