import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { atomicJSON, freeze, treeDigest } from '../../src/artifacts.js';
import { buildBundle } from '../../src/build.js';
import { Docker, command } from '../../src/docker.js';
import { Experiment } from '../../src/contracts.js';
import { Store } from '../../src/store.js';
import { containerSpecification } from '../fixtures.js';

test(
  'public validate SIGINT retains original task; cancel-validation removes it and forbids new arms',
  { timeout: 180_000 },
  async () => {
    const image = process.env.HE_TEST_IMAGE;
    assert.match(image ?? '', /^sha256:[0-9a-f]{64}$/);
    const base = containerSpecification();
    await mkdir('.evolution', { recursive: true });
    const root = await mkdtemp(path.resolve('.evolution/validation-cancellation-native-')),
      source = path.join(root, 'source'),
      dataset = path.join(root, 'dataset'),
      study = path.join(root, 'validation'),
      docker = new Docker();
    console.log(`Validation cancellation evidence retained: ${root}`);
    await mkdir(source);
    await writeFile(
      path.join(source, 'fixture.mjs'),
      (await readFile(new URL('./fixture.mjs', import.meta.url), 'utf8')).replace(
        'await delay(3000);',
        'await delay(30000);',
      ),
    );
    const pkg = {
      name: '@harness-evolution/validation-cancel-fixture',
      version: '1.0.0',
      type: 'module',
      scripts: { build: 'node --check fixture.mjs' },
      files: ['fixture.mjs', 'cordis.patch.yml'],
      dsh: { bundle: { patch: './cordis.patch.yml' } },
    };
    await atomicJSON(path.join(source, 'package.json'), pkg);
    await atomicJSON(path.join(source, 'package-lock.json'), {
      name: pkg.name,
      version: pkg.version,
      lockfileVersion: 3,
      packages: { '': { name: pkg.name, version: pkg.version } },
    });
    await writeFile(path.join(source, 'cordis.patch.yml'), '- insert:\n    - name: ./fixture.mjs\n');
    for (const folder of ['input', 'private']) await mkdir(path.join(dataset, folder), { recursive: true });
    await writeFile(path.join(dataset, 'input/message.txt'), 'alpha');
    await writeFile(
      path.join(dataset, 'private/grade.mjs'),
      'throw new Error("Cancellation acceptance must not reach scoring");',
    );
    const spec = Experiment.parse({
      ...base,
      purpose: 'validation',
      runtime: { image, dshVersion: '0.2.1-rc.4', profile: 'sdk-minimal', environment: null },
      executor: {
        provider: 'container-fixture',
        model: 'fixture',
        reasoningEffort: 'off',
        maxTokens: 1024,
        credentialEnv: [],
      },
      candidate: { patch: 'cordis.patch.yml', build: { image, timeoutSeconds: 60 }, qa: null },
      evaluator: { image, command: ['node', '/evaluation/grade.mjs'], timeoutSeconds: 30 },
      tasks: [
        {
          id: 'alpha',
          input: 'input',
          evaluation: 'private',
          prompt: 'Use fixture_deliver to process the public input.',
          inputDigest: await treeDigest(path.join(dataset, 'input')),
          evaluationDigest: await treeDigest(path.join(dataset, 'private')),
        },
      ],
      concurrency: 1,
      repetitions: 1,
      timeoutSeconds: 90,
      failureLimit: 0,
      budget: { candidates: 1, optimizerSeconds: 60 },
    });
    const sourceDigest = await treeDigest(source),
      preparation = path.join(root, 'preparation');
    await freeze(
      source,
      path.join(preparation, 'candidates', sourceDigest),
      path.join(preparation, 'publications'),
    );
    const build = await buildBundle(
      preparation,
      root,
      sourceDigest,
      spec.candidate.build,
      spec.isolation,
      docker,
    );
    const arms = ['h0', 'selected'].map((id) => ({
      id,
      source,
      digest: sourceDigest,
      artifact: path.join(preparation, 'artifacts', sourceDigest),
      build,
    }));
    await atomicJSON(path.join(root, 'spec.json'), spec);
    await atomicJSON(path.join(root, 'arms.json'), arms);
    const args = [
      'dist/cli.js',
      'validate',
      '--root',
      study,
      '--spec',
      path.join(root, 'spec.json'),
      '--dataset',
      dataset,
      '--arms',
      path.join(root, 'arms.json'),
    ];
    const child = spawn(process.execPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let log = '';
    child.stdout.on('data', (data) => {
      log += String(data);
    });
    child.stderr.on('data', (data) => {
      log += String(data);
    });
    const closed = once(child, 'close');
    let original: { name: string; id: string } | undefined;
    try {
      const deadline = Date.now() + 45_000;
      while (Date.now() < deadline) {
        assert.equal(child.exitCode, null, `Validation exited before interrupt: ${log}`);
        try {
          const store = new Store(path.join(study, 'arms/h0/experiment.sqlite'), spec, 'read');
          try {
            const run = store.runs().find((item) => item.phase === 'executing');
            if (run && (await docker.inspect(run.container))?.Running) {
              original = { name: run.container, id: (await docker.configuration(run.container)).Id };
              break;
            }
          } finally {
            store.close();
          }
        } catch (error) {
          if (!(error instanceof Error && /unable to open database/.test(error.message))) throw error;
        }
        await delay(25);
      }
      assert.ok(original, 'A real task container must be in flight before SIGINT');
      child.kill('SIGINT');
      const [code, signal] = await closed;
      await writeFile(path.join(root, 'observer.log'), log);
      assert.equal(signal, null, 'CLI must handle interruption and release its lease');
      assert.notEqual(code, 0);
      assert.match(log, /Validation observer interrupted/);
      assert.equal((await docker.configuration(original.name)).Id, original.id);
      assert.equal((await docker.inspect(original.name))?.Running, true);
      await assert.rejects(readFile(path.join(study, 'arms/selected/experiment.sqlite')), { code: 'ENOENT' });
      const output = await command(process.execPath, ['dist/cli.js', 'cancel-validation', '--root', study]);
      const receipt = JSON.parse(output);
      await writeFile(path.join(root, 'cancel-command.json'), output);
      assert.equal(receipt.outcome, 'cancelled');
      assert.deepEqual(
        receipt.arms.map((arm: { cleanup: { state: string } }) => arm.cleanup.state),
        ['cancelled', 'unstarted'],
      );
      assert.equal(await docker.inspect(original.name), undefined);
      assert.deepEqual(
        JSON.parse(await command(process.execPath, ['dist/cli.js', 'cancel-validation', '--root', study])),
        receipt,
      );
      await assert.rejects(command(process.execPath, args), /cancellation has started/);
      await assert.rejects(readFile(path.join(study, 'arms/selected/experiment.sqlite')), { code: 'ENOENT' });
      await atomicJSON(path.join(root, 'acceptance.json'), {
        passed: true,
        image,
        original,
        observerHandledSignal: true,
        cancelled: receipt,
        modelCalls: 'deterministic fixture only; no external provider',
      });
    } finally {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGINT');
        await closed;
      }
      // The fixture's owner performs explicit cleanup even when an assertion exposes a regression.
      try {
        await command(process.execPath, ['dist/cli.js', 'cancel-validation', '--root', study]);
      } finally {
        await writeFile(path.join(root, 'observer.log'), log);
      }
    }
  },
);
