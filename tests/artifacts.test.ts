import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir, symlink, rm, readFile, chmod } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { canonical, confined, freeze, treeDigest } from '../src/artifacts.js';

test('canonical UTF-8 identities ignore object insertion order, preserve array order', () => {
  assert.equal(canonical({ b: '中文', a: 1 }), canonical({ a: 1, b: '中文' }));
  assert.notEqual(canonical(['a', 'b']), canonical(['b', 'a']));
  assert.throws(() => canonical({ invalid: undefined }));
  assert.throws(() => canonical(NaN));
});
test('candidate snapshot has stable content identity and independent bytes', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'he-artifacts-'));
  try {
    await mkdir(path.join(root, 'source'));
    await writeFile(path.join(root, 'source', 'code.js'), 'export const 能力 = 1;');
    const identity = await freeze(
      path.join(root, 'source'),
      path.join(root, 'frozen'),
      path.join(root, 'publications'),
    );
    assert.equal(identity, await treeDigest(path.join(root, 'frozen')));
    await writeFile(path.join(root, 'source', 'code.js'), 'changed');
    assert.notEqual(identity, await treeDigest(path.join(root, 'source')));
    assert.match(await readFile(path.join(root, 'frozen', 'code.js'), 'utf8'), /能力/);
  } finally {
    await chmod(path.join(root, 'frozen'), 0o755);
    await rm(root, { recursive: true, force: true });
  }
});
test('symlinks and traversal cannot enter frozen bundles', async () => {
  for (const name of ['../secret', '/etc/passwd', 'x/../secret', 'x\\secret'])
    assert.throws(() => confined('/tmp/example', name));
  const root = await mkdtemp(path.join(os.tmpdir(), 'he-links-'));
  try {
    await symlink('/etc/passwd', path.join(root, 'leak'));
    await assert.rejects(treeDigest(root), /Symlinks/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
