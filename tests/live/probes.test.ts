import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, cp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomBytes } from 'node:crypto';
import { containerSpecification } from '../fixtures.js';
import { atomicJSON, treeDigest } from '../../src/artifacts.js';
import { Store } from '../../src/store.js';
import { Controller } from '../../src/controller.js';
import { serve } from '../../src/api.js';
import { optimize } from '../../src/optimizer.js';
import { configureLiveModel, liveControllerEndpoint, liveBudgets, liveTestTimeout } from './fixture.js';
import { experimentReport } from '../../src/report.js';

test(
  'real model authors and observes a native behavioral counterexample without scoring a task',
  { timeout: liveTestTimeout(true) },
  async () => {
    const image = process.env.HE_TEST_IMAGE;
    assert.ok(image);
    assert.ok(process.env.VENUS_API_KEY, 'Use Node --env-file');
    const root = await mkdtemp(path.join(os.tmpdir(), 'he-live-probes-'));
    console.log(`Live behavioral probe acceptance retained: ${root}`);
    const dataset = path.join(root, 'dataset'),
      draft = path.join(root, 'drafts/distance');
    await mkdir(dataset);
    await mkdir(draft, { recursive: true });
    await cp('examples/venus', path.join(dataset, 'environment'), { recursive: true });
    await cp('optimizers/evidence-driven', path.join(dataset, 'optimizer-bundle'), { recursive: true });
    const pkg = {
      name: 'distance-probe-acceptance',
      version: '1.0.0',
      type: 'module',
      scripts: { build: 'node --check index.mjs' },
      files: ['index.mjs', 'cordis.patch.yml'],
      dsh: { bundle: { patch: './cordis.patch.yml' } },
    };
    await writeFile(path.join(draft, 'package.json'), JSON.stringify(pkg));
    await writeFile(
      path.join(draft, 'package-lock.json'),
      JSON.stringify({
        name: pkg.name,
        version: pkg.version,
        lockfileVersion: 3,
        packages: { '': { name: pkg.name, version: pkg.version } },
      }),
    );
    await writeFile(path.join(draft, 'cordis.patch.yml'), '- insert:\n    - name: ./index.mjs\n');
    await writeFile(
      path.join(draft, 'index.mjs'),
      `import {defineTool} from '@deepseek-ai/dsh-tools';
export const inject=['tools'];
export function apply(ctx) {ctx.tools.register(defineTool({name:'number_distance',description:'Distance between two finite numbers on the real line',
parameters:{a:{type:'number',required:true},b:{type:'number',required:true}},output:{schema:{type:'number'},render:(_args,value)=>[{type:'text',text:String(value)}]},execute:({a,b})=>b-a}));}`,
    );
    const spec = containerSpecification();
    spec.name = 'live-behavioral-probe-acceptance';
    spec.objective =
      'This is an explicitly requested protocol integration acceptance, not a quality or optimization experiment. Existing draft /workspace/distance declares number_distance as the distance between finite real numbers. Inspect its source with normal native tools. Do not modify that draft, submit candidates, call models from suites or run benchmark tasks. Independently derive a mathematical boundary property, author a separate ES-module suite under /workspace, export async probe({agent,ctx,call,observe}), and use evolution_probe to test the existing draft through the real native tool pipeline. A native result contains isError and content. Before the boundary assertion, await observe(label,jsonValue) to persist the actual values obtained from the calls, choosing your own label and JSON structure. Use node:assert/strict so the original counterexample causes a failed probe, do not catch or erase the assertion. Wait via evolution_wait until probe.completed, inspect evolution_probe_evidence observations/native/behavior.json and original logs, then call evolution_finish quoting the probe ID and observed counterexample. Run exactly one probe. A retained failed assertion is the intended protocol outcome, not a task score.';
    spec.runtime = {
      image,
      dshVersion: '0.2.1-rc.4',
      profile: 'sdk',
      environment: null,
    };
    await configureLiveModel(dataset, spec);
    spec.evaluator.image = image;
    spec.candidate = { patch: 'cordis.patch.yml', build: { image, timeoutSeconds: 60 }, qa: null };
    spec.optimizerHarness.source.digest = await treeDigest(path.join(dataset, 'optimizer-bundle'));
    assert.equal(spec.optimizerHarness.kind, 'source');
    if (spec.optimizerHarness.kind === 'source') spec.optimizerHarness.build = { image, timeoutSeconds: 120 };
    spec.budget = {
      candidates: 1,
      optimizerSeconds:
        liveBudgets.optimizerSeconds + liveBudgets.probeBuildSeconds + liveBudgets.probeSeconds,
    };
    spec.probes = { limit: 1, timeoutSeconds: liveBudgets.probeSeconds };
    for (const task of spec.tasks) {
      for (const dir of [task.input, task.evaluation])
        await mkdir(path.join(dataset, dir), { recursive: true });
      task.inputDigest = await treeDigest(path.join(dataset, task.input));
      task.evaluationDigest = await treeDigest(path.join(dataset, task.evaluation));
    }
    await atomicJSON(path.join(root, 'experiment.json'), spec);
    const draftDigest = await treeDigest(draft),
      token = randomBytes(32).toString('hex');
    await writeFile(path.join(root, 'controller-token'), token, { mode: 0o600 });
    const store = new Store(path.join(root, 'experiment.sqlite'), spec),
      controller = new Controller(root, dataset, spec, store);
    await controller.start();
    const stop = new AbortController(),
      server = await serve(controller, token, 0, '0.0.0.0', stop.signal);
    const watching = controller.watch(stop.signal).catch((error) => {
      if (!stop.signal.aborted) throw error;
    });
    try {
      const address = server.address();
      assert.ok(address && typeof address !== 'string');
      await Promise.race([
        optimize(
          root,
          spec,
          {
            endpoint: liveControllerEndpoint(address.port),
          },
          controller.docker,
          stop.signal,
        ),
        watching,
      ]);
      assert.equal(store.probes().length, 1);
      const probe = store.probes()[0]!;
      assert.equal(probe.phase, 'failed');
      const behavior = JSON.parse(
        await readFile(path.join(root, 'probes', probe.id, 'work/native/behavior.json'), 'utf8'),
      );
      assert.equal(behavior.status, 'failed');
      assert.match(behavior.error, /AssertionError/);
      assert.ok(
        behavior.observations.some((observation: { name: string }) => observation.name === 'number_distance'),
      );
      assert.ok(
        behavior.observations.some((observation: { kind: string }) => observation.kind === 'value'),
        'The model-authored suite must record its actual values before the failing assertion',
      );
      assert.ok(store.getMeta('searchConclusion')?.includes(probe.id));
      assert.equal(await treeDigest(draft), draftDigest);
      assert.deepEqual(store.candidates(), []);
      assert.deepEqual(store.runs(), []);
      await atomicJSON(path.join(root, 'acceptance.json'), {
        passed: true,
        probe,
        behavior,
        boundary:
          'One real-model integration protocol; deliberately faulty synthetic plugin, no task scores or quality gain.',
      });
      await atomicJSON(path.join(root, 'report.json'), await experimentReport(root, store));
    } finally {
      stop.abort();
      await watching;
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await controller.close();
      store.close();
    }
  },
);
