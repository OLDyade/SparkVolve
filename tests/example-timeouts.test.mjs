import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import os from 'node:os';
import path from 'node:path';
import { parse } from 'yaml';
import { DEFAULT_TASK_TIMEOUT_SECONDS } from '../dist/contracts.js';
import { configureEgress } from '../examples/venus/egress.mjs';
import { candidateSecondsForPlan, optimizerSecondsForPlan, timeoutSeconds } from '../examples/timeouts.mjs';
import { specification } from './fixtures.ts';
import { waitTaskContainer } from '../scripts/container-task-deadline.mjs';

test('native transport task deadline kills a running worker using container StartedAt', async () => {
  const calls = [];
  const docker = async (args) => {
    calls.push(args);
    if (args[0] === 'inspect')
      return JSON.stringify([
        {
          State: {
            Running: true,
            StartedAt: new Date(Date.now() - 601_000).toISOString(),
          },
        },
      ]);
    assert.deepEqual(args, ['kill', 'worker']);
    return '';
  };
  await assert.rejects(waitTaskContainer(docker, 'worker', 600), /deadline exceeded/);
  assert.deepEqual(calls, [
    ['inspect', 'worker'],
    ['kill', 'worker'],
  ]);
});

test('task deadline kills while docker wait is pending; collection allowance cannot extend execution', async () => {
  const calls = [];
  const docker = async (args, env, timeoutMs) => {
    calls.push(args);
    if (args[0] === 'inspect')
      return JSON.stringify([
        {
          State: {
            Running: true,
            StartedAt: new Date().toISOString(),
          },
        },
      ]);
    if (args[0] === 'wait') {
      assert.ok(timeoutMs <= 30_050 && timeoutMs > 30_000);
      return new Promise(() => {});
    }
    assert.deepEqual(args, ['kill', 'worker']);
    return '';
  };
  await assert.rejects(waitTaskContainer(docker, 'worker', 0.05), /deadline exceeded/);
  assert.deepEqual(calls, [
    ['inspect', 'worker'],
    ['wait', 'worker'],
    ['kill', 'worker'],
  ]);
});

for (const selected of [undefined, 900, 120]) {
  test(`example HTTP and provider idle settings share the selected deadline: ${selected ?? 'default'}`, async (t) => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'he-timeout-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    await cp(new URL('../examples/venus/', import.meta.url), root, { recursive: true });
    const model = JSON.parse(await readFile(path.join(root, 'model.json'), 'utf8'));
    const egress = await configureEgress(root, model, selected);
    const seconds = selected ?? DEFAULT_TASK_TIMEOUT_SECONDS;
    assert.equal(seconds, selected ?? 600);
    for (const route of [...egress.optimizer, ...egress.executor])
      assert.equal(route.timeoutSeconds, seconds);
    const provider = parse(await readFile(path.join(root, 'cordis.patch.yml'), 'utf8'))[0].config.providers
      .venus;
    assert.equal(provider.timeoutMs, seconds * 1000);
    assert.equal(provider.streamIdleTimeoutMs, seconds * 1000);
    assert.equal(
      provider.models[0].timeoutMs,
      undefined,
      'Timeouts belong to the provider, not model metadata',
    );
  });
}

test('invalid timing input fails and plan covers candidate waves plus all declared autonomous probes', () => {
  for (const value of ['0', '-1', 'NaN', '0.5', '']) assert.throws(() => timeoutSeconds(value));
  const spec = specification();
  spec.tasks = Array(5).fill(spec.tasks[0]);
  spec.repetitions = 2;
  spec.concurrency = 3;
  spec.timeoutSeconds = 600;
  spec.candidate.build.timeoutSeconds = 300;
  spec.evaluator.timeoutSeconds = 120;
  spec.budget.candidates = 4;
  spec.probes = { limit: 6, timeoutSeconds: 600 };
  assert.equal(candidateSecondsForPlan(spec), 300 + 600 + 4 * 720);
  assert.equal(optimizerSecondsForPlan(spec, 1800), 1800 + 3 * 3780 + 6 * 900);
  assert.equal(timeoutSeconds('120', 600), 120, 'Explicit shorter user settings remain exact');
});

for (const example of ['spreadsheet', 'structured-data']) {
  for (const selected of [undefined, '900']) {
    test(`${example} prepare writes task/probe/provider deadlines and full optimizer budget: ${selected ?? 'default'}`, async (t) => {
      const root = await mkdtemp(path.join(os.tmpdir(), 'he-prepare-timeout-'));
      t.after(() => rm(root, { recursive: true, force: true }));
      const dataset = path.join(root, 'data');
      for (const directory of ['input', 'private'])
        await mkdir(path.join(dataset, directory), { recursive: true });
      await writeFile(path.join(dataset, 'input/source.txt'), 'public source');
      await writeFile(path.join(dataset, 'private/grader.txt'), 'private grader');
      await writeFile(
        path.join(dataset, 'tasks.json'),
        JSON.stringify([
          {
            id: 'task',
            prompt: 'Read public source and produce a result',
            input: 'input',
            evaluation: 'private',
          },
        ]),
      );
      const isolation = specification().isolation;
      isolation.network.executor = 'controlled';
      await writeFile(path.join(root, 'isolation.json'), JSON.stringify(isolation));
      const args = [
        new URL(`../examples/${example}/prepare.mjs`, import.meta.url).pathname,
        dataset,
        `sha256:${'a'.repeat(64)}`,
        new URL('../examples/venus/model.json', import.meta.url).pathname,
        path.join(root, 'experiment.json'),
        path.join(root, 'isolation.json'),
        ...(selected ? [selected] : []),
      ];
      await promisify(execFile)(process.execPath, args, { timeout: 30000 });
      const spec = JSON.parse(await readFile(path.join(root, 'experiment.json'), 'utf8'));
      const seconds = Number(selected ?? 600);
      assert.equal(spec.timeoutSeconds, seconds);
      assert.equal(spec.probes.timeoutSeconds, seconds);
      assert.equal(spec.egress.optimizer[0].timeoutSeconds, seconds);
      const provider = parse(await readFile(path.join(dataset, 'runtime/cordis.patch.yml'), 'utf8'))[0].config
        .providers.venus;
      assert.equal(provider.timeoutMs, seconds * 1000);
      assert.equal(provider.streamIdleTimeoutMs, seconds * 1000);
      assert.equal(spec.candidate.build.timeoutSeconds, 300, 'Build retains its independent limit');
      assert.equal(
        spec.budget.optimizerSeconds,
        optimizerSecondsForPlan(spec, example === 'spreadsheet' ? 1800 : 600),
      );
    });
  }
}
