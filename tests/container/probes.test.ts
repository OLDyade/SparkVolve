import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, cp, writeFile, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../../src/store.js';
import { Controller } from '../../src/controller.js';
import { treeDigest } from '../../src/artifacts.js';
import { containerSpecification } from '../fixtures.js';
import { serve } from '../../src/api.js';

test(
  'native behavioral probes exercise real composed services and tools in isolated containers',
  { timeout: 180_000 },
  async () => {
    const image = process.env.HE_TEST_IMAGE;
    assert.ok(image, 'An explicit immutable image is required');
    const root = await mkdtemp(path.join(os.tmpdir(), 'he-native-probes-'));
    console.log(`Probe container evidence retained: ${root}`);
    const spec = containerSpecification();
    spec.runtime = { image, dshVersion: '0.2.1-rc.4', profile: 'sdk-minimal', environment: null };
    spec.candidate = { patch: 'cordis.patch.yml', build: { image, timeoutSeconds: 60 }, qa: null };
    spec.executor = {
      provider: 'container-fixture',
      model: 'fixture',
      reasoningEffort: 'off',
      maxTokens: 1024,
      credentialEnv: [],
    };
    spec.probes = { limit: 3, timeoutSeconds: 30 };
    for (const task of spec.tasks) {
      for (const dir of [task.input, task.evaluation])
        await mkdir(path.join(root, 'dataset', dir), { recursive: true });
      task.inputDigest = await treeDigest(path.join(root, 'dataset', task.input));
      task.evaluationDigest = await treeDigest(path.join(root, 'dataset', task.evaluation));
    }
    const draft = path.join(root, 'drafts/draft'),
      suite = path.join(root, 'drafts/checks');
    await mkdir(draft, { recursive: true });
    await mkdir(suite, { recursive: true });
    await cp(new URL('./fixture.mjs', import.meta.url), path.join(draft, 'fixture.mjs'));
    const pkg = {
      name: 'probe-fixture',
      version: '1.0.0',
      type: 'module',
      scripts: { build: 'node --check tool.mjs' },
      files: ['fixture.mjs', 'provider.mjs', 'tool.mjs', 'cordis.patch.yml'],
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
    await writeFile(
      path.join(draft, 'provider.mjs'),
      'export function apply(ctx) {ctx.provide("probeMath", {double:x=>2*x});}',
    );
    await writeFile(
      path.join(draft, 'tool.mjs'),
      `import {defineTool} from '@deepseek-ai/dsh-tools';
export const inject=['tools','probeMath'];
export function apply(ctx) {ctx.tools.register(defineTool({name:'probe_double',description:'Double a number',parameters:{value:{type:'number',required:true}},
output:{schema:{type:'number'},render:(_args,value)=>[{type:'text',text:String(value)}]}, execute:({value})=>ctx.probeMath.double(value)}));}`,
    );
    const patch =
      '- insert:\n    - name: ./fixture.mjs\n    - name: ./tool.mjs\n    - name: ./provider.mjs\n';
    await writeFile(path.join(draft, 'cordis.patch.yml'), patch);
    await writeFile(
      path.join(suite, 'probe.mjs'),
      `import assert from 'node:assert/strict'; import {access,writeFile} from 'node:fs/promises';
export async function probe({call,ctx,observe}) {
  for(const file of ['/evaluation','/input','/var/run/docker.sock']) await assert.rejects(access(file),{code:'ENOENT'});
  assert.equal(process.env.VENUS_API_KEY,undefined); assert.equal(process.env.EVOLUTION_TOKEN,undefined);
  await assert.rejects(writeFile('/candidate/injected','x'));
  const actual=ctx.get('probeMath').double(4);
  await observe('native service return', {input:4, actual});
  assert.equal(actual,8);
  const result=await call('probe_double',{value:4});
  assert.equal(result.isError,false); assert.equal(result.content[0].text,'8');
  const invalid=await call('probe_double',{value:'bad'}); assert.equal(invalid.isError,true);
}`,
    );
    const store = new Store(path.join(root, 'experiment.sqlite'), spec);
    let controller = new Controller(root, path.join(root, 'dataset'), spec, store);
    await controller.start();
    const server = await serve(controller, 'a'.repeat(64), 0, '127.0.0.1');
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const request = {
      draft: 'draft',
      suite: 'checks',
      entry: 'probe.mjs',
      hypothesis: 'Native service wiring supplies tool behavior and validates arguments',
    };
    try {
      const response = await fetch(`http://127.0.0.1:${address.port}/probe`, {
        method: 'POST',
        headers: { authorization: `Bearer ${'a'.repeat(64)}` },
        body: JSON.stringify(request),
      });
      assert.equal(response.status, 200);
      const first = (await response.json()) as { id: string };
      assert.throws(() => controller.finish('premature'), /pending probes/);
      await controller.pump();
      assert.equal(store.probes()[0]!.phase, 'passed');
      const observation = JSON.parse(
        await readFile(path.join(root, 'probes', first.id, 'work/native/behavior.json'), 'utf8'),
      );
      assert.equal(observation.observations.length, 3);
      assert.deepEqual(observation.observations[0], {
        sequence: 1,
        kind: 'value',
        label: 'native service return',
        value: { input: 4, actual: 8 },
      });
      assert.equal(observation.observations[2].result.isError, true);
      const evidence = await fetch(`http://127.0.0.1:${address.port}/probe-evidence`, {
        method: 'POST',
        headers: { authorization: `Bearer ${'a'.repeat(64)}` },
        body: JSON.stringify({ probe: first.id, area: 'observations', file: 'native/behavior.json' }),
      });
      assert.equal(evidence.status, 200);
      await assert.rejects(controller.probe(request), /Identical probe/);
      await writeFile(
        path.join(draft, 'provider.mjs'),
        'export function apply(ctx) {ctx.provide("probeMath", {double:x=>3*x});}',
      );
      const second = await controller.probe(request);
      await controller.pump();
      assert.equal(store.probes()[1]!.phase, 'failed');
      const refuted = JSON.parse(
        await readFile(path.join(root, 'probes', second.id, 'work/native/behavior.json'), 'utf8'),
      );
      assert.equal(refuted.status, 'failed');
      assert.equal(refuted.observations[0].value.actual, 12);
      assert.match(
        await readFile(path.join(root, 'probes', second.id, 'work/native/behavior.json'), 'utf8'),
        /12 !== 8/,
      );
      await writeFile(
        path.join(draft, 'cordis.patch.yml'),
        patch.replace('    - name: ./provider.mjs\n', ''),
      );
      const third = await controller.probe(request);
      await controller.pump();
      assert.equal(store.probes()[2]!.phase, 'failed');
      const broken = JSON.parse(
        await readFile(path.join(root, 'probes', third.id, 'work/native/composition.json'), 'utf8'),
      );
      assert.equal(broken.passed, false);
      assert.ok(broken.audit.pending.some((row: string) => row.includes('probeMath')));
      await controller.close();
      controller = new Controller(root, path.join(root, 'dataset'), spec, store);
      await controller.start();
      await controller.pump();
      assert.equal(store.events().filter((event) => event.type === 'probe.completed').length, 3);
      assert.deepEqual(store.candidates(), []);
      assert.deepEqual(store.runs(), []);
      assert.equal(store.getMeta('champion'), undefined);
      controller.finish('Probe integration acceptance complete; no quality claim');
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await controller.close();
      store.close();
    }
  },
);
