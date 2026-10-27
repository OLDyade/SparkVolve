import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, cp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomBytes } from 'node:crypto';
import { containerSpecification as specification } from '../fixtures.js';
import { libraryFixture } from '../library-fixture.js';
import { atomicJSON, treeDigest } from '../../src/artifacts.js';
import { Store } from '../../src/store.js';
import { Controller } from '../../src/controller.js';
import { serve } from '../../src/api.js';
import { optimize } from '../../src/optimizer.js';
import { configureLiveModel, liveControllerEndpoint } from './fixture.js';

test(
  'real model selects, inspects and imports an authorized negative research asset',
  { timeout: 240_000 },
  async () => {
    const image = process.env.HE_TEST_IMAGE;
    assert.ok(image, 'Set HE_TEST_IMAGE to an immutable runtime image');
    assert.ok(process.env.VENUS_API_KEY, 'Supply credentials using Node --env-file');
    const root = await mkdtemp(path.join(os.tmpdir(), 'he-live-library-'));
    console.log(`Live library acceptance retained: ${root}`);
    const dataset = path.join(root, 'dataset');
    await mkdir(dataset);
    await mkdir(path.join(root, 'drafts'));
    await cp('examples/venus', path.join(dataset, 'environment'), { recursive: true });
    await cp('optimizers/evidence-driven', path.join(dataset, 'optimizer-bundle'), { recursive: true });
    const relevant = await libraryFixture(
      path.join(dataset, 'library'),
      'Evidence-oriented research method: inspect original task evidence before proposing plugin changes. Synthetic prior QA failure; adapt before evaluating.',
    );
    await libraryFixture(
      path.join(dataset, 'library'),
      'Unrelated image thumbnail resizing research. Synthetic prior QA failure.',
    );
    const spec = specification();
    spec.name = 'live-research-library-acceptance';
    spec.objective =
      'This is a research-library product acceptance, not a benchmark or quality search. Find the prior evidence-oriented research-method asset in the authorized library. Inspect its research record and original implementation source using native evolution tools, explain the prior failure limitation, and import the relevant source as one editable draft whose name you choose. Do not import the unrelated image-thumbnail asset. Do not submit candidates or execute evaluation tasks. Finally call evolution_finish with the chosen archive ID and an explicit statement that old scores were not imported. Choose your own retrieval query and tool sequence.';
    spec.runtime.image = image;
    spec.researchLibrary = { directory: 'library', digest: await treeDigest(path.join(dataset, 'library')) };
    await configureLiveModel(dataset, spec);
    spec.evaluator.image = image;
    spec.candidate.build.image = image;
    spec.budget.optimizerSeconds = 180;
    spec.optimizerHarness.source.digest = await treeDigest(path.join(dataset, 'optimizer-bundle'));
    assert.equal(spec.optimizerHarness.kind, 'source');
    if (spec.optimizerHarness.kind === 'source') spec.optimizerHarness.build = { image, timeoutSeconds: 120 };
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
    const routes: string[] = [];
    server.on('request', (req) => routes.push(req.url!));
    try {
      const address = server.address();
      assert.ok(address && typeof address !== 'string');
      await optimize(
        root,
        spec,
        {
          endpoint: liveControllerEndpoint(address.port),
          controlEndpoint: `http://127.0.0.1:${address.port}`,
        },
        controller.docker,
        stop.signal,
      );
      assert.ok(routes.includes('/library'));
      assert.ok(routes.includes('/asset'));
      assert.ok(routes.includes('/import'));
      const calls = (await readFile(path.join(root, 'optimizer/0/trace/notifications.jsonl'), 'utf8'))
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line))
        .filter((notification) => notification.params?.event?.type === 'tool/call')
        .map((notification) => notification.params.event.data);
      assert.ok(
        calls.some(
          (call) =>
            call.name === 'evolution_asset' &&
            JSON.parse(call.arguments).archive === relevant.archiveId &&
            JSON.parse(call.arguments).file === 'index.mjs',
        ),
      );
      const imports = store.events().filter((event) => event.type === 'draft.imported');
      assert.equal(imports.length, 1);
      const imported = imports[0]!.body as {
        draft: string;
        archiveId: string;
        sourceCandidate: string;
        recordDigest: string;
      };
      assert.equal(imported.archiveId, relevant.archiveId);
      assert.equal(imported.recordDigest, relevant.recordDigest);
      assert.equal(await treeDigest(path.join(root, 'drafts', imported.draft)), relevant.sourceCandidate);
      assert.equal(store.candidates().length, 0);
      assert.equal(store.runs().length, 0);
      assert.equal(store.getMeta('champion'), undefined);
      assert.ok(store.getMeta('searchConclusion')?.includes(relevant.archiveId));
      const summary = JSON.parse(await readFile(path.join(root, 'optimizer/summary.json'), 'utf8'));
      await atomicJSON(path.join(root, 'acceptance.json'), {
        passed: true,
        routes,
        imported,
        summary,
        evidenceBoundary: 'Real model retrieval and import only; synthetic archives, no quality gain.',
      });
    } finally {
      stop.abort();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await controller.close();
      store.close();
    }
  },
);
