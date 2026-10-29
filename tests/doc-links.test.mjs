import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { references, checkLinks } from '../scripts/check-links.mjs';

test('documentation links include reference syntax and HTML, excluding literal code examples', () => {
  const doc =
    '# A title\n\n[read][guide]\n\n[guide]: guide.md#next\n\n<img src="logo.png">\n\n`[example](missing.md)`\n\n```md\n[example](missing.md)\n```';
  assert.deepEqual(references(doc, true).links, ['guide.md#next', 'logo.png']);
  assert.ok(references(doc, true).ids.has('a-title'));
});

test('documentation validation rejects broken anchors and unpublished local artifacts', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sparkvolve-links-'));
  try {
    await writeFile(path.join(root, 'guide.md'), '# Next\n');
    await writeFile(path.join(root, 'README.md'), '[go](guide.md#next)\n');
    assert.equal(await checkLinks(root, ['README.md', 'guide.md']), 1);
    await assert.rejects(checkLinks(root, ['README.md']), /file is not published/);
    await writeFile(path.join(root, 'README.md'), '[go](guide.md#missing)\n');
    await assert.rejects(checkLinks(root, ['README.md', 'guide.md']), /anchor is missing/);
  } finally {
    await rm(root, { recursive: true });
  }
});
