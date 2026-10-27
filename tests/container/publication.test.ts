import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, cp } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import os from 'node:os';
import path from 'node:path';
import { Experiment } from '../../src/contracts.js';
import { Store } from '../../src/store.js';
import { Controller } from '../../src/controller.js';
import { atomicJSON, treeDigest, digest } from '../../src/artifacts.js';
import { command } from '../../src/docker.js';
import { containerSpecification } from '../fixtures.js';

test(
  'real containers survive SIGKILL during source, build and delivery publication without resampling',
  { timeout: 180_000, concurrency: true },
  async (t) => {
    const image = process.env.HE_TEST_IMAGE;
    assert.ok(image, 'HE_TEST_IMAGE is required');
    await Promise.all(
      ['candidates', 'artifacts', 'delivery'].map((area) =>
        t.test(area, { concurrency: true }, async () => {
          const root = await mkdtemp(path.join(os.tmpdir(), `he-publication-${area}-`));
          console.log(`Publication recovery evidence: ${root}`);
          const seed = path.join(root, 'seed'),
            dataset = path.join(root, 'dataset');
          await mkdir(seed);
          await cp(new URL('./fixture.mjs', import.meta.url), path.join(seed, 'fixture.mjs'));
          const pkg = {
            name: '@harness-evolution/publication-fixture',
            version: '1.0.0',
            type: 'module',
            scripts: { build: 'node --check fixture.mjs' },
            files: ['fixture.mjs', 'cordis.patch.yml'],
            dsh: { bundle: { patch: './cordis.patch.yml' } },
          };
          await atomicJSON(path.join(seed, 'package.json'), pkg);
          await atomicJSON(path.join(seed, 'package-lock.json'), {
            name: pkg.name,
            version: pkg.version,
            lockfileVersion: 3,
            packages: { '': { name: pkg.name, version: pkg.version } },
          });
          await writeFile(path.join(seed, 'cordis.patch.yml'), '- insert:\n    - name: ./fixture.mjs\n');
          await mkdir(path.join(dataset, 'inputs/task'), { recursive: true });
          await mkdir(path.join(dataset, 'evaluation/task'), { recursive: true });
          await writeFile(path.join(dataset, 'inputs/task/message.txt'), 'publication');
          await writeFile(
            path.join(dataset, 'evaluation/task/grade.mjs'),
            `import {readFile,writeFile} from 'node:fs/promises';
const text=await readFile('/delivery/result.txt','utf8');
await writeFile('/workspace/result.json',JSON.stringify({score:Number(text==='PUBLICATION'),metrics:{},feedback:'Independent literal fixture'}));`,
          );
          const spec = Experiment.parse({
            ...containerSpecification(),
            runtime: { image, dshVersion: '0.2.1-rc.4', profile: 'sdk-minimal', environment: null },
            executor: {
              provider: 'container-fixture',
              model: 'fixture',
              reasoningEffort: 'off',
              maxTokens: 1024,
              credentialEnv: [],
            },
            tasks: [
              {
                id: 'task',
                prompt: 'Use fixture_deliver to process the public input.',
                input: 'inputs/task',
                inputDigest: await treeDigest(path.join(dataset, 'inputs/task')),
                evaluation: 'evaluation/task',
                evaluationDigest: await treeDigest(path.join(dataset, 'evaluation/task')),
              },
            ],
            repetitions: 1,
            failureLimit: 0,
            concurrency: 1,
            timeoutSeconds: 60,
            budget: { candidates: 1, optimizerSeconds: 60 },
            candidate: { patch: 'cordis.patch.yml', build: { image, timeoutSeconds: 60 }, qa: null },
            evaluator: { image, command: ['node', '/evaluation/grade.mjs'], timeoutSeconds: 30 },
          });
          await atomicJSON(path.join(root, 'experiment.json'), spec);
          const child = spawn(
            process.execPath,
            [
              '--import',
              'tsx',
              path.join(import.meta.dirname, '../fixtures/controller-publication-child.mjs'),
              root,
              area,
            ],
            { stdio: ['ignore', 'pipe', 'pipe'] },
          );
          const closed = once(child, 'close');
          let stderr = '';
          child.stderr.on('data', (data) => {
            stderr += String(data);
          });
          try {
            const marker = await Promise.race([
              once(child.stdout, 'data').then(
                ([bytes]) => JSON.parse(String(bytes)) as { destination: string; phase: string },
              ),
              closed.then(() => {
                throw new Error(`Controller exited before publication: ${stderr}`);
              }),
            ]);
            assert.equal(marker.phase, 'copying');
            child.kill('SIGKILL');
            assert.deepEqual(await closed, [null, 'SIGKILL']);
            await atomicJSON(path.join(root, 'crash.json'), { area, marker, signal: 'SIGKILL', stderr });
          } finally {
            child.kill('SIGKILL');
            await closed;
          }
          const store = new Store(path.join(root, 'experiment.sqlite'), spec);
          const hash = await treeDigest(seed);
          const buildName = `he-build-${digest([store.getMeta('experimentId'), hash]).slice(0, 32)}`;
          const buildBefore =
            area === 'candidates'
              ? null
              : await command('docker', ['inspect', '--format', '{{.Id}}', buildName]);
          const runBefore = store.runs()[0];
          const taskBefore =
            area === 'delivery'
              ? await command('docker', ['inspect', '--format', '{{.Id}}', runBefore!.container])
              : null;
          const lease = store.db.prepare('SELECT expires FROM lease WHERE id=1').get() as { expires: number };
          await delay(Math.max(0, lease.expires - Date.now()) + 50);
          const controller = new Controller(root, dataset, spec, store);
          try {
            await controller.start();
            assert.equal(store.candidates().length, 1);
            assert.equal(store.pendingSubmissions().length, 0);
            await controller.pump();
            const run = store.runs()[0]!;
            assert.equal(run.phase, 'scored');
            assert.equal(run.grade!.score, 1);
            assert.equal(run.attempt, 0);
            assert.equal(run.gradeAttempt, 0);
            assert.equal(store.candidates().length, 1);
            assert.equal(store.events().filter((e) => e.type === 'candidate.frozen').length, 1);
            assert.equal(store.events().filter((e) => e.type === 'candidate.submission_started').length, 1);
            assert.equal(await treeDigest(path.join(root, 'candidates', hash)), hash);
            const buildAfter = await command('docker', ['inspect', '--format', '{{.Id}}', buildName]);
            const taskAfter = await command('docker', ['inspect', '--format', '{{.Id}}', run.container]);
            if (buildBefore) assert.equal(buildAfter, buildBefore);
            if (taskBefore) assert.equal(taskAfter, taskBefore);
            const usage = JSON.parse(
              await readFile(path.join(root, 'runs', run.id, 'trace/metrics.json'), 'utf8'),
            );
            assert.equal(usage.started, 2);
            assert.equal(usage.results, 2);
            assert.equal(usage.unfinished, 0);
            await controller.pump();
            assert.equal(store.runs().length, 1);
            await atomicJSON(path.join(root, 'acceptance.json'), {
              area,
              buildBefore,
              buildAfter,
              taskBefore,
              taskAfter,
              run,
              usage,
              candidates: store.candidates().length,
              pendingSubmissions: store.pendingSubmissions().length,
            });
          } finally {
            await controller.close();
            store.close();
          }
        }),
      ),
    );
  },
);
