import test from 'node:test';
import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { serveStudy } from '../src/study-api.js';
import { StudyBranchReceipt, studyControlRoutes, type StudyControl } from '../src/study-control.js';
import { studyMethodIdentity } from '../src/optimizer-study-contracts.js';
import { studyBranchFixture } from './study-branch-fixture.js';

const branchReceipt = (parent: string, draft: string) =>
  StudyBranchReceipt.parse({
    path: `/workspace/${draft}`,
    draft,
    targetRole: 'search-optimizer',
    parent: {
      candidateId: parent,
      sourceDigest: 'b'.repeat(64),
      methodIdentity: 'c'.repeat(64),
      composition: 'plugins.yml',
    },
  });

test('study capability admits registered development operations and exposes no validation/file routes', async () => {
  const received: Array<{ operation: string; body: unknown }> = [];
  const signal = new AbortController();
  const control: StudyControl = {
    status: () => ({ phase: 'developing', methods: [] }),
    search: async (jobID) => ({ jobID }),
    evidence: async (reference) => ({ reference }),
    materialize: async (reference) => ({ reference, path: '/evidence/test/file' }),
    branch: async (parent, draft) => {
      received.push({ operation: 'branch', body: { parent, draft } });
      return branchReceipt(parent, draft);
    },
    submit: async (input) => {
      received.push({ operation: 'submit', body: input });
      return { phase: 'preparing' };
    },
    events: async (input, requestSignal) => {
      received.push({ operation: 'events', body: input });
      await new Promise<void>((_resolve, reject) => {
        requestSignal.throwIfAborted();
        requestSignal.addEventListener('abort', () => reject(requestSignal.reason), { once: true });
      });
    },
    finish: async () => {
      throw new Error('Development work is pending');
    },
  };
  const token = 'c'.repeat(64);
  const server = await serveStudy(control, token, 0, '127.0.0.1', signal.signal);
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing study address');
  const base = `http://127.0.0.1:${address.port}`;
  const request = (route: string, body: unknown, auth = token) =>
    fetch(base + route, {
      method: 'POST',
      headers: { authorization: `Bearer ${auth}` },
      body: JSON.stringify(body),
    });
  try {
    assert.equal((await request('/study/status', {}, 'invalid')).status, 401);
    assert.equal((await request('/study/status', {})).status, 200);
    assert.equal((await request('/study/status', { includeValidation: true })).status, 400);
    assert.equal((await request('/study/validation', {})).status, 404);
    assert.equal((await request('/evidence', { file: 'private/expected.json' })).status, 404);
    assert.equal(
      (await request('/study/branch', { parent: 'a'.repeat(64), draft: '../escape' })).status,
      400,
    );
    assert.equal(
      (await request('/study/branch', { parent: 'a'.repeat(64), draft: 'method-new' })).status,
      200,
    );
    const proposal = {
      draft: 'method-new',
      parents: ['b'.repeat(64)],
      actions: ['compose'],
      evidence: ['development job observations'],
      hypothesis: 'A plugin composition exposes independent mechanism experiments',
      expectedChange: 'Search tests alternatives before submission',
    };
    const admission = await request('/study/submit', { proposal, composition: 'plugins.yml' });
    assert.equal(admission.status, 200);
    assert.deepEqual(await admission.json(), { phase: 'preparing' });
    assert.equal((await request('/study/submit', { proposal, composition: '../private' })).status, 400);
    assert.equal((await request('/study/finish', { reason: 'settled' })).status, 400);
    const events = request('/study/events', {
      cursor: { experimentId: 'b503531b-e3c9-4d15-b189-2466e996709b', sequence: 0 },
    });
    while (!received.some((item) => item.operation === 'events'))
      await new Promise((resolve) => setTimeout(resolve, 5));
    signal.abort(new Error('Study observer stopped'));
    const response = await events;
    assert.equal(response.status, 400);
    assert.match(await response.text(), /Study observer stopped/);
    assert.equal((await request('/study/status', {})).status, 400);
    assert.deepEqual(
      received.map((item) => item.operation),
      ['branch', 'submit', 'events'],
    );
    const routes = studyControlRoutes('http://127.0.0.1:9876', 30);
    assert.equal(routes.length, 8);
    assert.equal(new Set(routes.map((route) => route.id)).size, 8);
    assert.ok(routes.every((route) => route.path.startsWith('/study/')));
    assert.ok(routes.every((route) => route.credential?.env === 'SPARKVOLVE_TOKEN'));
    assert.throws(() => studyControlRoutes('http://untrusted.example', 30), /literal IP/);
  } finally {
    signal.abort(new Error('test cleanup'));
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

test('parent interruption during a streamed request prevents admitting a mutation', async () => {
  const abort = new AbortController();
  let admitted = 0;
  const token = 'e'.repeat(64);
  const server = await serveStudy(
    {
      status: () => ({}),
      search: async () => ({}),
      evidence: async () => ({}),
      materialize: async () => ({}),
      branch: async (parent, draft) => {
        admitted++;
        return branchReceipt(parent, draft);
      },
      submit: async () => {
        admitted++;
        return {};
      },
      events: async () => ({}),
      finish: async () => {
        admitted++;
        return {};
      },
    },
    token,
    0,
    '127.0.0.1',
    abort.signal,
  );
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing address');
  try {
    let observed!: () => void;
    const firstChunk = new Promise<void>((resolve) => {
      observed = resolve;
    });
    server.once('request', (request) => request.once('data', observed));
    const result = new Promise<{ status: number; text: string }>((resolve, reject) => {
      const client = httpRequest(
        {
          hostname: '127.0.0.1',
          port: address.port,
          path: '/study/branch',
          method: 'POST',
          headers: { authorization: `Bearer ${token}` },
        },
        (response) => {
          let text = '';
          response.on('data', (chunk: Buffer) => {
            text += chunk.toString();
          });
          response.on('end', () => resolve({ status: response.statusCode!, text }));
          response.on('error', reject);
        },
      );
      client.on('error', reject);
      client.write('{');
      void firstChunk.then(() => {
        abort.abort(new Error('Coordinator stopped before admission'));
        client.end(`"parent":"${'a'.repeat(64)}","draft":"later"}`);
      });
    });
    const response = await result;
    assert.equal(response.status, 400);
    assert.match(response.text, /stopped before admission/);
    assert.equal(admitted, 0);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

test('actual branch HTTP receipt names the published agent path and replays without overwriting edits', async () => {
  const f = await studyBranchFixture(),
    token = 'f'.repeat(64),
    abort = new AbortController();
  const server = await serveStudy(f.control, token, 0, '127.0.0.1', abort.signal);
  const address = server.address();
  if (!address || typeof address === 'string') throw Error('Missing address');
  const request = async () => {
    const response = await fetch(`http://127.0.0.1:${address.port}/study/branch`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
      body: JSON.stringify({ parent: f.store.methods()[0]!.id, draft: 'http-method' }),
    });
    assert.equal(response.status, 200);
    return StudyBranchReceipt.parse(await response.json());
  };
  try {
    const receipt = await request();
    assert.deepEqual(receipt, {
      draft: 'http-method',
      path: '/workspace/http-method',
      targetRole: 'search-optimizer',
      parent: {
        candidateId: f.store.methods()[0]!.id,
        sourceDigest: f.spec.baseline.source.digest,
        methodIdentity: studyMethodIdentity(f.spec.baseline),
        composition: f.spec.baseline.composition,
      },
    });
    assert.ok(!JSON.stringify(receipt).includes(f.root));
    // The production runner binds <study>/drafts to /workspace, so resolve the returned agent path there.
    const draft = path.join(f.root, 'drafts', receipt.path.slice('/workspace/'.length));
    assert.equal(await readFile(path.join(draft, 'plugins.yml'), 'utf8'), '[]');
    await writeFile(path.join(draft, 'plugins.yml'), '# edited through returned path\n[]');
    assert.deepEqual(await request(), receipt);
    assert.match(await readFile(path.join(draft, 'plugins.yml'), 'utf8'), /edited through returned path/);
  } finally {
    abort.abort();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    await f.close();
  }
});
