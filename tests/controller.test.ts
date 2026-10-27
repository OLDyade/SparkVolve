import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile, chmod, rm, readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Controller } from '../src/controller.js';
import { Docker } from '../src/docker.js';
import type { ContainerSpec } from '../src/docker.js';
import { Store } from '../src/store.js';
import { treeDigest } from '../src/artifacts.js';
import { specification } from './fixtures.js';

const exited = {
  Status: 'exited',
  Running: false,
  ExitCode: 0,
  StartedAt: new Date().toISOString(),
  FinishedAt: new Date().toISOString(),
};
class LifecycleDriver extends Docker {
  executions = 0;
  grades = 0;
  failGrading = false;
  override async create(spec: ContainerSpec): Promise<void> {
    assert.equal(
      spec.mounts.some((m) => m.target === '/evaluation'),
      false,
    );
    this.executions++;
    const work = spec.mounts.find((m) => m.target === '/workspace')!;
    await writeFile(path.join(work.source, 'delivery.txt'), 'delivery');
  }
  override async collect(): Promise<typeof exited> {
    return exited;
  }
  override async run(spec: ContainerSpec): Promise<typeof exited> {
    if (spec.name.startsWith('he-qa-')) return exited;
    this.grades++;
    assert.equal(spec.network, 'none');
    assert.deepEqual(spec.env, {});
    assert.equal(spec.mounts.find((m) => m.target === '/delivery')!.writable, false);
    if (this.failGrading) return { ...exited, ExitCode: 1 };
    const output = spec.mounts.find((m) => m.target === '/workspace')!;
    await writeFile(
      path.join(output.source, 'result.json'),
      JSON.stringify({ score: 0.75, metrics: {}, feedback: 'fixture grade' }),
    );
    return exited;
  }
}
test('controller restarts, rescores preserved deliveries, and never reruns completed tasks', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'he-controller-'));
  const spec = specification();
  for (const task of spec.tasks) {
    for (const dir of [task.input, task.evaluation]) {
      await mkdir(path.join(root, 'dataset', dir), { recursive: true });
      await writeFile(path.join(root, 'dataset', dir, 'data.txt'), dir);
    }
    task.inputDigest = await treeDigest(path.join(root, 'dataset', task.input));
    task.evaluationDigest = await treeDigest(path.join(root, 'dataset', task.evaluation));
  }
  const seed = path.join(root, 'seed');
  await mkdir(seed);
  await writeFile(
    path.join(seed, 'package.json'),
    JSON.stringify({ name: 'fixture', dsh: { bundle: { patch: './cordis.patch.yml' } } }),
  );
  await writeFile(path.join(seed, 'cordis.patch.yml'), '[]');
  const driver = new LifecycleDriver();
  driver.failGrading = true;
  let store = new Store(path.join(root, 'state.sqlite'), spec);
  let controller = new Controller(root, path.join(root, 'dataset'), spec, store, driver);
  await controller.start();
  const initial = await controller.seed(seed);
  try {
    await controller.pump();
    assert.equal(driver.executions, 2);
    assert.equal(store.getMeta('champion'), undefined);
    assert.equal(store.runs().filter((r) => r.phase === 'scoring_failed').length, 2);
    await controller.close();
    store.close();
    store = new Store(path.join(root, 'state.sqlite'), spec);
    controller = new Controller(root, path.join(root, 'dataset'), spec, store, driver);
    await controller.start();
    driver.failGrading = false;
    for (const run of store.runs()) await controller.rescore(run.id);
    await controller.pump();
    assert.equal(store.getMeta('champion'), initial.digest);
    assert.equal(driver.executions, 2);
    assert.ok(store.runs().every((r) => r.gradeAttempt === 1 && r.attempt === 0));
    await assert.rejects(controller.submit(initial.proposal), /Identical candidate/);
  } finally {
    await controller.close();
    store.close();
    await chmod(path.join(root, 'candidates', initial.digest), 0o755);
    for (const run of await readdir(path.join(root, 'runs')))
      await chmod(path.join(root, 'runs', run, 'delivery'), 0o755);
    await rm(root, { recursive: true, force: true });
  }
});
