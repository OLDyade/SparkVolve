import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { atomicJSON, digest } from './artifacts.js';
import { Digest, Experiment } from './contracts.js';
import { Arms } from './validation.js';
import { cancelRegisteredChild } from './cancellation.js';
import { Docker } from './docker.js';

const Registration = z.strictObject({ specification: Experiment, datasetDigest: Digest, arms: Arms });

/** Explicit owner cancellation, after stopping the validation observer; never resumes model work. */
export async function cancelValidationStudy(root: string, docker = new Docker()) {
  root = await realpath(root);
  const intent = Registration.parse(
    JSON.parse(await readFile(path.join(root, 'registration-intent/contract.json'), 'utf8')),
  );
  try {
    const registration: unknown = JSON.parse(await readFile(path.join(root, 'registration.json'), 'utf8'));
    if (digest(registration) !== digest(intent)) throw Error('Validation cancellation registration changed');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  if (intent.specification.purpose !== 'validation') throw Error('Cancellation requires a validation study');
  const identity = digest(intent);
  // Creating this authoritative ledger closes validateStudy admission even during interrupted cleanup.
  const db = new DatabaseSync(path.join(root, 'cancellation.sqlite'), { timeout: 0 });
  try {
    db.exec(`PRAGMA synchronous=FULL;
      CREATE TABLE IF NOT EXISTS validation_cancellation(id INTEGER PRIMARY KEY CHECK(id=1), identity TEXT NOT NULL, receipt TEXT) STRICT;
      BEGIN IMMEDIATE;`);
    db.prepare('INSERT OR IGNORE INTO validation_cancellation VALUES(1,?,NULL)').run(identity);
    db.exec('COMMIT; BEGIN IMMEDIATE;');
    const row = db.prepare('SELECT * FROM validation_cancellation WHERE id=1').get() as {
      identity: string;
      receipt: string | null;
    };
    if (row.identity !== identity) throw Error('Validation cancellation identity changed');
    const receiptFile = path.join(root, 'validation-cancellation.json');
    if (row.receipt !== null) {
      const saved: unknown = JSON.parse(await readFile(receiptFile, 'utf8'));
      if (digest(saved) !== digest(JSON.parse(row.receipt)))
        throw Error('Completed validation cancellation receipt changed');
    }
    const arms = [];
    for (const arm of intent.arms)
      arms.push({
        id: arm.id,
        cleanup: await cancelRegisteredChild(root, `arms/${arm.id}`, digest(intent.specification), docker),
      });
    const receipt = { registrationDigest: identity, outcome: 'cancelled' as const, arms };
    if (row.receipt !== null && digest(JSON.parse(row.receipt)) !== digest(receipt))
      throw Error('Validation cancellation observations changed');
    await atomicJSON(receiptFile, receipt);
    db.prepare('UPDATE validation_cancellation SET receipt=? WHERE id=1').run(JSON.stringify(receipt));
    db.exec('COMMIT;');
    return receipt;
  } finally {
    if (db.isTransaction) db.exec('ROLLBACK');
    db.close();
  }
}
