/** Independent observations of the unchanged, rejected open-plugin candidate.
 * Success means the documented counterexamples were reproduced, not that the plugin is correct.
 */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execute = promisify(execFile);

export async function probe({ call, observe }) {
  await execute('python3', ['-B', '-c', `from openpyxl import Workbook
w = Workbook(); s = w.active; s.title = 'Observations'
s['A1'] = 1; s['A2'] = '="ordinary text"'
w.save('/workspace/source.xlsx')`]);
  const write = await call('workbook_write', {
    source: '/workspace/source.xlsx', destination: '/workspace/delivery.xlsx',
    edits: [
      { sheet: 'Observations', cell: 'B1', value: '0012' },
      { sheet: 'Observations', cell: 'B2', value: ' ' },
    ],
  });
  assert.equal(write.isError, false);
  const { stdout } = await execute('python3', ['-B', '-c', `import json
from openpyxl import load_workbook
s = load_workbook('/workspace/delivery.xlsx')['Observations']
print(json.dumps({c: {'value': s[c].value, 'type': s[c].data_type} for c in ['B1', 'B2']}))`]);
  const delivered = JSON.parse(stdout);
  observe('explicit-literal-values-coerced', { requested: { B1: '0012', B2: ' ' }, delivered });
  assert.equal(delivered.B1.value, 12);
  assert.equal(delivered.B1.type, 'n');
  assert.equal(delivered.B2.value, null);

  const inspected = await call('workbook_inspect', { file: '/workspace/source.xlsx', recalculate: true });
  assert.equal(inspected.isError, false);
  const facts = JSON.parse(inspected.value);
  const textFormula = facts.data.Observations.cells.find(cell => cell.cell === 'A2');
  observe('ordinary-formula-string-labelled-error', textFormula);
  assert.equal(textFormula.computed, 'ordinary text');
  assert.equal(textFormula.error, 'ordinary text');
}
