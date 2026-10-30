import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { requestMetrics, collectRequestMetrics } from '../src/metrics.js';
import { sumUsage } from '../src/report.js';

test('cache accounting keeps partial coverage and never reconstructs missing provider totals', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'he-cache-metrics-'));
  const file = path.join(root, 'requests.jsonl');
  try {
    const usages = [
      { inputTokens: 10, outputTokens: 2, cacheReadTokens: 100, cacheWriteTokens: 4, totalTokens: 116 },
      { inputTokens: 20, outputTokens: 3, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 23 },
      { inputTokens: 30, outputTokens: 5 },
      null,
    ];
    const records = usages.flatMap((usage, index) => [
      { id: String(index), kind: 'started' },
      { id: String(index), kind: usage ? 'result' : 'failed', usage },
    ]);
    await writeFile(file, records.map((row) => JSON.stringify(row)).join('\n'));
    const measured = await requestMetrics(file);
    assert.equal(measured.inputTokensReported, 60);
    assert.equal(measured.outputTokensReported, 10);
    assert.equal(measured.cacheReadTokensReported, 100);
    assert.equal(measured.cacheWriteTokensReported, 4);
    assert.equal(measured.cacheReadUsageReports, 2);
    assert.equal(measured.cacheWriteUsageReports, 2);
    assert.equal(measured.totalTokensReported, 139);
    assert.equal(measured.totalTokenUsageReports, 2);
    assert.equal(measured.missingUsage, 1);
    const combined = sumUsage([measured, measured, null]);
    assert.equal(combined.reportedTotals!.cacheReadTokensReported, 200);
    assert.equal(combined.reportedTotals!.cacheReadUsageReports, 4);
    assert.equal(combined.reportedTotals!.totalTokensReported, 278);
    assert.equal(combined.complete, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

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
    assert.equal(result.cacheReadTokensReported, null);
    assert.equal(result.cacheReadUsageReports, 0);
    assert.equal(result.totalTokensReported, null);
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
