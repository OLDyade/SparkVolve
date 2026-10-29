import { writeSync } from 'node:fs';
import { subscribe } from 'node:diagnostics_channel';
import path from 'node:path';
import { freeze } from '../../src/artifacts.ts';

const [root, phase] = process.argv.slice(2);
subscribe('sparkvolve:publication', (event) => {
  if (event.phase !== phase) return;
  writeSync(1, JSON.stringify(event) + '\n');
  process.kill(process.pid, 'SIGSTOP');
});
await freeze(path.join(root, 'source'), path.join(root, 'snapshot'), path.join(root, 'publications'));
