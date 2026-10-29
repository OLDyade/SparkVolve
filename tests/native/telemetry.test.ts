import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { stringify } from 'yaml';
import { DeepSeekHarness } from '@deepseek-ai/dsh-sdk-client';
import { requestMetrics } from '../../src/metrics.js';

test(
  'native request, tool and session identities are attributable without double-counting tokens',
  { timeout: 60000 },
  async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'he-telemetry-'));
    const ledger = path.join(root, 'requests.jsonl'),
      patch = path.join(root, 'patch.yml');
    await writeFile(
      patch,
      stringify([
        {
          insert: [
            { id: 'fixture', name: path.resolve('tests/native/telemetry-provider.mjs') },
            {
              id: 'observer',
              name: path.resolve('dist/telemetry.js'),
              config: {
                file: ledger,
                provider: 'telemetry-fixture',
                model: 'protocol-test',
                startedAt: Date.now(),
                timeoutSeconds: 600,
              },
            },
          ],
        },
      ]),
    );
    const runtime = new DeepSeekHarness({
      profile: 'sdk-minimal',
      patches: [patch],
      dshHome: path.join(root, 'home'),
      cwd: root,
      provider: 'telemetry-fixture',
      model: 'protocol-test',
      initializeTimeoutMs: 30000,
      requestTimeoutMs: 30000,
    });
    const rows = async (file: string): Promise<any[]> =>
      (await readFile(file, 'utf8'))
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
    try {
      const result = await runtime.run('Exercise the native observer');
      assert.equal(result.finalResponse, 'telemetry-complete');
      const requests = await rows(ledger),
        events = await rows(`${ledger}.events`);
      const starts = requests.filter((row) => row.kind === 'started');
      assert.equal(starts.length, 3);
      assert.ok(
        starts.every(
          (row) => row.sessionId === result.sessionId && row.initiator?.agentId && row.initiator?.lifecycleId,
        ),
      );
      assert.equal(new Set(starts.map((row) => row.initiator.lifecycleId)).size, 1);
      assert.ok(
        requests
          .filter((row) => row.kind === 'result')
          .every(
            (row) =>
              row.usageSource === 'adapter-reported' &&
              row.finishReason &&
              row.providerResponse === undefined,
          ),
      );
      const tools = events.filter((row) => row.kind === 'tool-result');
      assert.equal(tools.length, 2);
      for (const tool of tools) {
        assert.equal(tool.agentId, starts[0].initiator.agentId);
        assert.ok(tool.callId && tool.rootCallId);
        assert.ok(tool.observedDurationMs >= 0 && tool.dispatchToResultMs >= 0);
        assert.ok(events.some((row) => row.kind === 'tool-prepared' && row.id === tool.id));
        assert.ok(events.some((row) => row.kind === 'tool-dispatched' && row.id === tool.id));
      }
      assert.equal(tools[0].result.isError, false);
      assert.equal(tools[1].result.isError, true);
      assert.ok(events.some((row) => row.kind === 'assistant-frame'));
      assert.ok(
        events.some(
          (row) =>
            row.kind === 'session-event' &&
            row.sessionId === result.sessionId &&
            row.entry.type === 'tool/result',
        ),
      );
      const metrics = await requestMetrics(ledger);
      assert.equal(metrics.started, 3);
      assert.equal(metrics.inputTokensReported, 60);
      assert.equal(metrics.outputTokensReported, 6);
      assert.equal(metrics.unfinished, 0);
    } finally {
      await runtime.close();
      await rm(root, { recursive: true, force: true });
    }
  },
);

test('native error finish is recorded as failed even when the adapter does not throw', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'he-finish-error-'));
  const patch = path.join(root, 'patch.yml'),
    ledger = path.join(root, 'requests.jsonl');
  await writeFile(
    patch,
    stringify([
      {
        insert: [
          { id: 'fixture', name: path.resolve('tests/native/fixture-provider.mjs') },
          {
            id: 'observer',
            name: path.resolve('dist/telemetry.js'),
            config: {
              file: ledger,
              provider: 'evolution-fixture',
              model: 'protocol-test',
              startedAt: Date.now(),
              timeoutSeconds: 30,
            },
          },
        ],
      },
    ]),
  );
  const runtime = new DeepSeekHarness({
    profile: 'sdk-minimal',
    patches: [patch],
    dshHome: path.join(root, 'home'),
    cwd: root,
    provider: 'evolution-fixture',
    model: 'protocol-test',
    initializeTimeoutMs: 30000,
    requestTimeoutMs: 30000,
    env: { ...process.env, SPARKVOLVE_FIXTURE_FINISH_ERROR: '1' },
  });
  try {
    const result = await runtime.run('Exercise native error termination');
    assert.ok(result.events.some((e) => e.type === 'turn/end' && e.data.reason.kind === 'error'));
    const records = (await readFile(ledger, 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    const starts = records.filter((r) => r.kind === 'started');
    const failures = records.filter((r) => r.kind === 'failed');
    assert.ok(starts.length > 0);
    assert.equal(starts.length, failures.length);
    assert.equal(records.filter((r) => r.kind === 'result').length, 0);
    assert.ok(failures.every((r) => r.error.code === 'TRANSPORT'));
  } finally {
    await runtime.close();
    await rm(root, { recursive: true, force: true });
  }
});
