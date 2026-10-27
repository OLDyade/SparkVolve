import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import os from 'node:os';
import { stringify } from 'yaml';
import { DeepSeekHarness } from '@deepseek-ai/dsh-sdk-client';

test(
  'real SDK subprocess assembles evolution schema, executes tool and resumes the native loop',
  { timeout: 60_000 },
  async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'he-sdk-'));
    let requests = 0;
    const server = createServer((_req, res) => {
      requests++;
      res.writeHead(200).end('{"champion":null,"budget":1}');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Expected TCP address');
    const patch = path.join(root, 'native.patch.yml');
    await writeFile(
      patch,
      stringify([
        {
          insert: [
            { id: 'test-provider', name: path.resolve('tests/native/fixture-provider.mjs') },
            {
              id: 'test-observer',
              name: path.resolve('dist/telemetry.js'),
              config: {
                file: path.join(root, 'stream-events.jsonl'),
                provider: 'evolution-fixture',
                model: 'protocol-test',
                startedAt: Date.now() - 2000,
                timeoutSeconds: 30,
              },
            },
            {
              id: 'test-evolution',
              name: path.resolve('dist/plugin.js'),
              config: { endpoint: `http://127.0.0.1:${address.port}`, tokenEnv: 'HE_TEST_TOKEN' },
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
      initializeTimeoutMs: 30_000,
      requestTimeoutMs: 30_000,
      env: {
        PATH: process.env.PATH,
        HOME: root,
        HE_TEST_TOKEN: 'native-fixture-token',
        HE_FIXTURE_REQUESTS: path.join(root, 'requests.jsonl'),
      },
    });
    try {
      const result = await runtime.run('Read evolution_status and report its receipt.');
      assert.equal(result.finalResponse, 'native-evolution-connected');
      assert.equal(requests, 1);
      assert.ok(result.events.some((event) => event.type === 'tool/result'));
      const actualRequests = (await readFile(path.join(root, 'requests.jsonl'), 'utf8'))
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
      assert.equal(actualRequests.length, 2);
      assert.match(JSON.stringify(actualRequests[0].messages), /Execution budget: 30s; elapsed: \d+s/);
      assert.ok(actualRequests[1].messages.some((m: { role: string }) => m.role === 'tool'));
    } finally {
      await runtime.close();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
      await rm(root, { recursive: true, force: true });
    }
  },
);
