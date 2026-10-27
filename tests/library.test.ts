import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { catalog, importArchive } from '../src/library.js';
import { treeDigest } from '../src/artifacts.js';
import { Store } from '../src/store.js';
import { specification } from './fixtures.js';

test('library imports editable code and provenance, never old scores', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'he-library-'));
  const store = new Store(':memory:', specification());
  try {
    const source = path.join(root, 'source');
    await mkdir(source);
    await writeFile(path.join(source, 'index.mjs'), 'export const name = "evidence";');
    const hash = await treeDigest(source),
      archive = path.join(root, 'library', hash);
    await mkdir(path.join(archive, 'source'), { recursive: true });
    await writeFile(path.join(archive, 'source/index.mjs'), await readFile(path.join(source, 'index.mjs')));
    await writeFile(
      path.join(archive, 'research-record.json'),
      JSON.stringify({
        format: 'harness-evolution-research-archive',
        archiveId: hash,
        candidate: {
          digest: hash,
          phase: 'rejected',
          mean: 0,
          proposal: { hypothesis: 'Negative result matters', actions: ['author'] },
        },
        specification: { name: 'past', objective: 'Evidence' },
      }),
    );
    assert.equal((await catalog(path.join(root, 'library'), 'negative')).length, 1);
    assert.equal((await catalog(path.join(root, 'library'), 'absent')).length, 0);
    await mkdir(path.join(root, 'drafts'));
    await importArchive(root, store, archive, 'new-mechanism');
    await writeFile(path.join(root, 'drafts/new-mechanism/index.mjs'), 'changed');
    assert.equal(await treeDigest(path.join(archive, 'source')), hash);
    assert.equal(store.candidates().length, 0);
    assert.equal(store.runs().length, 0);
    assert.equal(store.events()[0]!.type, 'draft.imported');
    await assert.rejects(importArchive(root, store, archive, 'new-mechanism'), /EEXIST/);
  } finally {
    store.close();
    await rm(root, { recursive: true, force: true });
  }
});
