import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Controller } from '../src/controller.js';
import { Store } from '../src/store.js';
import { treeDigest, digest } from '../src/artifacts.js';
import { specification, candidate } from './fixtures.js';

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'he-submission-'));
  const spec = specification();
  spec.budget.candidates = 1;
  for (const task of spec.tasks) {
    for (const dir of [task.input, task.evaluation])
      await mkdir(path.join(root, 'dataset', dir), { recursive: true });
    task.inputDigest = await treeDigest(path.join(root, 'dataset', task.input));
    task.evaluationDigest = await treeDigest(path.join(root, 'dataset', task.evaluation));
  }
  const source = path.join(root, 'drafts/draft');
  await mkdir(source, { recursive: true });
  await writeFile(
    path.join(source, 'package.json'),
    JSON.stringify({ name: 'submission', dsh: { bundle: { patch: './cordis.patch.yml' } } }),
  );
  await writeFile(path.join(source, 'package-lock.json'), '{}');
  await writeFile(path.join(source, 'cordis.patch.yml'), '[]');
  return { root, spec, source };
}

test('pending submissions resume on startup; lost responses replay the original candidate without new budget', async (t) => {
  for (const point of ['reserved', 'published', 'registered'])
    await t.test(point, async () => {
      const { root, spec, source } = await fixture();
      const proposal = candidate().proposal,
        hash = await treeDigest(source);
      let store = new Store(path.join(root, 'experiment.sqlite'), spec);
      let controller = new Controller(root, path.join(root, 'dataset'), spec, store);
      await controller.start();
      if (point === 'reserved') store.reserveSubmission({ digest: hash, proposal, phase: 'frozen' });
      else {
        const commit = store.commitSubmission.bind(store);
        store.commitSubmission = (id) => {
          if (point === 'registered') commit(id);
          throw new Error('injected process interruption');
        };
        await assert.rejects(controller.submit(proposal), /injected process interruption/);
      }
      await controller.close();
      store.close();
      store = new Store(path.join(root, 'experiment.sqlite'), spec);
      controller = new Controller(root, path.join(root, 'dataset'), spec, store);
      try {
        await controller.start();
        assert.equal(store.pendingSubmissions().length, 0);
        assert.equal(store.candidates().length, 1);
        const original = store.candidate(hash);
        assert.deepEqual(await controller.submit(proposal), original);
        assert.deepEqual(store.reserveSubmission({ digest: hash, proposal, phase: 'frozen' }), original);
        await assert.rejects(
          controller.submit({ ...proposal, hypothesis: 'changed request' }),
          /Identical candidate/,
        );
        assert.equal(store.events().filter((e) => e.type === 'candidate.frozen').length, 1);
        assert.equal(store.events().filter((e) => e.type === 'candidate.submission_started').length, 1);
        assert.deepEqual(store.runs(), []);
        store.setMeta('searchConclusion', JSON.stringify({ reason: 'completed' }));
        assert.deepEqual(await controller.submit(proposal), original);
        await writeFile(path.join(source, 'new-plugin.mjs'), 'export default {};');
        await assert.rejects(controller.submit(proposal), /Search has concluded/);
      } finally {
        await controller.close();
        store.close();
      }
    });
});

test('concurrent identical submissions consume one slot; changed pending source fails and releases startup lease', async () => {
  const { root, spec } = await fixture();
  const store = new Store(path.join(root, 'experiment.sqlite'), spec),
    proposal = candidate().proposal;
  let controller = new Controller(root, path.join(root, 'dataset'), spec, store);
  await controller.start();
  const results = await Promise.all(Array.from({ length: 12 }, () => controller.submit(proposal)));
  assert.equal(new Set(results.map(digest)).size, 1);
  assert.equal(store.candidates().length, 1);
  assert.equal(store.events().filter((e) => e.type === 'candidate.frozen').length, 1);
  await controller.close();
  store.close();

  const next = await fixture();
  const interrupted = new Store(path.join(next.root, 'experiment.sqlite'), next.spec);
  interrupted.reserveSubmission({ digest: await treeDigest(next.source), proposal, phase: 'frozen' });
  await writeFile(path.join(next.source, 'cordis.patch.yml'), '# changed\n[]');
  controller = new Controller(next.root, path.join(next.root, 'dataset'), next.spec, interrupted);
  await assert.rejects(controller.start(), /Pending candidate source changed/);
  assert.equal(interrupted.pendingSubmissions().length, 1);
  assert.equal(interrupted.candidates().length, 0);
  assert.equal(interrupted.db.prepare('SELECT * FROM lease').get(), undefined);
  interrupted.close();
});
