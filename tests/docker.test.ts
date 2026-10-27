import test from 'node:test';
import assert from 'node:assert/strict';
import { command } from '../src/docker.js';

test('abort cancels the host wait promptly instead of waiting for the full model budget', async () => {
  const abort = new AbortController();
  const start = Date.now();
  const waiting = command(process.execPath, ['-e', 'setTimeout(()=>{},60000)'], { signal: abort.signal });
  setTimeout(() => abort.abort(), 50);
  await assert.rejects(waiting, /abort/i);
  assert.ok(Date.now() - start < 3000);
});
