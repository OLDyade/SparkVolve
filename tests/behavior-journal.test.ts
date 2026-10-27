import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { BehaviorJournal } from '../src/behavior-journal.js';

test('concurrent observations retain immutable snapshots and final failure evidence', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'he-journal-'));
  const file = path.join(root, 'behavior.json');
  const journal = new BehaviorJournal(file);
  await journal.start();
  const actual = { bound: ['provider-a'], value: 0 };
  const first = journal.observe('before replacement', actual);
  actual.bound.push('provider-b');
  actual.value = 9;
  const second = journal.observe('after replacement', actual);
  const tool = journal.tool('service_value', {}, { isError: false, content: [{ text: '9' }] });
  await Promise.all([first, second, tool, journal.finish('failed', 'independent assertion failed')]);
  const report = JSON.parse(await readFile(file, 'utf8'));
  assert.equal(report.status, 'failed');
  assert.equal(report.error, 'independent assertion failed');
  assert.deepEqual(
    report.observations.map((item: { sequence: number }) => item.sequence),
    [1, 2, 3],
  );
  assert.deepEqual(report.observations[0].value, { bound: ['provider-a'], value: 0 });
  assert.deepEqual(report.observations[1].value, { bound: ['provider-a', 'provider-b'], value: 9 });
  assert.equal(report.observations[2].kind, 'tool');
  assert.throws(() => journal.observe('late', 1), /finished/);
});

test('explicit observations reject values JSON would silently corrupt', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'he-journal-invalid-'));
  const file = path.join(root, 'behavior.json');
  const journal = new BehaviorJournal(file);
  await journal.start();
  for (const value of [undefined, NaN, Infinity, { missing: undefined }, () => 1, new Date()])
    assert.throws(() => journal.observe('invalid', value), /finite JSON/);
  assert.throws(() => journal.observe(' ', 1), /nonempty/);
  assert.throws(() => journal.observe('sparse', new Array(1)), /sparse JSON/);
  assert.throws(() => journal.observe('nested sparse', { values: new Array(2) }), /sparse JSON/);
  await journal.observe('explicit absence', null);
  await journal.finish('passed');
  const report = JSON.parse(await readFile(file, 'utf8'));
  assert.deepEqual(report.observations, [
    { sequence: 1, kind: 'value', label: 'explicit absence', value: null },
  ]);
});
