import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { upstreamFailures } from '../src/upstream-failure.js';

test('upstream taxonomy uses adapter codes, never task error text', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'upstream-taxonomy-'));
  try {
    assert.deepEqual(await upstreamFailures(root), []);
    await mkdir(path.join(root, 'trace'));
    const records = [
      { id: 'a', kind: 'started' },
      { id: 'a', kind: 'failed', finishReason: { kind: 'error', failure: { code: 'RATE_LIMIT' } } },
      { id: 'b', kind: 'failed', failureCode: 'TRANSPORT' },
      { id: 'c', kind: 'failed', error: '402 quota 429 server timeout' },
      { id: 'd', kind: 'failed', failureCode: 'CONTEXT_WINDOW_EXCEEDED' },
      { id: 'e', kind: 'failed', failureCode: 'INVALID_REQUEST' },
      { id: 'f', kind: 'result', finishReason: { kind: 'stop' } },
    ];
    await writeFile(
      path.join(root, 'trace/requests.jsonl'),
      records.map((x) => JSON.stringify(x)).join('\n'),
    );
    assert.deepEqual(await upstreamFailures(root), [
      { requestId: 'a', code: 'RATE_LIMIT' },
      { requestId: 'b', code: 'TRANSPORT' },
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
