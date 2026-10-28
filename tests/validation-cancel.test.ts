import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { atomicJSON, digest } from '../src/artifacts.js';
import { cancelValidationStudy } from '../src/validation-cancel.js';
import { specification, hash } from './fixtures.js';

async function registration(root: string) {
  const spec = {
    ...specification(),
    purpose: 'validation' as const,
    budget: { candidates: 1, optimizerSeconds: 60 },
  };
  const arms = ['h0', 'selected'].map((id) => ({
    id,
    source: path.join(root, id),
    digest: hash,
    artifact: path.join(root, `${id}-artifact`),
    build: {
      artifactDigest: hash,
      bundleDigest: hash,
      tarballDigest: hash,
      lockDigest: hash,
      image: spec.runtime.image,
    },
  }));
  const intent = { specification: spec, datasetDigest: hash, arms };
  await atomicJSON(path.join(root, 'registration-intent/contract.json'), intent);
  return intent;
}

test('cancellation accepts the frozen pre-publication registration and records partial/unstarted arms', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'he-validation-cancel-intent-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const intent = await registration(root);
  const arm = path.join(root, 'arms/h0');
  await mkdir(arm, { recursive: true });
  const db = new DatabaseSync(path.join(arm, 'initialization.sqlite'));
  db.exec(
    "CREATE TABLE initialization(id INTEGER PRIMARY KEY, phase TEXT); INSERT INTO initialization VALUES(1,'preparing')",
  );
  db.close();
  await atomicJSON(path.join(arm, 'experiment.json'), intent.specification);
  const receipt = await cancelValidationStudy(root);
  assert.equal(receipt.registrationDigest, digest(intent));
  assert.deepEqual(
    receipt.arms.map((entry) => entry.cleanup.state),
    ['unstarted', 'unstarted'],
  );
  for (const id of ['h0', 'selected'])
    await assert.rejects(readFile(path.join(root, 'arms', id, 'experiment.sqlite')), { code: 'ENOENT' });
  assert.deepEqual(await cancelValidationStudy(root), receipt);
});

test('changed registration projection fails before cancellation authority is created', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'he-validation-cancel-changed-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const intent = await registration(root);
  await atomicJSON(path.join(root, 'registration.json'), { ...intent, datasetDigest: 'b'.repeat(64) });
  await assert.rejects(cancelValidationStudy(root), /registration changed/);
  await assert.rejects(readFile(path.join(root, 'cancellation.sqlite')), { code: 'ENOENT' });
});

test('prepared missing ledgers and arm symlinks cannot be relabelled as unstarted', async (t) => {
  for (const damage of ['prepared-missing', 'symlink'] as const)
    await t.test(damage, async () => {
      const root = await mkdtemp(path.join(os.tmpdir(), 'he-validation-cancel-corrupt-'));
      try {
        await registration(root);
        await mkdir(path.join(root, 'arms'), { recursive: true });
        const arm = path.join(root, 'arms/h0');
        if (damage === 'prepared-missing') {
          await mkdir(arm);
          const db = new DatabaseSync(path.join(arm, 'initialization.sqlite'));
          db.exec(
            "CREATE TABLE initialization(id INTEGER PRIMARY KEY, phase TEXT); INSERT INTO initialization VALUES(1,'prepared')",
          );
          db.close();
        } else {
          await mkdir(path.join(root, 'elsewhere'));
          await symlink(path.join(root, 'elsewhere'), arm);
        }
        await assert.rejects(
          cancelValidationStudy(root),
          damage === 'prepared-missing' ? /database is missing/ : /symbolic link/,
        );
        await assert.rejects(readFile(path.join(root, 'validation-cancellation.json')), { code: 'ENOENT' });
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });
});
