import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { catalog, importArchive, inspectAsset, draftOrigin } from '../src/library.js';
import { treeDigest } from '../src/artifacts.js';
import { Store } from '../src/store.js';
import { Controller } from '../src/controller.js';
import { serve } from '../src/api.js';
import { Experiment } from '../src/contracts.js';
import { specification } from './fixtures.js';
import { libraryFixture } from './library-fixture.js';

test('library verifies identities and imports editable source with provenance, never old scores', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'he-library-'));
  const store = new Store(':memory:', specification());
  const library = path.join(root, 'library');
  const fixture = await libraryFixture(library);
  const archive = path.join(library, fixture.archiveId);
  try {
    const found = await catalog(library, 'negative');
    assert.equal(found.length, 1);
    assert.equal(found[0]!.phase, 'qa_failed');
    assert.equal(found[0]!.recordDigest, fixture.recordDigest);
    assert.equal((await catalog(library, 'absent')).length, 0);
    await importArchive(root, store, archive, 'new-mechanism');
    assert.equal(await treeDigest(path.join(root, 'drafts/new-mechanism')), fixture.sourceCandidate);
    await writeFile(path.join(root, 'drafts/new-mechanism/index.mjs'), 'changed');
    assert.equal(await treeDigest(path.join(archive, 'source')), fixture.sourceCandidate);
    assert.equal(store.candidates().length, 0);
    assert.equal(store.runs().length, 0);
    assert.equal(store.getMeta('champion'), undefined);
    assert.equal(draftOrigin(store, 'new-mechanism')!.recordDigest, fixture.recordDigest);
    await importArchive(root, store, archive, 'new-mechanism');
    assert.equal(await readFile(path.join(root, 'drafts/new-mechanism/index.mjs'), 'utf8'), 'changed');
    await assert.rejects(inspectAsset(library, fixture.archiveId, '../research-record.json'));
    await writeFile(
      path.join(archive, 'research-record.json'),
      JSON.stringify({ ...fixture.record, archiveId: 'f'.repeat(64) }),
    );
    await assert.rejects(catalog(library), /identity mismatch/);
    await writeFile(path.join(archive, 'research-record.json'), JSON.stringify(fixture.record));
    await writeFile(path.join(archive, 'source/index.mjs'), 'tampered');
    await assert.rejects(importArchive(root, store, archive, 'tampered'), /source digest mismatch/);
  } finally {
    store.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('authorized library API confines access, freezes exposure and carries origin into a new candidate', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'he-library-api-'));
  const dataset = path.join(root, 'dataset');
  const library = path.join(dataset, 'assets');
  const fixture = await libraryFixture(library);
  const spec = specification();
  spec.researchLibrary = { directory: 'assets', digest: await treeDigest(library) };
  for (const task of spec.tasks) {
    for (const dir of [task.input, task.evaluation])
      await mkdir(path.join(dataset, dir), { recursive: true });
    task.inputDigest = await treeDigest(path.join(dataset, task.input));
    task.evaluationDigest = await treeDigest(path.join(dataset, task.evaluation));
  }
  const store = new Store(':memory:', spec);
  const controller = new Controller(root, dataset, spec, store);
  await controller.start();
  const token = 'c'.repeat(64);
  const server = await serve(controller, token, 0, '127.0.0.1');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const post = (route: string, body: unknown) =>
    fetch(`http://127.0.0.1:${address.port}${route}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
  try {
    assert.equal((await post('/library', { query: 'negative' })).status, 200);
    assert.equal((await post('/asset', { archive: '../../private' })).status, 400);
    const inspection = (await (await post('/asset', { archive: fixture.archiveId })).json()) as {
      recordDigest: string;
      sourceFiles: unknown[];
    };
    assert.equal(inspection.recordDigest, fixture.recordDigest);
    assert.equal(inspection.sourceFiles.length, 4);
    const source = (await (
      await post('/asset', { archive: fixture.archiveId, file: 'index.mjs' })
    ).json()) as { data: string };
    assert.match(Buffer.from(source.data, 'base64').toString(), /reuse-example/);
    assert.equal((await post('/import', { archive: fixture.archiveId, draft: 'reused' })).status, 200);
    assert.equal(store.candidates().length, 0);
    await writeFile(
      path.join(root, 'drafts/reused/index.mjs'),
      `${await readFile(path.join(root, 'drafts/reused/index.mjs'), 'utf8')}\n// adapted to current experiment\n`,
    );
    const response = await post('/submit', {
      draft: 'reused',
      parents: [],
      actions: ['tune'],
      evidence: [fixture.archiveId],
      hypothesis: 'Adapt the imported mechanism',
      expectedChange: 'Must be re-evaluated',
    });
    assert.equal(response.status, 200);
    const submitted = store.candidates()[0]!;
    assert.deepEqual(submitted.origin, {
      archiveId: fixture.archiveId,
      recordDigest: fixture.recordDigest,
      sourceCandidate: fixture.sourceCandidate,
    });
    assert.equal(submitted.phase, 'frozen');
    assert.equal(submitted.mean, undefined);
    assert.equal(store.getMeta('champion'), undefined);
    const denied = new Controller(root, dataset, { ...spec, researchLibrary: null }, store);
    await assert.rejects(denied.library(), /No research library/);
    const overlapping = {
      ...spec,
      researchLibrary: { ...spec.researchLibrary!, directory: spec.tasks[0]!.evaluation },
    };
    assert.throws(() => Experiment.parse(overlapping), /disjoint/);
    await symlink(path.join(dataset, spec.tasks[0]!.evaluation), path.join(library, 'escape'));
    await assert.rejects(controller.library(), { code: 'ELOOP' });
    await rm(path.join(library, 'escape'));
    await writeFile(
      path.join(library, fixture.archiveId, 'research-record.json'),
      JSON.stringify({ ...fixture.record, extra: 'mutated metadata' }),
    );
    await assert.rejects(controller.library(), /snapshot changed/);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await controller.close();
    store.close();
    // Frozen candidate evidence intentionally remains in this retained temp experiment.
  }
});

test('import resumes after intent, publication or lost response without losing origin or edited bytes', async () => {
  for (const point of ['before-copy', 'after-publish', 'after-commit'] as const) {
    const root = await mkdtemp(path.join(os.tmpdir(), `he-import-${point}-`));
    const library = path.join(root, 'library');
    const fixture = await libraryFixture(library);
    class CrashStore extends Store {
      calls = 0;
      override transaction<T>(action: () => T): T {
        this.calls++;
        if (point === 'after-publish' && this.calls === 2) throw new Error('injected interruption');
        const result = super.transaction(action);
        if ((point === 'before-copy' && this.calls === 1) || (point === 'after-commit' && this.calls === 2))
          throw new Error('injected interruption');
        return result;
      }
    }
    const db = path.join(root, 'state.sqlite');
    let store: Store = new CrashStore(db, specification());
    const archive = path.join(library, fixture.archiveId);
    await assert.rejects(importArchive(root, store, archive, 'resume'), /injected interruption/);
    if (point !== 'after-commit') assert.throws(() => draftOrigin(store, 'resume'), /pending/);
    else await writeFile(path.join(root, 'drafts/resume/index.mjs'), 'user changes after successful import');
    store.close();
    store = new Store(db, specification());
    try {
      await Promise.all([
        importArchive(root, store, archive, 'resume'),
        importArchive(root, store, archive, 'resume'),
      ]);
      assert.equal(draftOrigin(store, 'resume')!.sourceCandidate, fixture.sourceCandidate);
      assert.equal(store.events().filter((event) => event.type === 'draft.imported').length, 1);
      assert.equal(store.candidates().length, 0);
      if (point === 'after-commit')
        assert.equal(
          await readFile(path.join(root, 'drafts/resume/index.mjs'), 'utf8'),
          'user changes after successful import',
        );
      else assert.equal(await treeDigest(path.join(root, 'drafts/resume')), fixture.sourceCandidate);
    } finally {
      store.close();
    }
  }
});
