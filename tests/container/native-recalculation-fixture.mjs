import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
export { inject, apply } from './runtime-home-fixture.mjs';

export async function probe({ call, workspace }) {
  const fixture = fileURLToPath(new URL('./native-recalculation-fixture.py', import.meta.url));
  execFileSync('python3', [fixture, 'create', workspace]);
  const source = path.join(workspace, 'source.xlsx');
  const destination = path.join(workspace, 'result.xlsx');
  const before = await readFile(source);
  const specialSource = path.join(workspace, 'special.xlsx');
  const specialBefore = await readFile(specialSource);
  const special = await call('workbook_inspect', { file: specialSource });
  assert.equal(special.isError, false, JSON.stringify(special));
  const cells = special.value.sheets.Special.cells;
  assert.deepEqual(cells.C1, { formula: '=A1:A2*B1:B2', formula_attributes: { t: 'array', ref: 'C1:C2' } });
  assert.deepEqual(cells.E1, {
    formula: null,
    formula_attributes: { t: 'dataTable', ref: 'E1:F2', dt2D: '1', r1: 'A1', r2: 'B1', ca: '1' },
  });
  const specialCopy = path.join(workspace, 'special-copy.xlsx');
  const written = await call('workbook_write', {
    source: specialSource,
    destination: specialCopy,
    edits: [{ sheet: 'Special', cell: 'H1', value: 42 }],
  });
  assert.equal(written.isError, false, JSON.stringify(written));
  const copied = await call('workbook_inspect', { file: specialCopy });
  assert.equal(copied.isError, false, JSON.stringify(copied));
  assert.deepEqual(copied.value.sheets.Special.cells.C1, cells.C1);
  assert.deepEqual(copied.value.sheets.Special.cells.E1, cells.E1);
  assert.deepEqual(await readFile(specialSource), specialBefore);
  const arraySource = path.join(workspace, 'array.xlsx');
  const arrayBefore = await readFile(arraySource);
  const array = await call('workbook_recalculate', {
    source: arraySource,
    destination: path.join(workspace, 'array-result.xlsx'),
  });
  assert.equal(array.isError, false, JSON.stringify(array));
  assert.equal(array.value.formula_count, 1);
  assert.deepEqual(array.value.formulas[0], {
    sheet: 'Special',
    cell: 'C1',
    ...cells.C1,
    engine_value: 8,
    engine_error: null,
  });
  const arrayVerified = JSON.parse(
    execFileSync('python3', [fixture, 'verify-array', workspace], { encoding: 'utf8' }),
  );
  assert.deepEqual(await readFile(arraySource), arrayBefore);
  const reply = await call('workbook_recalculate', { source, destination });
  assert.equal(reply.isError, false, JSON.stringify(reply));
  const report = reply.value;
  const rows = new Map(report.formulas.map((row) => [row.cell, row]));
  for (const [cell, value] of Object.entries({ A1: 3, A2: 7, A3: 5, A4: 64, A5: '#literal' })) {
    assert.equal(rows.get(cell).engine_value, value, cell);
    assert.equal(rows.get(cell).engine_error, null, cell);
  }
  assert.equal(rows.get('A6').engine_error, '#DIV/0!');
  assert.equal(rows.get('A7').engine_value, '2020-02-03T00:00:00');
  assert.equal(report.error_value_count, 1);
  const verified = JSON.parse(execFileSync('python3', [fixture, 'verify', workspace], { encoding: 'utf8' }));
  assert.deepEqual(await readFile(source), before);
  const saved = await readFile(destination);
  const invalid = path.join(workspace, 'invalid.xlsx');
  await writeFile(invalid, 'invalid OOXML document');
  for (const args of [
    { source, destination: source },
    { source, destination: '/tmp/forbidden-engine-delivery.xlsx' },
    { source: invalid, destination },
    { source, destination, sheets: ['Missing'] },
  ]) {
    assert.equal((await call('workbook_recalculate', args)).isError, true, JSON.stringify(args));
    assert.deepEqual(await readFile(source), before);
    assert.deepEqual(await readFile(destination), saved);
  }
  await assert.rejects(access('/tmp/forbidden-engine-delivery.xlsx'), { code: 'ENOENT' });
  const observation = await call('workbook_recalculate', { source });
  assert.equal(observation.isError, false);
  assert.deepEqual(await readFile(source), before);
  assert.deepEqual(await readFile(destination), saved);
  await writeFile(
    path.join(workspace, 'semantic-contract.json'),
    JSON.stringify(
      {
        verified,
        report,
        specialFormulas: cells,
        arrayVerified,
        sourceUnchanged: true,
        failedOperationsAtomic: true,
      },
      null,
      2,
    ),
  );
}
