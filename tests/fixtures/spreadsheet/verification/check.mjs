import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Researcher-owned API contract. No task inputs, scores or model calls.
export async function probe({ call, workspace }) {
  const script = fileURLToPath(new URL('./fixture.py', import.meta.url));
  const source = path.join(workspace, 'source.xlsx');
  execFileSync('python3', [script, 'create', source]);
  const original = await readFile(source);
  const edits = [
    { sheet: 'Contract', cell: 'B1', value: '=A1+10' },
    { sheet: 'Contract', cell: 'B2', value: '=A2*20' },
    { sheet: 'Contract', cell: 'C2', value: '=$A$1-A2' },
    { sheet: 'Contract', cell: 'C3', value: 0 },
    { sheet: 'Contract', cell: 'C4', value: null },
  ];
  const destination = path.join(workspace, 'result.xlsx');
  const result = await call('workbook_write', { source, destination, edits });
  assert.equal(result.isError, false, JSON.stringify(result));
  execFileSync('python3', [script, 'verify', source, destination, JSON.stringify(edits)]);
  assert.deepEqual(await readFile(source), original, 'source bytes changed');

  // Failed operations cannot partially overwrite a pre-existing delivery.
  const saved = await readFile(destination);
  for (const invalid of [
    [edits[0], { ...edits[0], value: '=A1-5' }],
    [edits[0], { ...edits[1], sheet: 'Missing' }],
  ]) {
    const failure = await call('workbook_write', { source, destination, edits: invalid });
    assert.equal(failure.isError, true, 'invalid edit must report a native tool error');
    assert.deepEqual(await readFile(destination), saved, 'invalid edit changed delivery');
    assert.deepEqual(await readFile(source), original, 'invalid edit changed source');
  }
  const forbidden = '/tmp/domain-contract-output.xlsx';
  const outside = await call('workbook_write', { source, destination: forbidden, edits });
  assert.equal(outside.isError, true, 'destination outside workspace must fail');
  await assert.rejects(access(forbidden), { code: 'ENOENT' });
}
