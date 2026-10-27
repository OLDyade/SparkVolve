import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, cp, readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { Experiment } from '../../src/contracts.js';
import { Controller } from '../../src/controller.js';
import { Store } from '../../src/store.js';
import { treeDigest, fileDigest } from '../../src/artifacts.js';
import { command } from '../../src/docker.js';
import { exportCandidate } from '../../src/export.js';
import { specification } from '../fixtures.js';

test(
  'real containers: native DSH → immutable delivery → private grade → strict decision → installable archive',
  { timeout: 180_000 },
  async () => {
    const image = process.env.HE_TEST_IMAGE;
    assert.ok(
      image,
      'HE_TEST_IMAGE must be an explicit immutable Docker image ID; this test never silently skips',
    );
    const root = await mkdtemp(path.join(os.tmpdir(), 'he-container-'));
    console.log(`Container evidence retained: ${root}`);
    const dataset = path.join(root, 'dataset'),
      seed = path.join(root, 'seed');
    await mkdir(seed);
    await cp(new URL('./fixture.mjs', import.meta.url), path.join(seed, 'fixture.mjs'));
    await writeFile(
      path.join(seed, 'package.json'),
      JSON.stringify({
        name: '@harness-evolution/protocol-fixture',
        version: '1.0.0',
        type: 'module',
        scripts: { build: 'node --check fixture.mjs' },
        files: ['fixture.mjs', 'cordis.patch.yml'],
        dsh: { bundle: { patch: './cordis.patch.yml' } },
      }),
    );
    await writeFile(
      path.join(seed, 'package-lock.json'),
      JSON.stringify({
        name: '@harness-evolution/protocol-fixture',
        version: '1.0.0',
        lockfileVersion: 3,
        packages: { '': { name: '@harness-evolution/protocol-fixture', version: '1.0.0' } },
      }),
    );
    await writeFile(path.join(seed, 'cordis.patch.yml'), '- insert:\n    - name: ./fixture.mjs\n');
    const tasks = [];
    for (const id of ['alpha', 'beta']) {
      const input = `inputs/${id}`,
        evaluation = `private/${id}`;
      await mkdir(path.join(dataset, input), { recursive: true });
      await mkdir(path.join(dataset, evaluation), { recursive: true });
      await writeFile(path.join(dataset, input, 'message.txt'), id);
      await writeFile(path.join(dataset, evaluation, 'expected.txt'), id.toUpperCase());
      await writeFile(
        path.join(dataset, evaluation, 'grade.mjs'),
        `import { readFile, writeFile } from 'node:fs/promises';
const actual = await readFile('/delivery/result.txt', 'utf8');
const expected = await readFile('/evaluation/expected.txt', 'utf8');
await writeFile('/workspace/result.json', JSON.stringify({ score: Number(actual === expected), metrics: {}, feedback: actual === expected ? 'Exact match' : 'Mismatch' }));`,
      );
      tasks.push({
        id,
        prompt: 'Use fixture_deliver to process the public input.',
        input,
        evaluation,
        inputDigest: await treeDigest(path.join(dataset, input)),
        evaluationDigest: await treeDigest(path.join(dataset, evaluation)),
      });
    }
    const spec = Experiment.parse({
      ...specification(),
      runtime: { image, dshVersion: '0.2.1-rc.4', profile: 'sdk-minimal', environment: null },
      executor: {
        provider: 'container-fixture',
        model: 'fixture',
        reasoningEffort: 'off',
        maxTokens: 1024,
        credentialEnv: [],
      },
      tasks,
      timeoutSeconds: 60,
      evaluator: { image, command: ['node', '/evaluation/grade.mjs'], timeoutSeconds: 30 },
      candidate: {
        patch: 'cordis.patch.yml',
        build: { image, timeoutSeconds: 60 },
        qa: ['node', '--check', '/candidate/fixture.mjs'],
      },
    });
    const store = new Store(path.join(root, 'experiment.sqlite'), spec);
    let controller = new Controller(root, dataset, spec, store);
    try {
      await controller.start();
      const candidate = await controller.seed(seed);
      await writeFile(path.join(root, 'experiment.json'), JSON.stringify(spec));
      await controller.close();
      const child = spawn(process.execPath, ['dist/cli.js', 'run', '--root', root], {
        cwd: process.cwd(),
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let childLog = '';
      child.stdout.on('data', (data) => {
        childLog += data;
      });
      child.stderr.on('data', (data) => {
        childLog += data;
      });
      const exited = once(child, 'exit');
      const deadline = Date.now() + 30_000;
      let originalContainers: string[] = [];
      try {
        while (Date.now() < deadline) {
          assert.equal(child.exitCode, null, `Controller exited before crash injection: ${childLog}`);
          const active = store.runs(candidate.digest);
          if (active.length === 2 && active.every((run) => run.phase === 'executing')) {
            const inspected = await Promise.all(
              active.map((run) => controller.docker.inspect(run.container)),
            );
            if (inspected.every((container) => container?.Status === 'running')) {
              originalContainers = await Promise.all(
                active.map((run) => command('docker', ['inspect', '--format', '{{.Id}}', run.container])),
              );
              break;
            }
          }
          await delay(25);
        }
        assert.equal(originalContainers.length, 2, 'Real containers must be running before controller crash');
      } finally {
        child.kill('SIGKILL');
        await exited;
        await writeFile(path.join(root, 'crashed-controller.log'), childLog);
      }
      const lease = store.db.prepare('SELECT expires FROM lease WHERE id=1').get() as { expires: number };
      await delay(Math.max(0, lease.expires - Date.now()) + 50);
      controller = new Controller(root, dataset, spec, store);
      await controller.start();
      await controller.pump();
      const runs = store.runs(candidate.digest);
      assert.deepEqual(
        await Promise.all(
          runs.map((run) => command('docker', ['inspect', '--format', '{{.Id}}', run.container])),
        ),
        originalContainers,
        'Crash recovery must collect the original containers',
      );
      assert.deepEqual(
        runs.map((run) => ({ phase: run.phase, score: run.grade?.score })),
        [
          { phase: 'scored', score: 1 },
          { phase: 'scored', score: 1 },
        ],
      );
      assert.equal(store.getMeta('champion'), candidate.digest);
      for (const run of runs) {
        const metrics = JSON.parse(
          await readFile(path.join(root, 'runs', run.id, 'trace', 'metrics.json'), 'utf8'),
        );
        assert.equal(metrics.started, 2);
        assert.equal(metrics.results, 2);
        assert.equal(metrics.unfinished, 0);
        assert.equal(metrics.inputTokensReported, 25);
        const settings = JSON.parse(
          await command('docker', ['inspect', '--format', '{{json .HostConfig}}', run.gradeContainer]),
        );
        assert.equal(settings.NetworkMode, 'none');
        assert.equal(settings.ReadonlyRootfs, true);
      }
      await controller.close();
      controller = new Controller(root, dataset, spec, store);
      await controller.start();
      await controller.pump();
      assert.deepEqual(store.runs(candidate.digest), runs, 'Restart cannot rerun completed tasks');
      const output = path.join(root, 'export');
      await exportCandidate(root, store, candidate.digest, output);
      assert.equal((await readdir(output)).filter((file) => file.endsWith('.tgz')).length, 1);
      const record = JSON.parse(await readFile(path.join(output, 'research-record.json'), 'utf8'));
      assert.equal(record.runs.length, 2);
      assert.equal(
        await fileDigest(path.join(output, 'bundle.tgz')),
        store.candidate(candidate.digest).build!.tarballDigest,
      );
      assert.equal(
        await treeDigest(path.join(output, 'artifact/bundle')),
        store.candidate(candidate.digest).build!.bundleDigest,
      );
      assert.equal(await treeDigest(path.join(output, 'source')), candidate.digest);
    } finally {
      await controller.close();
      store.close();
    }
  },
);
