import { mkdir, cp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Docker } from '../../dist/docker.js';
import { Isolation } from '../../dist/contracts.js';

const [image, isolationFile, output] = process.argv.slice(2);
if (!image || !isolationFile || !output)
  throw new Error('Usage: verify-image.mjs <image-digest> <isolation.json> <new-evidence-directory>');
const root = path.resolve(output);
await mkdir(root);
for (const name of ['input', 'delivery', 'work', 'evaluation']) await mkdir(path.join(root, name));
for (const name of ['grade.py', 'verify.py'])
  await cp(new URL(name, import.meta.url), path.join(root, 'evaluation', name));
await writeFile(
  path.join(root, 'evaluation/expected.json'),
  JSON.stringify([{ sheet: 'Calculation', cell: 'A2', value: 12 }]),
);
const isolation = Isolation.parse(JSON.parse(await readFile(isolationFile, 'utf8')));
const result = await new Docker().run(
  {
    name: `he-spreadsheet-image-${randomUUID()}`,
    image,
    isolation,
    network: 'none',
    env: {},
    timeoutSeconds: 120,
    command: ['python3', '/evaluation/verify.py'],
    mounts: [
      { source: path.join(root, 'input'), target: '/input', writable: true },
      { source: path.join(root, 'delivery'), target: '/delivery', writable: true },
      { source: path.join(root, 'work'), target: '/workspace', writable: true },
      { source: path.join(root, 'evaluation'), target: '/evaluation', writable: false },
    ],
  },
  path.join(root, 'logs'),
);
if (result.ExitCode !== 0)
  throw new Error(`Spreadsheet runtime verification failed (${result.ExitCode}); original evidence: ${root}`);
console.log(await readFile(path.join(root, 'work/preflight.json'), 'utf8'));
