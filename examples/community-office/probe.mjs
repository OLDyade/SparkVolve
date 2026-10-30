import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

// Explicit community-package engineering acceptance; this is not a benchmark grader.
export async function probe({ call, observe, workspace }) {
  const invoke = async (name, args) => {
    const result = await call(name, args);
    assert.equal(result.isError, false, JSON.stringify(result));
    return result.content
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('\n');
  };
  await invoke('excel_create', {
    path: 'acceptance.xlsx',
    sheets: [
      {
        name: 'Evidence',
        rows: [
          ['Item', 'Value'],
          ['zero', 0],
          ['formula', '=B2+7'],
        ],
      },
    ],
  });
  const before = await invoke('excel_read', { path: 'acceptance.xlsx' });
  assert.match(before, /zero/);
  assert.match(before, /=B2\+7/);
  await invoke('excel_update', {
    path: 'acceptance.xlsx',
    cell_updates: [{ sheet: 'Evidence', cell: 'B2', value: 11 }],
  });
  const after = await invoke('excel_read', { path: 'acceptance.xlsx' });
  assert.match(after, /11/);
  assert.match(after, /=B2\+7/);
  const bytes = await readFile(path.join(workspace, 'acceptance.xlsx'));
  assert.equal(bytes.subarray(0, 2).toString(), 'PK');
  await observe('community-office-roundtrip', {
    before,
    after,
    bytes: bytes.length,
    formulaRecalculationTested: false,
  });
}
