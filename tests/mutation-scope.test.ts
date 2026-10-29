import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, cp, rm, chmod } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { treeDigest } from '../src/artifacts.js';
import { assertMutationScope } from '../src/mutation-scope.js';
import { HostSearchProtocol } from '../src/contracts.js';

test('scope permits declared text changes and rejects implementation, deletion, additions, mode and race', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'he-scope-'));
  try {
    const seed = path.join(root, 'seed'),
      draft = path.join(root, 'draft');
    await mkdir(seed);
    await writeFile(path.join(seed, 'prompt.md'), 'Original');
    await writeFile(path.join(seed, 'index.mjs'), 'export const name="seed"');
    await cp(seed, draft, { recursive: true });
    await writeFile(path.join(draft, 'prompt.md'), 'New strategy');
    await assertMutationScope(seed, draft, await treeDigest(draft), ['prompt.md']);
    await assert.rejects(assertMutationScope(seed, draft, '0'.repeat(64), ['prompt.md']), /changed during/);
    await chmod(path.join(draft, 'index.mjs'), 0o755);
    await assert.rejects(
      assertMutationScope(seed, draft, await treeDigest(draft), ['prompt.md']),
      /index.mjs/,
    );
    await chmod(path.join(draft, 'index.mjs'), 0o644);
    await rm(path.join(draft, 'index.mjs'));
    await assert.rejects(
      assertMutationScope(seed, draft, await treeDigest(draft), ['prompt.md']),
      /index.mjs/,
    );
    await cp(path.join(seed, 'index.mjs'), path.join(draft, 'index.mjs'));
    await writeFile(path.join(draft, 'extra.mjs'), 'new code');
    await assert.rejects(
      assertMutationScope(seed, draft, await treeDigest(draft), ['prompt.md']),
      /extra.mjs/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test('scope schema rejects ambiguous and escaping file lists', () => {
  for (const editableFiles of [[], ['../escape'], ['x', 'x'], ['/abs']])
    assert.equal(
      HostSearchProtocol.safeParse({ ancestry: 'seed-only', feedback: 'full', editableFiles }).success,
      false,
    );
});
