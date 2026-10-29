/** Keep repository text in English, with the two root README language entry points. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const bilingual = new Set(['README.md', 'README.zh-CN.md']);
// Raster captions are reviewed visually; interpreting compressed pixels as UTF-8 is invalid.
const raster = /\.(?:png|jpe?g|webp|gif)$/i;
const files = [
  ...new Set(
    execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], {
      cwd: root,
      encoding: 'utf8',
    })
      .split('\0')
      .filter(Boolean),
  ),
];
const violations = [];
let checked = 0;
for (const file of files) {
  if (/\p{Script=Han}/u.test(file)) violations.push(`${file}: file name must be in English`);
  if (bilingual.has(file) || raster.test(file)) continue;
  let bytes;
  try {
    bytes = await readFile(path.join(root, file));
  } catch (error) {
    if (error.code === 'ENOENT') continue;
    throw error;
  }
  const source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  checked++;
  source.split('\n').forEach((line, index) => {
    if (/\p{Script=Han}/u.test(line))
      violations.push(`${file}:${index + 1}: Chinese text is only allowed in root bilingual READMEs`);
  });
}
assert.equal(violations.length, 0, `Repository language policy violations:\n${violations.join('\n')}`);
console.log(`Language policy passed: ${checked} text files; bilingual root READMEs exempt.`);
