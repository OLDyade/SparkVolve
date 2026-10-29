import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import os from 'node:os';
import { stringify } from 'yaml';
import { DeepSeekHarness } from '@deepseek-ai/dsh-sdk-client';
import { evolutionPreset, sdkPreset } from '../../src/preset.js';

test(
  'native spawn inherits the retained Evolution Preset and executes its capability',
  { timeout: 60_000 },
  async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'he-preset-child-'));
    let calls = 0;
    const server = createServer((_req, res) => {
      calls++;
      res.writeHead(200).end('{"champion":null}');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const patch = path.join(root, 'patch.yml');
    await writeFile(
      patch,
      stringify([
        {
          insert: [
            { id: 'provider', name: path.resolve('tests/native/fixture-provider.mjs') },
            ...sdkPreset('evolution', path.resolve('dist/sdk-preset.js'), 'sdk'),
            evolutionPreset({
              plugin: path.resolve('dist/plugin.js'),
              endpoint: `http://127.0.0.1:${address.port}`,
              tokenEnv: 'SPARKVOLVE_TEST_TOKEN',
              composition: path.resolve('optimizers/evidence-driven/plugins.yml'),
            }),
            {
              id: 'delegation-probe',
              name: path.resolve('tests/native/delegation-probe.mjs'),
              config: { file: path.join(root, 'children.jsonl') },
            },
          ],
        },
      ]),
    );
    const runtime = new DeepSeekHarness({
      profile: 'sdk',
      patches: [patch],
      dshHome: path.join(root, 'home'),
      cwd: root,
      provider: 'evolution-fixture',
      model: 'protocol-test',
      env: {
        ...process.env,
        SPARKVOLVE_TEST_TOKEN: 'child-fixture',
        SPARKVOLVE_FIXTURE_REQUESTS: path.join(root, 'requests.jsonl'),
      },
    });
    try {
      const run = await runtime.run('Verify child inheritance.');
      assert.equal(calls, 1, JSON.stringify(run.events));
      const children = (await readFile(path.join(root, 'children.jsonl'), 'utf8'))
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
      assert.equal(children[0].kind, 'child');
      assert.equal(children[0].preset, 'evolution');
      assert.equal(children[1].kind, 'result');
      assert.match(JSON.stringify(children[1].result), /native-evolution-connected/);
      const requests = (await readFile(path.join(root, 'requests.jsonl'), 'utf8'))
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
      assert.equal(requests.length, 3);
      for (const request of requests) {
        assert.ok(request.tools.some((t: { name: string }) => t.name === 'evolution_status'));
        assert.match(JSON.stringify(request.messages), /Evolve the Harness, Not the Model/);
      }
    } finally {
      await runtime.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await rm(root, { recursive: true, force: true });
    }
  },
);

test('missing selected preset fails before any model request', { timeout: 30_000 }, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'he-preset-missing-'));
  const patch = path.join(root, 'patch.yml');
  await writeFile(
    patch,
    stringify([
      {
        insert: [
          { id: 'provider', name: path.resolve('tests/native/fixture-provider.mjs') },
          ...sdkPreset('missing-preset', path.resolve('dist/sdk-preset.js'), 'sdk-minimal'),
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
    env: { ...process.env, SPARKVOLVE_FIXTURE_REQUESTS: path.join(root, 'requests.jsonl') },
  });
  try {
    await assert.rejects(runtime.run('Never invoke a model with a missing composition'), /preset/i);
    await assert.rejects(readFile(path.join(root, 'requests.jsonl')), { code: 'ENOENT' });
  } finally {
    await runtime.close();
    await rm(root, { recursive: true, force: true });
  }
});

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
              id: 'ordinary-selector',
              name: path.resolve('tests/native/preset-probe.mjs'),
              config: { selectOrdinary: true },
            },
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
            ...sdkPreset('evolution', path.resolve('dist/sdk-preset.js'), 'sdk-minimal'),
            evolutionPreset({
              plugin: path.resolve('dist/plugin.js'),
              endpoint: `http://127.0.0.1:${address.port}`,
              tokenEnv: 'SPARKVOLVE_TEST_TOKEN',
              composition: path.resolve('optimizers/evidence-driven/plugins.yml'),
            }),
            {
              id: 'preset-ordinary',
              name: '@deepseek-ai/dsh-agent-preset',
              config: { id: 'ordinary', plugins: [] },
            },
            {
              id: 'preset-observer',
              name: path.resolve('tests/native/preset-probe.mjs'),
              config: { file: path.join(root, 'presets.jsonl') },
            },
          ],
        },
      ]),
    );
    const options = {
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
        SPARKVOLVE_TEST_TOKEN: 'native-fixture-token',
        SPARKVOLVE_FIXTURE_REQUESTS: path.join(root, 'requests.jsonl'),
      },
    };
    let runtime = new DeepSeekHarness(options);
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
      assert.match(JSON.stringify(actualRequests[0].messages), /Evolve the Harness, Not the Model/);
      assert.match(JSON.stringify(actualRequests[0].messages), /Execution budget: 30s; elapsed: \d+s/);
      assert.ok(actualRequests[1].messages.some((m: { role: string }) => m.role === 'tool'));
      const ordinary = await runtime.run('ordinary-session', { sessionId: 'ordinary-session' });
      assert.equal(ordinary.finalResponse, 'ordinary-connected');
      await runtime.close();
      runtime = new DeepSeekHarness(options);
      const resumed = await runtime.resumeSession(result.sessionId);
      assert.equal(
        (await resumed.run('Read evolution_status again.')).finalResponse,
        'native-evolution-connected',
      );
      assert.equal(requests, 2);
      const observations = (await readFile(path.join(root, 'presets.jsonl'), 'utf8'))
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
      assert.deepEqual(
        observations.map((o) => [o.source, o.recorded, o.composed]),
        [
          ['startup', 'evolution', 'evolution'],
          ['startup', 'ordinary', 'ordinary'],
          ['resume', 'evolution', 'evolution'],
        ],
      );
      for (const o of observations) {
        assert.equal(
          o.globalTools.some((name: string) => name.startsWith('evolution_')),
          false,
        );
        assert.equal(o.tools.includes('evolution_status'), o.composed === 'evolution');
        assert.equal(o.sections.includes('evolution-research-method'), o.composed === 'evolution');
      }
    } finally {
      await runtime.close();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
      await rm(root, { recursive: true, force: true });
    }
  },
);
