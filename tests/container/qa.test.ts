import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, cp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Experiment } from '../../src/contracts.js';
import { Controller } from '../../src/controller.js';
import { Store } from '../../src/store.js';
import { treeDigest } from '../../src/artifacts.js';
import { containerSpecification } from '../fixtures.js';

test(
  'explicit domain QA failure remains terminal after successful native assembly',
  { timeout: 120_000 },
  async () => {
    const image = process.env.SPARKVOLVE_TEST_IMAGE;
    assert.ok(image, 'An explicit immutable image is required');
    const root = await mkdtemp(path.join(os.tmpdir(), 'he-domain-qa-'));
    console.log(`Domain QA evidence retained: ${root}`);
    const seed = path.join(root, 'seed'),
      dataset = path.join(root, 'dataset');
    await mkdir(seed);
    await mkdir(path.join(dataset, 'input'), { recursive: true });
    await mkdir(path.join(dataset, 'private'), { recursive: true });
    await mkdir(path.join(dataset, 'verification'));
    await writeFile(
      path.join(dataset, 'verification/check.mjs'),
      `import assert from 'node:assert/strict';
import {readFile,writeFile,access} from 'node:fs/promises';
export async function probe({call}) {
  assert.equal(process.env.VENUS_API_KEY, undefined);
  await assert.rejects(access('/evaluation'));
  await assert.rejects(writeFile('/verification/changed','x'));
  const report=JSON.parse(await readFile('/workspace/native/composition.json','utf8'));
  assert.equal(report.passed,true);
  const unknown=await call('nonexistent_domain_tool',{});
  assert.equal(unknown.isError,true);
  throw new Error('Declared domain invariant failed');
}`,
    );
    await cp(new URL('./fixture.mjs', import.meta.url), path.join(seed, 'fixture.mjs'));
    const name = '@sparkvolve/domain-qa-fixture';
    await writeFile(
      path.join(seed, 'package.json'),
      JSON.stringify({
        name,
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
        name,
        version: '1.0.0',
        lockfileVersion: 3,
        packages: { '': { name, version: '1.0.0' } },
      }),
    );
    await writeFile(path.join(seed, 'cordis.patch.yml'), '- insert:\n    - name: ./fixture.mjs\n');
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
          id: 'qa',
          prompt: 'This task must never start.',
          input: 'input',
          inputDigest: await treeDigest(path.join(dataset, 'input')),
          evaluation: 'private',
          evaluationDigest: await treeDigest(path.join(dataset, 'private')),
        },
      ],
      failureLimit: 0,
      timeoutSeconds: 60,
      candidate: {
        patch: 'cordis.patch.yml',
        build: { image, timeoutSeconds: 60 },
        qa: {
          directory: 'verification',
          digest: await treeDigest(path.join(dataset, 'verification')),
          entry: 'check.mjs',
        },
      },
    });
    const store = new Store(path.join(root, 'experiment.sqlite'), spec);
    const controller = new Controller(root, dataset, spec, store);
    try {
      await controller.start();
      const candidate = await controller.seed(seed);
      await controller.pump();
      assert.equal(store.candidate(candidate.digest).phase, 'qa_failed');
      const behavior = JSON.parse(
        await readFile(path.join(root, 'qa', candidate.digest, 'work/native/behavior.json'), 'utf8'),
      );
      assert.equal(behavior.status, 'failed');
      assert.equal(behavior.observations[0].result.isError, true);
      assert.deepEqual(store.runs(), []);
      assert.equal(store.getMeta('champion'), undefined);
      const directory = path.join(root, 'qa', candidate.digest);
      assert.equal(
        JSON.parse(await readFile(path.join(directory, 'work/native/composition.json'), 'utf8')).passed,
        true,
      );
      assert.match(
        await readFile(path.join(directory, 'stderr.log'), 'utf8'),
        /Declared domain invariant failed/,
      );
      await controller.pump();
      assert.equal(store.candidate(candidate.digest).phase, 'qa_failed');
      assert.deepEqual(store.runs(), []);
      await writeFile(path.join(dataset, 'verification/check.mjs'), 'export async function probe() {}');
      const changed = new Controller(root, dataset, spec, store);
      await assert.rejects(changed.start(), /Domain QA digest mismatch/);
    } finally {
      await controller.close();
      store.close();
    }
  },
);
