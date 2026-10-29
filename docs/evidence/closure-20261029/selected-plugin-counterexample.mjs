/** A behavior counterexample for the unchanged search-selected helper. */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execute = promisify(execFile);

export async function probe({ call, observe }) {
  await execute('python3', ['-B', '-c', `from openpyxl import Workbook
w = Workbook(); w.active.title = 'Observations'; w.save('/workspace/source.xlsx')`]);
  const result = await call('workbook_write', {
    source: '/workspace/source.xlsx', destination: '/workspace/delivery.xlsx',
    edits: [
      { sheet: 'Observations', cell: 'A1', value: '="("' },
      { sheet: 'Observations', cell: 'A2', value: 'Version (Q1)' },
    ],
  });
  assert.equal(result.isError, false);
  const response = JSON.parse(result.value);
  observe('valid-formula-and-literal-misclassified', response);
  assert.ok(response.warnings.some(text => text.includes('unbalanced parentheses')));
  assert.ok(response.warnings.some(text => text.includes('stored as text rather than formulas')));
  const { stdout } = await execute('python3', ['-B', '-c', `import json
from openpyxl import load_workbook
s = load_workbook('/workspace/delivery.xlsx')['Observations']
print(json.dumps({c: {'value': s[c].value, 'type': s[c].data_type} for c in ['A1', 'A2']}))`]);
  const delivery = JSON.parse(stdout);
  observe('actual-delivery-preserved', delivery);
  assert.equal(delivery.A1.value, '="("');
  assert.equal(delivery.A1.type, 'f');
  assert.equal(delivery.A2.value, 'Version (Q1)');
  assert.equal(delivery.A2.type, 's');
}
