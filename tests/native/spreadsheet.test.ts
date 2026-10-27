import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { command } from '../../src/docker.js';

test('spreadsheet QA mounts actual native tools and rejects a non-activating schema', async () => {
  const qa = path.resolve('examples/spreadsheet/qa.mjs');
  const seed = path.resolve('examples/spreadsheet/seed/index.mjs');
  const result = JSON.parse(await command(process.execPath, [qa, seed]));
  assert.deepEqual(result, { activated: true, tools: ['workbook_inspect', 'workbook_write'] });
  // Keep the fixture under the repository so native package imports resolve normally.
  const directory = await mkdtemp(path.resolve('node_modules/.spreadsheet-schema-test-'));
  try {
    const broken = path.join(directory, 'broken.mjs');
    await writeFile(
      broken,
      (await readFile(seed, 'utf8')).replace(
        'additionalProperties: false,',
        "required: ['sheet', 'cell', 'value'],",
      ),
    );
    await assert.rejects(command(process.execPath, [qa, broken]), /value schema DSL/);
  } finally {
    await rm(directory, { recursive: true });
  }
});
