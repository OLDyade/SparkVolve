import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { Store } from '../src/store.js';
import { experimentReport } from '../src/report.js';
import { specification, candidate, runs } from './fixtures.js';

test('report retains failed samples, QA budget, absent ledgers and optimizer expenditure', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'he-report-'));
  const store = new Store(path.join(root, 'experiment.sqlite'), specification());
  const seed = candidate();
  store.addCandidate(seed);
  store.admit(seed, runs());
  const [first, second] = store.runs();
  const start = '2026-10-27T00:00:00Z',
    end = '2026-10-27T00:00:02Z';
  store.transition(first!.id, 'queued', 'executing', { startedAt: start });
  store.transition(first!.id, 'executing', 'delivered', { completedAt: end });
  store.transition(first!.id, 'delivered', 'scoring');
  store.transition(first!.id, 'scoring', 'scored', { grade: { score: 1, metrics: {}, feedback: '' } });
  store.transition(second!.id, 'queued', 'cancelled', { error: 'budget stop' });
  store.decide(seed.digest);
  const rejected = candidate('b'.repeat(64), 1);
  store.addCandidate(rejected);
  store.updateCandidate({ ...rejected, phase: 'qa_failed', qaError: 'invalid tool schema' });
  store.reserveSubmission({ digest: 'c'.repeat(64), proposal: candidate().proposal, phase: 'frozen' });
  const executorTrace = path.join(root, 'runs', first!.id, 'trace');
  const optimizerTrace = path.join(root, 'optimizer/0/trace');
  await mkdir(executorTrace, { recursive: true });
  await mkdir(optimizerTrace, { recursive: true });
  const ledger = async (trace: string, rows: unknown[]) =>
    writeFile(path.join(trace, 'requests.jsonl'), rows.map((row) => JSON.stringify(row)).join('\n'));
  await ledger(executorTrace, [
    { id: 'execute', kind: 'started' },
    {
      id: 'execute',
      kind: 'result',
      durationMs: 400,
      usage: { inputTokens: 100, outputTokens: 10, cacheReadTokens: 900, totalTokens: 1010 },
    },
  ]);
  await ledger(optimizerTrace, [
    { id: 'opt', kind: 'started' },
    { id: 'opt', kind: 'failed', durationMs: 100, usage: null },
    { id: 'unfinished', kind: 'started' },
  ]);
  // Stale derived metrics must not replace the durable request ledger.
  await writeFile(path.join(optimizerTrace, 'metrics.json'), '{"started":0}');
  try {
    const report = await experimentReport(root, store);
    assert.equal(report.candidatesConsumed, 3);
    assert.equal(report.pendingSubmissions.length, 1);
    assert.equal(report.pendingSubmissions[0]!.digest, 'c'.repeat(64));
    assert.equal(report.candidates[0]!.mean, 0.5);
    assert.equal(report.candidates[0]!.failedRuns, 1);
    assert.equal(report.candidates[0]!.executionElapsedMsReported, 2000);
    assert.equal(report.candidates[0]!.missingExecutionDurations, 1);
    assert.equal(report.candidates[1]!.mean, null);
    assert.equal(report.candidates[1]!.observedRuns, 0);
    assert.equal(report.candidates[1]!.expectedRuns, 2);
    assert.equal(report.optimizer.usage.reportedTotals!.started, 2);
    assert.equal(report.totalUsage.reportedTotals!.started, 3);
    assert.equal(report.totalUsage.reportedTotals!.failed, 1);
    assert.equal(report.totalUsage.reportedTotals!.unfinished, 1);
    assert.equal(report.totalUsage.reportedTotals!.missingUsage, 1);
    assert.equal(report.totalUsage.reportedTotals!.inputTokensReported, 100);
    assert.equal(report.totalUsage.reportedTotals!.cacheReadTokensReported, 900);
    assert.equal(report.totalUsage.reportedTotals!.cacheReadUsageReports, 1);
    assert.equal(report.totalUsage.reportedTotals!.cacheWriteTokensReported, null);
    assert.equal(report.totalUsage.reportedTotals!.cacheWriteUsageReports, 0);
    assert.equal(report.totalUsage.reportedTotals!.totalTokensReported, 1010);
    assert.equal(report.totalUsage.unavailableLedgers, 1);
    assert.equal(report.totalUsage.complete, false);
    assert.equal(report.monetaryCost, null);
    assert.deepEqual(await experimentReport(root, store), report);
    await writeFile(path.join(optimizerTrace, 'requests.jsonl'), 'not-json');
    await assert.rejects(experimentReport(root, store), SyntaxError);
  } finally {
    store.close();
    await rm(root, { recursive: true, force: true });
  }
});
