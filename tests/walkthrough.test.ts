import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

test('walkthrough creates missing parents, preserves the first command failure and refuses root reuse', async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'he-walkthrough-'));
  const bin = path.join(temporary, 'bin');
  await mkdir(bin);
  // The first external command fails deliberately; no Docker or provider is contacted.
  await writeFile(path.join(bin, 'git'), '#!/bin/sh\nexit 73\n', { mode: 0o755 });
  const root = path.join(temporary, 'missing', 'parent', 'journey');
  const args = [
    path.resolve('scripts/accept-walkthrough.mjs'),
    '--root',
    root,
    '--image',
    `sha256:${'0'.repeat(64)}`,
    '--runtime',
    'runc',
    '--pool',
    '10.230.0.0/16',
    '--dns',
    '192.0.2.53',
    '--endpoint',
    'http://192.0.2.1:18958',
  ];
  const options = { encoding: 'utf8' as const, env: { PATH: bin, VENUS_API_KEY: 'test-only-unused' } };
  const first = spawnSync(process.execPath, args, options);
  assert.equal(first.status, 1);
  const failureFile = path.join(root, 'failure.json');
  const original = await readFile(failureFile, 'utf8');
  const failure = JSON.parse(original);
  assert.match(failure.error, /01-revision failed/);
  assert.equal(failure.journal.length, 1);
  assert.equal(failure.journal[0].code, 73);
  const again = spawnSync(process.execPath, args, options);
  assert.equal(again.status, 1);
  assert.match(again.stderr, /EEXIST/);
  assert.equal(await readFile(failureFile, 'utf8'), original);
});
