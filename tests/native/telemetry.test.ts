import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { stringify } from 'yaml';
import { DeepSeekHarness } from '@deepseek-ai/dsh-sdk-client';

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
    env: { ...process.env, HE_FIXTURE_FINISH_ERROR: '1' },
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
