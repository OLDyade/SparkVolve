import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, mkdir, writeFile, readFile, readdir, chmod, rm, stat } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import os from 'node:os';
import path from 'node:path';
import { freeze, treeDigest } from '../src/artifacts.js';

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'he-publication-'));
  await mkdir(path.join(root, 'source/nested'), { recursive: true });
  await writeFile(path.join(root, 'source/first.txt'), 'original bytes');
  await writeFile(path.join(root, 'source/nested/last.sh'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  return root;
}

test(
  'SIGKILL publication recovery uses the same intent at every filesystem/SQLite boundary',
  { timeout: 30_000 },
  async (t) => {
    for (const phase of ['reserved', 'copying', 'ready', 'published', 'committed']) {
      await t.test(phase, async () => {
        const root = await fixture();
        const source = path.join(root, 'source'),
          destination = path.join(root, 'snapshot');
        const control = path.join(root, 'publications'),
          expected = await treeDigest(source);
        const child = spawn(
          process.execPath,
          ['--import', 'tsx', path.join(import.meta.dirname, 'fixtures/publication-child.mjs'), root, phase],
          { stdio: ['ignore', 'pipe', 'pipe'] },
        );
        const closed = once(child, 'close');
        let stderr = '';
        child.stderr.on('data', (bytes) => {
          stderr += String(bytes);
        });
        try {
          const marker = await Promise.race([
            once(child.stdout, 'data').then(
              ([bytes]) => JSON.parse(String(bytes)) as { phase: string; identity: string },
            ),
            closed.then(() => {
              throw new Error(`Publisher exited before checkpoint: ${stderr}`);
            }),
          ]);
          assert.equal(marker.phase, phase);
          assert.equal(marker.identity, expected);
          if (phase !== 'committed') {
            await assert.rejects(freeze(source, destination, control), /database is locked/);
            // Another destination has its own OS lock and remains publishable.
            assert.equal(await freeze(source, path.join(root, 'other'), control), expected);
          }
          child.kill('SIGKILL');
          assert.deepEqual(await closed, [null, 'SIGKILL']);
          assert.equal(await freeze(source, destination, control), expected);
          assert.equal(await treeDigest(destination), expected);
          assert.equal((await stat(destination)).mode & 0o777, 0o555);
          assert.equal(
            await readFile(path.join(destination, 'nested/last.sh'), 'utf8'),
            '#!/bin/sh\nexit 0\n',
          );
          assert.equal(
            (await readdir(root)).some((name) => name.endsWith('.staging')),
            false,
          );
          const files = await readdir(control);
          const rows = files
            .filter((file) => file.endsWith('.sqlite'))
            .map((file) => {
              const db = new DatabaseSync(path.join(control, file), { readOnly: true });
              try {
                return db.prepare('SELECT destination,digest,state FROM publication').get()!;
              } finally {
                db.close();
              }
            });
          const row = rows.find((row) => String(row.destination).endsWith('/snapshot'))!;
          assert.equal(row.digest, expected);
          assert.equal(row.state, 'published');
        } finally {
          child.kill('SIGKILL');
          await closed;
        }
      });
    }
  },
);

test('published snapshots are idempotent, conflicts and missing/tampered content remain explicit failures', async () => {
  const root = await fixture();
  const source = path.join(root, 'source'),
    destination = path.join(root, 'snapshot'),
    control = path.join(root, 'publications');
  const expected = await freeze(source, destination, control);
  assert.equal(await freeze(source, destination, control), expected);
  await writeFile(path.join(source, 'first.txt'), 'different request');
  await assert.rejects(freeze(source, destination, control), /identity changed/);
  assert.equal(await treeDigest(destination), expected);
  await writeFile(path.join(source, 'first.txt'), 'original bytes');
  await chmod(path.join(destination, 'first.txt'), 0o644);
  await writeFile(path.join(destination, 'first.txt'), 'tampered');
  await assert.rejects(freeze(source, destination, control), /content mismatch/);
  await chmod(destination, 0o755);
  await rm(destination, { recursive: true });
  await assert.rejects(freeze(source, destination, control), /snapshot is missing/);
});
