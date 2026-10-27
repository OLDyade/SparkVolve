import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, symlink, readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../src/store.js';
import { Controller } from '../src/controller.js';
import { serve } from '../src/api.js';
import { materializeEvidence, readEvidence } from '../src/evidence.js';
import { treeDigest } from '../src/artifacts.js';
import { specification, candidate, runs } from './fixtures.js';
import { libraryFixture } from './library-fixture.js';

test('authorized evidence snapshots preserve every byte, provenance and prior observations', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'he-materialized-'));
  const dataset = path.join(root, 'dataset');
  const spec = specification();
  spec.probes = { limit: 1, timeoutSeconds: 10 };
  const fixture = await libraryFixture(path.join(dataset, 'library'));
  spec.researchLibrary = { directory: 'library', digest: await treeDigest(path.join(dataset, 'library')) };
  const store = new Store(':memory:', spec);
  const controller = new Controller(root, dataset, spec, store);
  const source = candidate(),
    run = { ...runs()[0]!, id: 'b'.repeat(64) },
    probe = 'c'.repeat(64);
  store.addCandidate(source);
  store.addRuns([run]);
  store.addProbe({
    id: probe,
    sourceDigest: source.digest,
    suiteDigest: 'd'.repeat(64),
    phase: 'queued',
    queuedAt: new Date().toISOString(),
    request: { draft: 'draft', suite: 'checks', entry: 'check.mjs', hypothesis: 'Protocol fixture' },
  });
  const binary = Buffer.from(Array.from({ length: 6643 }, (_, index) => index % 256));
  const sha256 = createHash('sha256').update(binary).digest('hex');
  const references = [
    ...['input', 'delivery', 'trace'].map((area) => ({
      kind: 'run',
      id: run.id,
      area,
      root: area === 'input' ? path.join(dataset, 'inputs/one') : path.join(root, 'runs', run.id, area),
    })),
    ...Object.entries({ source: 'candidates', build: 'builds', artifact: 'artifacts', qa: 'qa' }).map(
      ([area, directory]) => ({
        kind: 'candidate',
        id: source.digest,
        area,
        root: path.join(root, directory, source.digest, ...(area === 'build' ? ['logs'] : [])),
      }),
    ),
    ...Object.entries({
      source: `candidates/${source.digest}`,
      suite: 'suite',
      build: `builds/${source.digest}/logs`,
      artifact: `artifacts/${source.digest}`,
      logs: 'logs',
      observations: 'work',
    }).map(([area, directory]) => ({
      kind: 'probe',
      id: probe,
      area,
      root: path.join(root, 'probes', probe, directory),
    })),
  ];
  const hostPath = (virtual: string) => path.join(root, 'materialized', virtual.slice('/evidence/'.length));
  try {
    for (const { root: areaRoot, ...reference } of references) {
      await mkdir(path.join(areaRoot, 'nested'), { recursive: true });
      await writeFile(path.join(areaRoot, 'nested/data.bin'), binary);
      const request = { ...reference, file: 'nested/data.bin' };
      const [snapshot, duplicate] = await Promise.all([
        materializeEvidence(controller, request),
        materializeEvidence(controller, request),
      ]);
      assert.deepEqual(snapshot, duplicate);
      assert.equal(snapshot.sha256, sha256);
      assert.equal(snapshot.bytes, binary.length);
      assert.deepEqual(await readFile(hostPath(snapshot.path)), binary);
      const provenance = JSON.parse(await readFile(hostPath(snapshot.provenance), 'utf8'));
      assert.deepEqual(provenance.reference, request);
      assert.equal(provenance.experimentId, store.getMeta('experimentId'));
      assert.equal(provenance.sha256, sha256);
      assert.deepEqual(await materializeEvidence(controller, request), snapshot);
      await writeFile(path.join(areaRoot, 'nested/data.bin'), 'later observation');
      const later = await materializeEvidence(controller, request);
      assert.notEqual(later.path, snapshot.path);
      assert.deepEqual(await readFile(hostPath(snapshot.path)), binary);
    }
    const asset = await materializeEvidence(controller, {
      kind: 'asset',
      id: fixture.archiveId,
      area: 'source',
      file: 'index.mjs',
    });
    assert.deepEqual(
      await readFile(hostPath(asset.path)),
      await readFile(path.join(dataset, 'library', fixture.archiveId, 'source/index.mjs')),
    );
    assert.deepEqual(await readdir(path.join(root, 'materialization-staging')), []);
    assert.equal(store.candidates().length, 1);
    assert.equal(store.runs().length, 1);
    assert.equal(store.getMeta('champion'), undefined);
  } finally {
    store.close();
  }
});

test('materialization API rejects private areas, unknown identities, traversal and escaped symlinks', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'he-materialized-api-'));
  const spec = specification(),
    store = new Store(':memory:', spec);
  const controller = new Controller(root, root, spec, store);
  const run = { ...runs()[0]!, id: 'e'.repeat(64) };
  store.addCandidate(candidate());
  store.addRuns([run]);
  await mkdir(path.join(root, 'inputs/one'), { recursive: true });
  await writeFile(path.join(root, 'inputs/one/ok.bin'), Buffer.from([0, 255, 128, 1]));
  await writeFile(path.join(root, 'private.bin'), 'private');
  await symlink(path.join(root, 'private.bin'), path.join(root, 'inputs/one/escape'));
  const token = 'a'.repeat(64),
    server = await serve(controller, token, 0, '127.0.0.1');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const reference = { kind: 'run', id: run.id, area: 'input', file: 'ok.bin' };
  const post = (body: unknown, auth = token) =>
    fetch(`http://127.0.0.1:${address.port}/materialize`, {
      method: 'POST',
      headers: { authorization: `Bearer ${auth}` },
      body: JSON.stringify(body),
    });
  try {
    assert.equal((await post(reference, 'wrong')).status, 401);
    for (const denied of [
      { ...reference, area: 'evaluation' },
      { ...reference, area: 'grade-0' },
      { ...reference, id: 'f'.repeat(64) },
      { ...reference, file: '../private.bin' },
      { ...reference, file: '/private.bin' },
      { ...reference, file: 'escape' },
      { ...reference, file: undefined },
      { ...reference, destination: '/workspace/overwrite' },
      { kind: 'candidate', id: candidate().digest, area: 'evaluation', file: 'expected.json' },
      { kind: 'probe', id: 'f'.repeat(64), area: 'suite', file: 'x' },
      { kind: 'asset', id: 'f'.repeat(64), area: 'source', file: 'x' },
    ])
      assert.equal((await post(denied)).status, 400, JSON.stringify(denied));
    assert.equal((await post(reference)).status, 200);
    const raw = (await readEvidence(controller, reference)) as { data: string };
    assert.deepEqual(Buffer.from(raw.data, 'base64'), Buffer.from([0, 255, 128, 1]));
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    store.close();
  }
});

test(
  'materialization publishes only complete directories and survives interruption and competing publishers',
  { timeout: 30_000 },
  async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'he-materialized-publication-'));
    const spec = specification(),
      store = new Store(path.join(root, 'state.sqlite'), spec);
    const run = { ...runs()[0]!, id: 'e'.repeat(64) };
    store.addCandidate(candidate());
    store.addRuns([run]);
    store.close();
    await mkdir(path.join(root, 'inputs/one'), { recursive: true });
    const original = Buffer.from([0, 255, 128, 20, 0, 1]);
    await writeFile(path.join(root, 'inputs/one/data.bin'), original);
    await writeFile(path.join(root, 'spec.json'), JSON.stringify(spec));
    const code = `
    import { channel } from 'node:diagnostics_channel';
    import { readFileSync, existsSync } from 'node:fs';
    import path from 'node:path';
    import { Store } from './src/store.ts';
    import { Controller } from './src/controller.ts';
    import { materializeEvidence } from './src/evidence.ts';
    const root=process.argv[1], spec=JSON.parse(readFileSync(path.join(root,'spec.json'),'utf8'));
    const store=new Store(path.join(root,'state.sqlite'),spec,'read');
    channel('harness-evolution:materialization').subscribe(event=>{
      if(event.phase!=='prepared') return;
      process.send({prepared:event});
      const start=Date.now(), lock=new Int32Array(new SharedArrayBuffer(4));
      while(!existsSync(path.join(root,'release'))) {
        if(Date.now()-start>15000) throw new Error('Publication barrier timed out');
        Atomics.wait(lock,0,0,10);
      }
    });
    try {
      console.log(JSON.stringify(await materializeEvidence(new Controller(root,root,spec,store),
        {kind:'run',id:'e'.repeat(64),area:'input',file:'data.bin'})));
    } finally { store.close(); process.disconnect(); }
  `;
    const launch = () => {
      const child = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', code, root], {
        cwd: process.cwd(),
        stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      });
      let stdout = '',
        stderr = '';
      child.stdout!.on('data', (chunk) => {
        stdout += chunk;
      });
      child.stderr!.on('data', (chunk) => {
        stderr += chunk;
      });
      const prepared = new Promise<{ staging: string; destination: string }>((resolve) =>
        child.once('message', (message) =>
          resolve((message as { prepared: { staging: string; destination: string } }).prepared),
        ),
      );
      const done = new Promise<{
        code: number | null;
        signal: NodeJS.Signals | null;
        stdout: string;
        stderr: string;
      }>((resolve) => child.once('close', (code, signal) => resolve({ code, signal, stdout, stderr })));
      return { child, prepared, done };
    };
    const interrupted = launch();
    const preparing = await interrupted.prepared;
    assert.deepEqual(await readdir(path.join(root, 'materialized')), []);
    assert.ok(preparing.staging.startsWith(path.join(root, 'materialization-staging')));
    interrupted.child.kill('SIGKILL');
    assert.equal((await interrupted.done).signal, 'SIGKILL');
    assert.deepEqual(await readdir(path.join(root, 'materialized')), []);
    assert.equal((await readdir(path.join(root, 'materialization-staging'))).length, 1);
    const first = launch(),
      second = launch();
    await Promise.all([first.prepared, second.prepared]);
    assert.deepEqual(await readdir(path.join(root, 'materialized')), []);
    await writeFile(path.join(root, 'release'), 'publish');
    const results = await Promise.all([first.done, second.done]);
    for (const result of results) assert.equal(result.code, 0, result.stderr);
    const a = JSON.parse(results[0]!.stdout),
      b = JSON.parse(results[1]!.stdout);
    assert.deepEqual(a, b);
    assert.equal((await readdir(path.join(root, 'materialized'))).length, 1);
    assert.deepEqual(
      await readFile(path.join(root, 'materialized', a.path.slice('/evidence/'.length))),
      original,
    );
    // SIGKILL leftovers remain private and identifiable; a new publication never sweeps another attempt.
    assert.equal((await readdir(path.join(root, 'materialization-staging'))).length, 1);
  },
);
