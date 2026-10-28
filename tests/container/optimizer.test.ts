import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, cp, readFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomBytes } from 'node:crypto';
import { containerSpecification as specification, candidate, runs } from '../fixtures.js';
import { treeDigest } from '../../src/artifacts.js';
import { Store } from '../../src/store.js';
import { Controller } from '../../src/controller.js';
import { serve } from '../../src/api.js';
import { optimize } from '../../src/optimizer.js';
import { command } from '../../src/docker.js';
import { prepareOptimizer, optimizerBundlePath } from '../../src/optimizer-harness.js';

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
    const binary = Buffer.from(Array.from({ length: 6643 }, (_, index) => index % 256));
    for (const task of spec.tasks) {
      await mkdir(path.join(dataset, task.input), { recursive: true });
      await mkdir(path.join(dataset, task.evaluation), { recursive: true });
      await writeFile(path.join(dataset, task.input, 'original.bin'), binary);
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
    spec.optimizerHarness.source.digest = await treeDigest(path.join(dataset, 'optimizer-bundle'));
    assert.equal(spec.optimizerHarness.kind, 'source');
    if (spec.optimizerHarness.kind === 'source') spec.optimizerHarness.build = { image, timeoutSeconds: 120 };
    const token = randomBytes(32).toString('hex');
    await writeFile(path.join(root, 'controller-token'), token, { mode: 0o600 });
    const store = new Store(path.join(root, 'experiment.sqlite'), spec);
    store.addCandidate({
      ...candidate(),
      phase: 'qa_failed',
      qaError: 'Protocol fixture only; no task executed',
    });
    store.addRuns([
      { ...runs()[0]!, id: 'e'.repeat(64), phase: 'cancelled', error: 'Protocol fixture only' },
    ]);
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
      const hostIP = (
        await command('docker', [
          'run',
          '--rm',
          '--network=bridge',
          '--add-host=host.docker.internal:host-gateway',
          image,
          'getent',
          'ahostsv4',
          'host.docker.internal',
        ])
      ).split(/\s+/)[0]!;
      await optimize(root, spec, {
        endpoint: `http://${hostIP}:${address.port}`,
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
      // Successful evolution_finish ends the native turn immediately; no extra
      // model request is allowed after the host commits the conclusion.
      assert.equal(requests.length, 4);
      assert.equal(waits, 1);
      assert.ok(JSON.stringify(requests[2].messages).includes('acceptance.wakeup'));
      assert.ok(requests[0].tools.some((t: { name: string }) => t.name === 'evolution_submit'));
      assert.ok(requests[0].tools.some((t: { name: string }) => t.name === 'bash'));
      assert.ok(requests[0].tools.some((t: { name: string }) => t.name === 'evolution_materialize'));
      assert.deepEqual(await readFile(path.join(root, 'drafts/observed.bin')), binary);
      const materialization = JSON.parse(
        await readFile(path.join(root, 'optimizer/0/trace/materialization.json'), 'utf8'),
      );
      assert.equal(materialization.bytes, binary.length);
      assert.equal(materialization.writeError, 'EROFS');
      assert.equal(materialization.sha256, materialization.observedSha256);
      assert.equal(materialization.reference.kind, 'run');
      const prepared = await prepareOptimizer(root, dataset, spec);
      assert.notEqual(optimizerBundlePath(root, prepared), path.join(dataset, 'optimizer-bundle'));
      const qa = JSON.parse(
        await readFile(path.join(root, 'optimizer-harness/qa/work/native/composition.json'), 'utf8'),
      );
      assert.equal(qa.passed, true);
      assert.ok(qa.tools.some((tool: { name: string }) => tool.name === 'evolution_submit'));
      assert.ok(qa.compositions.length > 0);
      const installation = JSON.parse(
        await readFile(path.join(optimizerBundlePath(root, prepared), 'package.json'), 'utf8'),
      );
      assert.equal(installation.dsh.bundle.patch, './cordis.patch.yml');
      assert.equal(prepared.composition, 'plugins.yml');
      const methodMount = JSON.parse(
        await readFile(path.join(root, 'optimizer/0/isolation-final.json'), 'utf8'),
      ).observed.mounts.find((mount: { Destination: string }) => mount.Destination === '/method');
      assert.equal(methodMount.RW, false);
      assert.equal(methodMount.Source, optimizerBundlePath(root, prepared));
      // Independent studies consume exactly this G artifact; each arm loads it without a new build.
      const reuse = path.join(root, 'artifact-consumer');
      const reused = await prepareOptimizer(reuse, root, {
        ...spec,
        runtime: {
          ...spec.runtime,
          environment: { ...spec.runtime.environment!, directory: 'dataset/environment' },
        },
        optimizerHarness: {
          kind: 'artifact',
          source: { directory: 'dataset/optimizer-bundle', digest: prepared.sourceDigest },
          composition: prepared.composition,
          artifact: {
            directory: `optimizer-harness/artifacts/${prepared.sourceDigest}`,
            identity: prepared.build,
          },
        },
      });
      assert.deepEqual(reused, prepared);
      await assert.rejects(
        readFile(
          path.join(reuse, 'optimizer-harness/builds', prepared.sourceDigest, 'execution-intent.json'),
        ),
        { code: 'ENOENT' },
      );
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await controller.close();
      store.close();
    }
  },
);
