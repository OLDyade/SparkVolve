import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { Controller } from '../../src/controller.js';
import { Store } from '../../src/store.js';
import { prepareCapabilities } from '../../src/capabilities.js';
import { treeDigest, fileDigest } from '../../src/artifacts.js';
import { exportCandidate } from '../../src/export.js';
import { containerSpecification } from '../fixtures.js';

async function bundle(directory: string, name: string, code: string) {
  await mkdir(directory, { recursive: true });
  const manifest = {
    name,
    version: '1.0.0',
    type: 'module',
    scripts: { build: 'node --check index.mjs' },
    files: ['index.mjs', 'cordis.patch.yml'],
    dsh: { bundle: { patch: './cordis.patch.yml' } },
  };
  await writeFile(path.join(directory, 'package.json'), JSON.stringify(manifest));
  await writeFile(
    path.join(directory, 'package-lock.json'),
    JSON.stringify({
      name,
      version: '1.0.0',
      lockfileVersion: 3,
      packages: { '': { name, version: '1.0.0' } },
    }),
  );
  await writeFile(path.join(directory, 'index.mjs'), code);
  await writeFile(
    path.join(directory, 'cordis.patch.yml'),
    '- insert:\n    - id: ' + name.replaceAll('/', '-').replaceAll('@', '') + '\n      name: ./index.mjs\n',
  );
}

test(
  'native isolated resolution composes dependencies, evaluates actual delivery and ships the original package',
  { timeout: 600_000 },
  async () => {
    const image = process.env.SPARKVOLVE_TEST_IMAGE;
    assert.ok(image, 'Explicit SPARKVOLVE_TEST_IMAGE required');
    const root = await mkdtemp(path.join(os.tmpdir(), 'sv-resolution-'));
    console.log('Capability resolution evidence: ' + root);
    const dataset = path.join(root, 'dataset');
    await mkdir(dataset);
    const source = await readFile(new URL('./fixture.mjs', import.meta.url), 'utf8');
    await bundle(
      path.join(root, 'seed'),
      '@sparkvolve-fixture/seed',
      source.replace(
        'input.toUpperCase()',
        "(ctx.get('candidateTransform') ? ctx.get('candidateTransform')(input) : input)",
      ),
    );
    await bundle(
      path.join(root, 'provider'),
      '@sparkvolve-fixture/provider',
      'export function apply(ctx){ctx.provide("candidateTransform", value=>value.toUpperCase());}',
    );
    await bundle(
      path.join(root, 'consumer'),
      '@sparkvolve-fixture/consumer',
      'export const inject=["candidateTransform"]; export function apply(ctx){if(ctx.candidateTransform("dependency")!=="DEPENDENCY")throw Error("Invalid dependency binding");}',
    );
    const catalog = await prepareCapabilities(
      {
        official: false,
        indexes: [],
        local: ['provider', 'consumer'],
        archives: [],
        registry: 'https://registry.npmjs.org',
        timeoutSeconds: 60,
      },
      root,
      path.join(dataset, 'capabilities'),
    );
    const spec = containerSpecification();
    spec.runtime = { image, dshVersion: '0.2.1-rc.4', profile: 'sdk-minimal', environment: null };
    spec.executor = {
      provider: 'container-fixture',
      model: 'fixture',
      reasoningEffort: 'off',
      maxTokens: 1024,
      credentialEnv: [],
    };
    spec.candidate = { patch: 'cordis.patch.yml', build: { image, timeoutSeconds: 600 }, qa: null };
    spec.evaluator = { image, command: ['node', '/evaluation/grade.mjs'], timeoutSeconds: 60 };
    spec.isolation.network.build = 'bridge';
    spec.timeoutSeconds = 600;
    spec.capabilities = { directory: 'capabilities', digest: catalog.digest, resolutionLimit: 3 };
    spec.tasks = [];
    for (const id of ['alpha', 'beta']) {
      await mkdir(path.join(dataset, 'inputs', id), { recursive: true });
      await mkdir(path.join(dataset, 'private', id), { recursive: true });
      await writeFile(path.join(dataset, 'inputs', id, 'message.txt'), id);
      await writeFile(
        path.join(dataset, 'private', id, 'grade.mjs'),
        'import{readFile,writeFile}from"node:fs/promises";const actual=await readFile("/delivery/result.txt","utf8");await writeFile("/workspace/result.json",JSON.stringify({score:Number(actual===' +
          JSON.stringify(id.toUpperCase()) +
          '),metrics:{},feedback:"Exact delivery comparison"}));',
      );
      spec.tasks.push({
        id,
        prompt: 'Call fixture_deliver.',
        input: 'inputs/' + id,
        inputDigest: await treeDigest(path.join(dataset, 'inputs', id)),
        evaluation: 'private/' + id,
        evaluationDigest: await treeDigest(path.join(dataset, 'private', id)),
      });
    }
    const store = new Store(path.join(root, 'experiment.sqlite'), spec);
    const controller = new Controller(root, dataset, spec, store);
    try {
      await controller.start();
      const seed = await controller.seed(path.join(root, 'seed'));
      await controller.pump();
      assert.equal(store.candidate(seed.digest).mean, 0, JSON.stringify(store.candidate(seed.digest)));
      const discovered = await controller.discover();
      // Consumer precedes provider: Cordis must bind services independently of textual order.
      const ids = ['@sparkvolve-fixture/consumer', '@sparkvolve-fixture/provider'].map(
        (name) => discovered.entries.find((item) => item.name === name)!.id,
      );
      const queued = await controller.resolve({
        parent: seed.digest,
        draft: 'composed',
        capabilities: ids,
        rationale: 'Exercise real native service composition',
      });
      await controller.pump();
      const resolution = controller.resolution(queued.id);
      assert.equal(resolution.phase, 'resolved', JSON.stringify(resolution));
      const draft = path.join(root, 'drafts/composed');
      const receipt = JSON.parse(await readFile(path.join(draft, 'capability-resolution.json'), 'utf8'));
      assert.deepEqual(
        receipt.records.map((r: any) => r.capability.id),
        ids,
      );
      assert.match(receipt.patches[0], /consumer/);
      // The published draft supports continued adaptation, including new files in frozen subdirectories.
      await writeFile(path.join(draft, 'vendor/adaptation.txt'), 'Independent editable draft');
      await assert.rejects(
        controller.submit({
          draft: 'composed',
          parents: ['0'.repeat(64)],
          actions: ['compose'],
          evidence: [queued.id],
          hypothesis: 'Misattributed resolved source',
          expectedChange: 'Rejected',
        }),
        /must retain its recorded parent/,
      );
      const current = await controller.submit({
        draft: 'composed',
        parents: [seed.digest],
        actions: ['compose'],
        evidence: [queued.id],
        hypothesis: 'Resolved service transforms the delivery',
        expectedChange: 'Exact uppercase public input',
      });
      await controller.pump();
      assert.equal(store.candidate(current.digest).mean, 1, JSON.stringify(store.candidate(current.digest)));
      const native = JSON.parse(
        await readFile(path.join(root, 'qa', current.digest, 'work/native/harness-inventory.json'), 'utf8'),
      );
      assert.ok(native.bindings.some((binding: any) => binding.service === 'candidateTransform'));
      const report = JSON.parse(await readFile(path.join(root, 'reports', current.digest + '.json'), 'utf8'));
      assert.ok(report.mutation.parents[0].changes.some((file: any) => file.path.startsWith('vendor/')));
      const archive = path.join(root, 'export');
      await exportCandidate(root, store, current.digest, archive);
      assert.equal(
        await fileDigest(path.join(archive, 'bundle.tgz')),
        store.candidate(current.digest).build!.tarballDigest,
      );
      const work = path.join(root, 'installed');
      await mkdir(work);
      const program = path.join(root, 'install.mjs');
      await writeFile(
        program,
        [
          "import{writeFile}from'node:fs/promises';import{command}from'/app/dist/command.js';import{initializeRuntimeEnvironment}from'/app/dist/runtime-environment.js';import{initProfile,loadProfileDirectory}from'/app/node_modules/@deepseek-ai/dsh-app-boot/lib/index.js';import{checkComposition}from'/app/dist/composition.js';",
          "await initializeRuntimeEnvironment();process.env.DSH_HOME='/workspace/dsh';initProfile('/workspace/dsh/profiles/reuse',[]);await command('dsh',['plugin','--profile','reuse','add','/bundle.tgz','--ignore-scripts'],{timeoutMs:600000});",
          "const loaded=loadProfileDirectory('dsh','/workspace/dsh/profiles/reuse','/app/node_modules/@deepseek-ai/dsh/package.json');if(loaded.skippedBundles.length)throw Error('Skipped installed bundle');",
          "await writeFile('/workspace/probe.mjs'," +
            JSON.stringify(
              'export async function probe({ctx}) {if(ctx.get("candidateTransform")("reused")!=="REUSED")throw Error("Installed service failed");}',
            ) +
            ');',
          "await checkComposition({profile:'sdk-minimal',model:" +
            JSON.stringify(spec.executor) +
            ",patches:loaded.layers.flatMap(layer=>layer.patchPaths),directory:'/workspace/qa',processCwd:'/app',workspace:'/workspace',timeoutSeconds:600,behaviorModule:'/workspace/probe.mjs'});",
          "await writeFile('/workspace/reuse.json',JSON.stringify({passed:true,layers:loaded.layers.map(layer=>({package:layer.packageName,patches:layer.patchPaths}))}));",
        ].join('\n'),
      );
      const result = await controller.docker.run(
        {
          name: 'sv-reuse-' + Date.now(),
          image,
          command: ['node', '/install.mjs'],
          mounts: [
            { source: program, target: '/install.mjs', writable: false },
            { source: path.join(archive, 'bundle.tgz'), target: '/bundle.tgz', writable: false },
            { source: work, target: '/workspace', writable: true },
          ],
          env: {},
          network: 'bridge',
          isolation: spec.isolation,
          timeoutSeconds: 600,
        },
        path.join(root, 'install-log'),
      );
      assert.equal(result.ExitCode, 0, await readFile(path.join(root, 'install-log/stderr.log'), 'utf8'));
      assert.equal(JSON.parse(await readFile(path.join(work, 'reuse.json'), 'utf8')).passed, true);
    } finally {
      await controller.close();
      store.close();
    }
  },
);
