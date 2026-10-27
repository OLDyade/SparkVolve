import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, cp, readFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomBytes } from 'node:crypto';
import { specification } from '../fixtures.js';
import { treeDigest } from '../../src/artifacts.js';
import { Store } from '../../src/store.js';
import { Controller } from '../../src/controller.js';
import { serve } from '../../src/api.js';
import { optimize } from '../../src/optimizer.js';

test(
  'optimizer container mounts the native preset and concludes through the actual controller API',
  { timeout: 120_000 },
  async () => {
    const image = process.env.HE_TEST_IMAGE;
    assert.ok(image, 'HE_TEST_IMAGE must name an immutable runtime image');
    const root = await mkdtemp(path.join(os.tmpdir(), 'he-preset-container-'));
    console.log(`Optimizer preset evidence retained: ${root}`);
    const dataset = path.join(root, 'dataset');
    const environment = path.join(dataset, 'environment');
    await mkdir(environment, { recursive: true });
    await mkdir(path.join(root, 'drafts'));
    await cp('optimizers/evidence-driven', path.join(dataset, 'optimizer-bundle'), { recursive: true });
    await cp('tests/container/optimizer-provider.mjs', path.join(environment, 'provider.mjs'));
    await writeFile(
      path.join(environment, 'cordis.patch.yml'),
      '- insert:\n    - id: optimizer-fixture\n      name: ./provider.mjs\n',
    );
    const spec = specification();
    for (const task of spec.tasks) {
      await mkdir(path.join(dataset, task.input), { recursive: true });
      await mkdir(path.join(dataset, task.evaluation), { recursive: true });
      task.inputDigest = await treeDigest(path.join(dataset, task.input));
      task.evaluationDigest = await treeDigest(path.join(dataset, task.evaluation));
    }
    spec.runtime.image = image;
    spec.runtime.environment = {
      directory: 'environment',
      digest: await treeDigest(environment),
      patch: 'cordis.patch.yml',
    };
    spec.optimizer = {
      ...spec.optimizer,
      provider: 'optimizer-fixture',
      model: 'protocol',
      reasoningEffort: null,
    };
    spec.optimizerHarness.digest = await treeDigest(path.join(dataset, 'optimizer-bundle'));
    const token = randomBytes(32).toString('hex');
    await writeFile(path.join(root, 'controller-token'), token, { mode: 0o600 });
    const store = new Store(path.join(root, 'experiment.sqlite'), spec);
    const controller = new Controller(root, dataset, spec, store);
    await controller.start();
    const server = await serve(controller, token, 0, '0.0.0.0');
    let waits = 0;
    server.on('request', (req) => {
      if (req.url === '/events') {
        waits++;
        setTimeout(() => store.event('acceptance.wakeup', { source: 'host-commit' }), 50);
      }
    });
    try {
      const address = server.address();
      assert.ok(address && typeof address !== 'string');
      await optimize(root, spec, {
        endpoint: `http://host.docker.internal:${address.port}`,
        controlEndpoint: `http://127.0.0.1:${address.port}`,
      });
      assert.match(store.getMeta('searchConclusion')!, /Protocol lifecycle acceptance completed/);
      const summary = JSON.parse(await readFile(path.join(root, 'optimizer/summary.json'), 'utf8'));
      assert.equal(summary.reason, 'optimizer_concluded');
      assert.equal(summary.episodes, 1);
      const receipt = JSON.parse(await readFile(path.join(root, 'optimizer/0/trace/receipt.json'), 'utf8'));
      assert.equal(receipt.status, 'completed');
      const requests = (await readFile(path.join(root, 'optimizer/0/trace/model-requests.jsonl'), 'utf8'))
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
      assert.equal(requests.length, 4);
      assert.equal(waits, 1);
      assert.ok(JSON.stringify(requests[2].messages).includes('acceptance.wakeup'));
      assert.ok(requests[0].tools.some((t: { name: string }) => t.name === 'evolution_submit'));
      assert.ok(requests[0].tools.some((t: { name: string }) => t.name === 'bash'));
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await controller.close();
      store.close();
    }
  },
);
