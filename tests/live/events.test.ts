import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, cp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomBytes } from 'node:crypto';
import { containerSpecification as specification } from '../fixtures.js';
import { atomicJSON, treeDigest } from '../../src/artifacts.js';
import { Store } from '../../src/store.js';
import { Controller } from '../../src/controller.js';
import { serve } from '../../src/api.js';
import { optimize } from '../../src/optimizer.js';

// Explicitly opt-in, real-provider lifecycle acceptance. No score or improvement claim.
test(
  'real model waits for a committed host event through native DSH and concludes',
  { timeout: 240_000 },
  async () => {
    const image = process.env.HE_TEST_IMAGE;
    assert.ok(image, 'Set HE_TEST_IMAGE to an immutable runtime image');
    assert.ok(process.env.VENUS_API_KEY, 'Supply credentials with Node --env-file');
    const root = await mkdtemp(path.join(os.tmpdir(), 'he-live-events-'));
    console.log(`Live event acceptance retained: ${root}`);
    const dataset = path.join(root, 'dataset');
    await mkdir(dataset);
    await mkdir(path.join(root, 'drafts'));
    await cp('examples/venus', path.join(dataset, 'environment'), { recursive: true });
    await cp('optimizers/evidence-driven', path.join(dataset, 'optimizer-bundle'), { recursive: true });
    const spec = specification();
    spec.name = 'live-event-lifecycle-acceptance';
    spec.objective =
      'This is an event transport lifecycle acceptance, not a quality experiment. Do not branch, mutate, submit candidates or run tasks. Call evolution_status, then evolution_wait with its exact cursor. The host will commit acceptance.wakeup when you wait. Once that event is received, call evolution_finish and quote its nonce in the reason. End normally. No repeated status polling.';
    spec.runtime.image = image;
    spec.runtime.environment = {
      directory: 'environment',
      patch: 'cordis.patch.yml',
      digest: await treeDigest(path.join(dataset, 'environment')),
    };
    spec.optimizer = JSON.parse(await readFile('examples/venus/model.json', 'utf8'));
    spec.executor = spec.optimizer;
    spec.evaluator.image = image;
    spec.candidate.build.image = image;
    spec.budget.optimizerSeconds = 180;
    spec.optimizerHarness.digest = await treeDigest(path.join(dataset, 'optimizer-bundle'));
    for (const task of spec.tasks) {
      for (const directory of [task.input, task.evaluation])
        await mkdir(path.join(dataset, directory), { recursive: true });
      task.inputDigest = await treeDigest(path.join(dataset, task.input));
      task.evaluationDigest = await treeDigest(path.join(dataset, task.evaluation));
    }
    await atomicJSON(path.join(root, 'experiment.json'), spec);
    const token = randomBytes(32).toString('hex');
    await writeFile(path.join(root, 'controller-token'), token, { mode: 0o600 });
    const store = new Store(path.join(root, 'experiment.sqlite'), spec);
    const controller = new Controller(root, dataset, spec, store);
    await controller.start();
    const stop = new AbortController();
    const server = await serve(controller, token, 0, '0.0.0.0', stop.signal);
    const nonce = randomBytes(8).toString('hex');
    let waits = 0;
    server.on('request', (req) => {
      if (req.url === '/events') {
        waits++;
        setImmediate(() => store.event('acceptance.wakeup', { nonce }));
      }
    });
    try {
      const address = server.address();
      assert.ok(address && typeof address !== 'string');
      await optimize(
        root,
        spec,
        {
          endpoint: `http://host.docker.internal:${address.port}`,
          controlEndpoint: `http://127.0.0.1:${address.port}`,
        },
        controller.docker,
        stop.signal,
      );
      assert.ok(waits > 0);
      assert.ok(store.getMeta('searchConclusion')?.includes(nonce));
      assert.equal(store.candidates().length, 0);
      assert.equal(store.runs().length, 0);
      const summary = JSON.parse(await readFile(path.join(root, 'optimizer/summary.json'), 'utf8'));
      assert.equal(summary.reason, 'optimizer_concluded');
      await atomicJSON(path.join(root, 'acceptance.json'), {
        passed: true,
        waits,
        nonce,
        summary,
        evidenceBoundary: 'Real model lifecycle only; no task score or quality gain.',
      });
    } finally {
      stop.abort();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await controller.close();
      store.close();
    }
  },
);
