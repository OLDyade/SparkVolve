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
  'independent container observations reject an infeasible seed and admit a feasible bundle',
  { timeout: 120_000 },
  async () => {
    const image = process.env.SPARKVOLVE_TEST_IMAGE;
    assert.ok(image, 'An explicit immutable image is required');
    const root = await mkdtemp(path.join(os.tmpdir(), 'he-constraints-'));
    console.log(`Constraint evidence retained: ${root}`);
    const dataset = path.join(root, 'dataset'),
      seed = path.join(root, 'seed');
    await mkdir(seed);
    await mkdir(path.join(dataset, 'input'), { recursive: true });
    await mkdir(path.join(dataset, 'private'), { recursive: true });
    await cp(new URL('./fixture.mjs', import.meta.url), path.join(seed, 'fixture.mjs'));
    await writeFile(
      path.join(seed, 'package.json'),
      JSON.stringify({
        name: '@sparkvolve/constraint-fixture',
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
        name: '@sparkvolve/constraint-fixture',
        version: '1.0.0',
        lockfileVersion: 3,
        packages: { '': { name: '@sparkvolve/constraint-fixture', version: '1.0.0' } },
      }),
    );
    await writeFile(path.join(seed, 'cordis.patch.yml'), '- insert:\n    - name: ./fixture.mjs\n');
    await writeFile(path.join(dataset, 'input/message.txt'), 'alpha');
    await writeFile(path.join(dataset, 'private/expected.txt'), 'ALPHA');
    await writeFile(
      path.join(dataset, 'private/grade.mjs'),
      `
import { readFile, writeFile } from 'node:fs/promises';
const actual = await readFile('/delivery/result.txt', 'utf8');
const expected = await readFile('/evaluation/expected.txt', 'utf8');
await writeFile('/workspace/result.json', JSON.stringify({
  score: Number(actual.trim() === expected),
  metrics: { newline: Number(actual.endsWith('\\n')) },
  feedback: 'The public text format requires a final newline.',
}));`,
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
          id: 'text',
          prompt: 'Uppercase input and terminate the text with a newline.',
          input: 'input',
          evaluation: 'private',
          inputDigest: await treeDigest(path.join(dataset, 'input')),
          evaluationDigest: await treeDigest(path.join(dataset, 'private')),
        },
      ],
      failureLimit: 0,
      timeoutSeconds: 60,
      evaluator: { image, command: ['node', '/evaluation/grade.mjs'], timeoutSeconds: 30 },
      candidate: {
        patch: 'cordis.patch.yml',
        build: { image, timeoutSeconds: 60 },
        qa: null,
      },
      constraints: [
        { id: 'text-format', metric: 'newline', aggregation: 'each', operator: 'gte', threshold: 1 },
      ],
    });
    const store = new Store(path.join(root, 'experiment.sqlite'), spec);
    const controller = new Controller(root, dataset, spec, store);
    try {
      await writeFile(path.join(root, 'experiment.json'), JSON.stringify(spec));
      await controller.start();
      const initial = await controller.seed(seed);
      await controller.pump();
      assert.equal(store.candidate(initial.digest).mean, 1);
      assert.equal(store.candidate(initial.digest).phase, 'rejected');
      assert.equal(store.getMeta('champion'), undefined);
      const initialDecision = store.decision(initial.digest) as { constraintsSatisfied: boolean };
      assert.equal(initialDecision.constraintsSatisfied, false);
      await controller.draft(initial.digest, 'newline');
      const implementation = path.join(root, 'drafts/newline/fixture.mjs');
      await writeFile(
        implementation,
        (await readFile(implementation, 'utf8')).replace(
          'input.toUpperCase()',
          "input.toUpperCase() + '\\n'",
        ),
      );
      const changed = await controller.submit({
        draft: 'newline',
        parents: [initial.digest],
        actions: ['tune'],
        evidence: ['Independent grader reported missing final newline'],
        hypothesis: 'Terminate generated text according to the public format contract',
        expectedChange: 'Preserve exact text score and satisfy newline constraint',
      });
      await controller.pump();
      assert.equal(store.candidate(changed.digest).mean, 1);
      assert.equal(store.getMeta('champion'), changed.digest);
      const changedDecision = store.decision(changed.digest) as { constraintsSatisfied: boolean };
      assert.equal(changedDecision.constraintsSatisfied, true);
      await writeFile(
        path.join(root, 'acceptance.json'),
        JSON.stringify({
          passed: true,
          initial: store.decision(initial.digest),
          changed: store.decision(changed.digest),
          boundary:
            'Deterministic native DSH protocol acceptance; not autonomous optimization or model quality evidence.',
        }),
      );
    } finally {
      await controller.close();
      store.close();
    }
  },
);
