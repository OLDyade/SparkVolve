import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, chmod, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { allocateNetwork } from '../src/network-pool.js';

test('IPAM collisions remain authoritative before the winning network becomes listable', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'he-unpublished-ipam-'));
  const priorPath = process.env.PATH;
  try {
    const binary = path.join(root, 'docker');
    const ledger = path.join(root, 'attempts.json');
    const mode = path.join(root, 'mode');
    await writeFile(mode, 'overlap-once');
    await writeFile(
      binary,
      `#!${process.execPath}
const fs = require('node:fs');
const ledger = ${JSON.stringify(ledger)}, mode = ${JSON.stringify(mode)};
const args = process.argv.slice(2);
if (args[0] !== 'network') throw Error('Unexpected Docker operation');
if (args[1] === 'ls') process.exit(0); // Reserved pool is not published yet.
if (args[1] !== 'create') throw Error('Unexpected network operation');
const attempts = fs.existsSync(ledger) ? JSON.parse(fs.readFileSync(ledger)) : [];
attempts.push(args[args.indexOf('--subnet') + 1]);
fs.writeFileSync(ledger, JSON.stringify(attempts));
const behavior = fs.readFileSync(mode, 'utf8');
if (behavior === 'permission') {
  console.error('permission denied'); process.exit(1);
}
if (behavior === 'overlap-always' || attempts.length === 1) {
  console.error('invalid pool request: Pool overlaps with other one on this address space'); process.exit(1);
}
console.log('created-network-id');
`,
    );
    await chmod(binary, 0o755);
    process.env.PATH = root + path.delimiter + priorPath;
    const persisted: string[] = [];
    await allocateNetwork('10.240.0.0/28', 'hidden-reservation', [], async (subnet) => {
      persisted.push(subnet);
    });
    assert.deepEqual(persisted, ['10.240.0.0/29', '10.240.0.8/29']);
    assert.deepEqual(JSON.parse(await readFile(ledger, 'utf8')), persisted);

    await writeFile(ledger, '[]');
    await writeFile(mode, 'overlap-always');
    await assert.rejects(
      allocateNetwork('10.240.0.0/28', 'bounded', [], async () => {}),
      /contention exhausted/,
    );
    assert.deepEqual(JSON.parse(await readFile(ledger, 'utf8')), persisted);

    await writeFile(ledger, '[]');
    await writeFile(mode, 'permission');
    await assert.rejects(
      allocateNetwork('10.240.0.0/28', 'denied', [], async () => {}),
      /permission denied/,
    );
    assert.deepEqual(JSON.parse(await readFile(ledger, 'utf8')), [persisted[0]]);
  } finally {
    if (priorPath === undefined) delete process.env.PATH;
    else process.env.PATH = priorPath;
    await rm(root, { recursive: true, force: true });
  }
});
