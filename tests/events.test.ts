import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { Store } from '../src/store.js';
import { Controller } from '../src/controller.js';
import { serve } from '../src/api.js';
import type { EventPage } from '../src/events.js';
import { specification } from './fixtures.js';

test('committed events replay without gaps; rollback cannot wake observers', async () => {
  const store = new Store(':memory:', specification());
  try {
    const cursor = store.cursor();
    let settled = false;
    const waiting = store.wait(cursor).then((page) => {
      settled = true;
      return page;
    });
    assert.throws(
      () =>
        store.transaction(() => {
          store.event('discarded', {});
          throw new Error('rollback');
        }),
      /rollback/,
    );
    await Promise.resolve();
    assert.equal(settled, false);
    assert.equal(store.page(cursor).events.length, 0);
    store.transaction(() => {
      for (let n = 0; n < 205; n++) store.event('committed', { n });
    });
    const first = await waiting;
    assert.equal(first.events.length, 100);
    assert.equal(first.hasMore, true);
    const second = await store.wait(first.cursor);
    const third = await store.wait(second.cursor);
    assert.equal(third.hasMore, false);
    assert.deepEqual(
      [...first.events, ...second.events, ...third.events].map((event) => event.body),
      Array.from({ length: 205 }, (_, n) => ({ n })),
    );
    const empty = await store.wait(third.cursor, { timeoutMs: 0 });
    assert.deepEqual(empty.cursor, third.cursor);
    assert.deepEqual(empty.events, []);
    await assert.rejects(
      store.wait({ ...cursor, experimentId: '00000000-0000-4000-8000-000000000000' }),
      /another experiment/,
    );
    await assert.rejects(store.wait({ ...cursor, sequence: 999 }), /ahead/);
  } finally {
    store.close();
  }
});

test('restart and a second SQLite connection preserve cursor replay', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'he-events-'));
  const file = path.join(root, 'events.sqlite');
  const spec = specification();
  let store = new Store(file, spec);
  try {
    const cursor = store.cursor();
    const waiting = store.wait(cursor, { timeoutMs: 30 });
    const writer = new Store(file, spec);
    writer.event('external-commit', {});
    writer.close();
    assert.equal((await waiting).events[0]!.type, 'external-commit');
    store.close();
    store = new Store(file, spec);
    assert.equal((await store.wait(cursor)).events[0]!.type, 'external-commit');
    assert.equal(store.cursor().experimentId, cursor.experimentId);
  } finally {
    store.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('wait cancellation and store shutdown release pending subscriptions', async () => {
  const store = new Store(':memory:', specification());
  const abort = new AbortController();
  const waiting = store.wait(store.cursor(), { signal: abort.signal });
  const reason = new Error('client stopped');
  abort.abort(reason);
  await assert.rejects(waiting, (error) => error === reason);
  const closed = store.wait(store.cursor());
  store.close();
  await assert.rejects(closed, /store closed/);
});

test('HTTP long poll wakes on commit, reconnect replays and shutdown cancels an idle wait', async () => {
  const spec = specification();
  const store = new Store(':memory:', spec);
  const stop = new AbortController();
  const token = 'b'.repeat(64);
  const server = await serve(
    new Controller('/unused', '/unused', spec, store),
    token,
    0,
    '127.0.0.1',
    stop.signal,
  );
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  const post = (route: string, body: unknown, signal?: AbortSignal) =>
    fetch(base + route, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
      signal: signal ?? null,
    });
  try {
    const state = (await (await post('/status', {})).json()) as { cursor: ReturnType<Store['cursor']> };
    // A committed event between snapshot and request must still be observed.
    store.event('candidate.decision', { promoted: true });
    const page = (await (await post('/events', { cursor: state.cursor })).json()) as EventPage;
    assert.equal(page.events[0]!.type, 'candidate.decision');
    const disconnected = new AbortController();
    const failed = post('/events', { cursor: page.cursor }, disconnected.signal);
    disconnected.abort();
    await assert.rejects(failed);
    store.event('search.concluded', { reason: 'complete' });
    const replay = (await (await post('/events', { cursor: page.cursor })).json()) as EventPage;
    assert.equal(replay.events[0]!.type, 'search.concluded');
    const active = post('/events', { cursor: replay.cursor });
    store.event('next', {});
    assert.equal(((await (await active).json()) as EventPage).events[0]!.type, 'next');
    const latest = (await (await post('/status', {})).json()) as { cursor: unknown };
    const idle = post('/events', { cursor: latest.cursor });
    stop.abort(new Error('server stopping'));
    assert.equal((await idle).status, 400);
  } finally {
    stop.abort();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    store.close();
  }
});
