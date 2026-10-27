import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Experiment } from '../src/contracts.js';
import { Store } from '../src/store.js';
import { Controller } from '../src/controller.js';
import { OptimizerAccess } from '../src/optimizer-access.js';
import { serve } from '../src/api.js';
import { readEvidence, materializeEvidence } from '../src/evidence.js';
import { treeDigest } from '../src/artifacts.js';
import { candidate, specification } from './fixtures.js';

test('feedback protocol is explicit, frozen and rejects unequal behavioral side channels', () => {
  const spec = specification();
  const { hostSearchProtocol: _protocol, ...old } = spec;
  assert.equal(Experiment.safeParse(old).success, false);
  assert.equal(
    Experiment.safeParse({
      ...spec,
      hostSearchProtocol: { ancestry: 'unrestricted', feedback: 'mechanical' },
    }).success,
    false,
  );
  for (const feedback of ['full', 'mechanical'] as const) {
    const controlled = { ...spec, hostSearchProtocol: { ancestry: 'seed-only' as const, feedback } };
    assert.equal(Experiment.safeParse(controlled).success, true);
    for (const change of [
      { probes: { limit: 1, timeoutSeconds: 1 } },
      { researchLibrary: { directory: 'library', digest: 'a'.repeat(64) } },
      { candidate: { ...spec.candidate, qa: { directory: 'qa', digest: 'a'.repeat(64), entry: 'run.mjs' } } },
    ])
      assert.equal(Experiment.safeParse({ ...controlled, ...change }).success, false);
  }
});

test('full and mechanical expose the same public programming contract and preserve different outcome views', () => {
  const fullSpec = specification();
  fullSpec.hostSearchProtocol = { ancestry: 'seed-only', feedback: 'full' };
  const mechanicalSpec = {
    ...fullSpec,
    hostSearchProtocol: { ancestry: 'seed-only' as const, feedback: 'mechanical' as const },
  };
  const fullStore = new Store(':memory:', fullSpec),
    mechanicalStore = new Store(':memory:', mechanicalSpec);
  try {
    for (const store of [fullStore, mechanicalStore]) {
      const seed = candidate();
      seed.phase = 'champion';
      seed.mean = 0.123456;
      store.addCandidate(seed);
      store.setMeta('champion', seed.digest);
    }
    const full = new OptimizerAccess(new Controller('/unused', '/unused', fullSpec, fullStore)).status();
    const mechanical = new OptimizerAccess(
      new Controller('/unused', '/unused', mechanicalSpec, mechanicalStore),
    ).status();
    const { hostSearchProtocol: _full, ...fullPublic } = full.specification;
    const { hostSearchProtocol: _mechanical, ...mechanicalPublic } = mechanical.specification;
    assert.deepEqual(fullPublic, mechanicalPublic);
    assert.ok(JSON.stringify(full).includes('0.123456'));
    assert.equal(JSON.stringify(mechanical).includes('0.123456'), false);
    assert.equal(JSON.stringify(full.specification).includes('evaluationDigest'), false);
  } finally {
    fullStore.close();
    mechanicalStore.close();
  }
});

test('mechanical host view seals HTTP aliases, submit replay, finish and materialized execution evidence', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'he-feedback-'));
  const spec = specification();
  spec.hostSearchProtocol = { ancestry: 'seed-only', feedback: 'mechanical' };
  const store = new Store(path.join(root, 'experiment.sqlite'), spec);
  const controller = new Controller(root, root, spec, store);
  store.acquire(controller.owner, Date.now(), 60_000);
  const seed = candidate('a'.repeat(64));
  seed.phase = 'champion';
  seed.mean = 0.314159;
  store.addCandidate(seed);
  await mkdir(path.join(root, 'candidates', seed.digest), { recursive: true });
  await writeFile(path.join(root, 'candidates', seed.digest, 'source.txt'), 'original source');
  await mkdir(path.join(root, 'drafts', 'child'), { recursive: true });
  await writeFile(path.join(root, 'drafts', 'child', 'source.txt'), 'own changed source');
  const child = candidate(await treeDigest(path.join(root, 'drafts', 'child')), 1);
  child.proposal = { ...child.proposal, draft: 'child', parents: [seed.digest] };
  child.phase = 'rejected';
  child.mean = 0.271828;
  store.addCandidate(child);
  store.setMeta('champion', seed.digest);
  for (const task of spec.tasks) {
    await mkdir(path.join(root, task.input), { recursive: true });
    await writeFile(path.join(root, task.input, 'input.txt'), `PUBLIC_${task.id}`);
  }
  const run = 'b'.repeat(64),
    hidden = 'PRIVATE_EXECUTION_CANARY';
  store.event('run.transition', { id: run, extra: { grade: { score: 0.271828, feedback: hidden } } });
  store.event('candidate.decision', {
    candidate: child.digest,
    mean: 0.271828,
    champion: seed.digest,
    hidden,
  });
  store.event('future.private.feedback', { hidden });
  const access = new OptimizerAccess(controller);
  const token = 'c'.repeat(64);
  const server = await serve(controller, token, 0, '127.0.0.1');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const post = async (route: string, body: unknown) => {
    const response = await fetch(`http://127.0.0.1:${address.port}${route}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
    return { status: response.status, body: (await response.json()) as any };
  };
  try {
    const state = await post('/status', {});
    assert.equal(state.status, 200);
    assert.equal(state.body.seed, seed.digest);
    assert.equal(state.body.candidates[1].phase, 'settled');
    for (const key of ['champion', 'runs', 'probes']) assert.equal(Object.hasOwn(state.body, key), false);
    assert.equal(JSON.stringify(state.body).includes('evaluationDigest'), false);
    const replay = await post('/submit', child.proposal);
    assert.equal(replay.status, 200);
    assert.equal(replay.body.phase, 'settled');
    assert.equal(Object.hasOwn(replay.body, 'mean'), false);
    assert.equal((await post('/branch', { parent: child.digest, draft: 'bad-parent' })).status, 400);
    assert.equal((await post('/submit', { ...child.proposal, parents: [child.digest] })).status, 400);
    assert.equal((await post('/branch', { parent: seed.digest, draft: 'new-child' })).status, 200);
    assert.equal(await readFile(path.join(root, 'drafts/new-child/source.txt'), 'utf8'), 'original source');
    for (const area of ['input', 'delivery', 'trace']) {
      assert.equal((await post('/evidence', { run, area })).status, 400);
      assert.equal((await post('/materialize', { kind: 'run', id: run, area, file: 'secret' })).status, 400);
    }
    for (const [route, body] of [
      ['/probe', { draft: 'child', suite: 'suite', entry: 'suite.mjs', hypothesis: 'probe' }],
      ['/probe-evidence', { probe: run, area: 'observations' }],
      ['/library', {}],
      ['/asset', { archive: run }],
      ['/import', { archive: run, draft: 'imported' }],
      ['/materialize', { kind: 'probe', id: run, area: 'logs', file: 'secret' }],
      ['/materialize', { kind: 'asset', id: run, area: 'source', file: 'secret' }],
    ] as const)
      assert.equal((await post(route, body)).status, 400, route);
    const input = await post('/input', { task: 'one', file: 'input.txt' });
    assert.equal(Buffer.from(input.body.data, 'base64').toString(), 'PUBLIC_one');
    const publication = await post('/materialize', {
      kind: 'task',
      id: 'one',
      area: 'input',
      file: 'input.txt',
    });
    assert.equal(publication.status, 200);
    assert.equal(
      await readFile(
        path.join(root, 'materialized', publication.body.path.split('/')[2], 'files/input.txt'),
        'utf8',
      ),
      'PUBLIC_one',
    );
    const page = await post('/events', {
      cursor: { ...access.cursor(), sequence: 0 },
      timeoutMs: 0,
      limit: 1,
    });
    assert.equal((await post('/events', { cursor: store.cursor(), timeoutMs: 0 })).status, 400);
    assert.equal(page.body.events.length, 1);
    assert.equal(page.body.cursor.sequence, 1);
    const all = access.page({ ...access.cursor(), sequence: 0 }, 100);
    assert.deepEqual(
      all.events.map((event) => event.sequence),
      [1, 2, 3],
    );
    assert.equal(all.events[2]!.type, 'candidate.settled');
    const finish = await post('/finish', { reason: 'finished own work' });
    assert.equal(finish.status, 200);
    assert.equal(Object.hasOwn(finish.body.conclusion, 'champion'), false);
    for (const value of [state.body, replay.body, all, finish.body]) {
      const serialized = JSON.stringify(value);
      assert.equal(serialized.includes(hidden), false);
      assert.equal(serialized.includes('0.271828'), false);
      assert.equal(serialized.includes('0.314159'), false);
    }
    assert.ok(
      JSON.stringify(controller.status()).includes('0.271828'),
      'raw host selection ledger remains complete',
    );
    assert.ok(JSON.stringify(store.events()).includes(hidden));
    assert.throws(
      () =>
        new Store(
          path.join(root, 'experiment.sqlite'),
          { ...spec, hostSearchProtocol: { ancestry: 'seed-only', feedback: 'full' } },
          'read',
        ),
      /specification changed/,
    );
    await assert.rejects(readEvidence(controller, { kind: 'run', id: run, area: 'trace' }), /not authorized/);
    await assert.rejects(
      materializeEvidence(controller, { kind: 'run', id: run, area: 'trace', file: 'secret' }),
      /not authorized/,
    );
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    store.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('hidden events do not wake visible waits or advance cursors; restart preserves view pagination', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'he-feedback-events-'));
  const file = path.join(root, 'experiment.sqlite'),
    spec = specification();
  spec.hostSearchProtocol = { ancestry: 'seed-only', feedback: 'mechanical' };
  let store = new Store(file, spec);
  try {
    let access = new OptimizerAccess(new Controller(root, root, spec, store));
    const cursor = access.cursor();
    let completed = false;
    const wait = access.wait(cursor, { timeoutMs: 100, limit: 100 }).then((page) => {
      completed = true;
      return page;
    });
    store.event('run.transition', { private: 'hidden' });
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(completed, false);
    assert.equal((await wait).cursor.sequence, 0);
    store.event('candidate.build_failed', { candidate: 'a'.repeat(64), error: 'PUBLIC_BUILD_ERROR' });
    const before = access.page(cursor, 100);
    assert.equal(before.events[0]!.sequence, 1);
    store.close();
    store = new Store(file, spec);
    access = new OptimizerAccess(new Controller(root, root, spec, store));
    assert.deepEqual(access.page(cursor, 100), before);
    assert.throws(
      () => access.page({ ...cursor, viewDigest: 'f'.repeat(64) }, 100),
      /another optimizer feedback view/,
    );
    assert.throws(() => access.page({ ...cursor, sequence: 2 }, 100), /ahead/);
  } finally {
    store.close();
    await rm(root, { recursive: true, force: true });
  }
});
