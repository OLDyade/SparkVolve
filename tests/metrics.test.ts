import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { requestMetrics, collectRequestMetrics } from '../src/metrics.js';

test('request ledger distinguishes failure, unfinished calls and unavailable usage', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'he-metrics-')),
    file = path.join(root, 'requests.jsonl');
  try {
    const records = [
      { id: 'one', kind: 'started' },
      { id: 'one', kind: 'result', durationMs: 10, usage: { inputTokens: 8, outputTokens: 3 } },
      { id: 'two', kind: 'started' },
      { id: 'two', kind: 'failed', durationMs: 5, usage: null },
      { id: 'three', kind: 'started' },
    ];
    await writeFile(file, records.map((row) => JSON.stringify(row)).join('\n'));
    const result = (await requestMetrics(file)) as Record<string, unknown>;
    assert.equal(result.started, 3);
    assert.equal(result.results, 1);
    assert.equal(result.failed, 1);
    assert.equal(result.unfinished, 1);
    assert.equal(result.missingUsage, 1);
    assert.equal(result.inputTokensReported, 8);
    await collectRequestMetrics(root);
    assert.deepEqual(JSON.parse(await readFile(path.join(root, 'metrics.json'), 'utf8')), result);
    await writeFile(
      file,
      records
        .concat(records[0]!)
        .map((row) => JSON.stringify(row))
        .join('\n'),
    );
    await assert.rejects(requestMetrics(file), /Duplicate request start/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
