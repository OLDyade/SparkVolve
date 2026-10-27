import { writeSync } from 'node:fs';
import { readFile, realpath } from 'node:fs/promises';
import { subscribe } from 'node:diagnostics_channel';
import path from 'node:path';
import { Store } from '../../src/store.ts';
import { Controller } from '../../src/controller.ts';

const [root, area] = process.argv.slice(2);
const canonicalRoot = await realpath(root);
subscribe('harness-evolution:publication', (event) => {
  const relative = path.relative(canonicalRoot, event.destination);
  const selected = area === 'delivery' ? relative.endsWith('/delivery') : relative.startsWith(`${area}/`);
  if (!selected || event.phase !== 'copying') return;
  writeSync(1, JSON.stringify(event) + '\n');
  process.kill(process.pid, 'SIGSTOP');
});
const spec = JSON.parse(await readFile(path.join(root, 'experiment.json'), 'utf8'));
const store = new Store(path.join(root, 'experiment.sqlite'), spec);
const controller = new Controller(root, path.join(root, 'dataset'), spec, store);
try {
  await controller.start();
  if (!store.candidates().length) await controller.seed(path.join(root, 'seed'));
  await controller.pump();
} finally {
  await controller.close();
  store.close();
}
