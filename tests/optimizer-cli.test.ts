import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const cli = fileURLToPath(new URL('../src/cli.ts', import.meta.url));
test('optimizer CLI publishes one container endpoint and rejects the removed host API endpoint', async () => {
  const run = promisify(execFile);
  const help = await run(process.execPath, ['--import', 'tsx', cli, '--help']);
  assert.match(help.stdout, /optimize\s+--root <directory> --endpoint <container-reachable-url>/);
  assert.doesNotMatch(help.stdout, /--control-endpoint/);
  await assert.rejects(
    run(process.execPath, ['--import', 'tsx', cli, 'optimize', '--control-endpoint', 'http://127.0.0.1:1']),
    /Unknown option.*control-endpoint/,
  );
});
