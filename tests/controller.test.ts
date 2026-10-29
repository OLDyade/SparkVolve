import { containerIdentity } from '../src/isolation.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile, readFile, chmod, rm, readdir, cp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Controller } from '../src/controller.js';
import { Docker } from '../src/docker.js';
import type { ContainerSpec } from '../src/docker.js';
import { Store } from '../src/store.js';
import { treeDigest, fileDigest, atomicJSON } from '../src/artifacts.js';
import { specification } from './fixtures.js';
import { exportCandidate } from '../src/export.js';
import { ReclamationError } from '../src/execution.js';

const exited = {
  Status: 'exited',
  Running: false,
  ExitCode: 0,
  StartedAt: new Date().toISOString(),
  FinishedAt: new Date().toISOString(),
};
class LifecycleDriver extends Docker {
  override async executionReference(spec: ContainerSpec) {
    return { name: spec.name, id: spec.name, intent: containerIdentity(spec) };
  }
  override async inspect() {
    return exited;
  }
  override async halt() {}
  executions = 0;
  builds = 0;
  grades = 0;
  failGrading = false;
  override async create(spec: ContainerSpec): Promise<void> {
    assert.equal(
      spec.mounts.some((m) => m.target === '/evaluation'),
      false,
    );
    if (spec.name.startsWith('he-build-')) return;
    this.executions++;
    const work = spec.mounts.find((m) => m.target === '/workspace')!;
    await writeFile(path.join(work.source, 'delivery.txt'), 'delivery');
  }
  override async collect(spec: ContainerSpec): Promise<typeof exited> {
    if (spec.name.startsWith('he-build-')) return this.run(spec);
    return exited;
  }
  override async run(spec: ContainerSpec): Promise<typeof exited> {
    if (spec.name.startsWith('he-build-')) {
      this.builds++;
      const source = spec.mounts.find((m) => m.target === '/source')!.source;
      const output = path.join(spec.mounts.find((m) => m.target === '/workspace')!.source, 'output');
      await mkdir(output);
      await cp(source, path.join(output, 'bundle'), { recursive: true });
      await writeFile(path.join(output, 'bundle.tgz'), 'fixture archive');
      await atomicJSON(path.join(output, 'receipt.json'), {
        sourceDigest: await treeDigest(source),
        lockDigest: await fileDigest(path.join(source, 'package-lock.json')),
        bundleDigest: await treeDigest(path.join(output, 'bundle')),
        tarballDigest: await fileDigest(path.join(output, 'bundle.tgz')),
      });
      return exited;
    }
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

test('restricted mutation admission rejects out-of-scope source before consuming candidate budget', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'he-controller-scope-'));
  const spec = specification();
  spec.hostSearchProtocol = { ancestry: 'seed-only', feedback: 'full', editableFiles: ['guidance.md'] };
  for (const task of spec.tasks) {
    for (const folder of [task.input, task.evaluation])
      await mkdir(path.join(root, 'dataset', folder), { recursive: true });
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
  await writeFile(path.join(seed, 'package-lock.json'), '{}');
  await writeFile(path.join(seed, 'guidance.md'), 'original');
  const store = new Store(path.join(root, 'state.sqlite'), spec);
  const controller = new Controller(root, path.join(root, 'dataset'), spec, store, new LifecycleDriver());
  await controller.start();
  try {
    const initial = await controller.seed(seed);
    await controller.draft(initial.digest, 'bad');
    await writeFile(path.join(root, 'drafts/bad/cordis.patch.yml'), '# outside scope\n[]');
    await assert.rejects(
      controller.submit({ ...initial.proposal, draft: 'bad', parents: [initial.digest] }),
      /Mutation scope violation/,
    );
    assert.equal(store.candidates().length, 1);
    await controller.draft(initial.digest, 'good');
    await writeFile(path.join(root, 'drafts/good/guidance.md'), 'changed');
    await controller.submit({ ...initial.proposal, draft: 'good', parents: [initial.digest] });
    assert.equal(store.candidates().length, 2);
  } finally {
    await controller.close();
    store.close();
  }
});

test('controller resumes failed resource cleanup before declaring terminal failure, without rerunning', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'he-controller-failed-cleanup-'));
  const spec = specification();
  spec.tasks = spec.tasks.slice(0, 1);
  spec.isolation.network.executor = 'controlled';
  for (const task of spec.tasks) {
    for (const directory of [task.input, task.evaluation]) {
      await mkdir(path.join(root, 'dataset', directory), { recursive: true });
      await writeFile(path.join(root, 'dataset', directory, 'data.txt'), directory);
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
  await writeFile(path.join(seed, 'package-lock.json'), '{}');
  class FailedExecution extends LifecycleDriver {
    collections = 0;
    override async collect(spec: ContainerSpec): Promise<typeof exited> {
      if (spec.name.startsWith('he-build-')) return this.run(spec);
      this.collections++;
      throw Error('original task failed');
    }
  }
  const driver = new FailedExecution();
  let cleanups = 0;
  const egress = () => ({
    prepare: async () => {},
    verify: async () => {},
    candidateNetwork: async () => 'none' as const,
    stop: async () => {},
    release: async () => {},
    abort: async (worker?: ContainerSpec) => {
      assert.ok(worker, 'Cleanup must recover the persisted worker contract');
      if (++cleanups === 1) throw Error('cleanup interrupted');
    },
  });
  const store = new Store(path.join(root, 'state.sqlite'), spec);
  let controller = new Controller(root, path.join(root, 'dataset'), spec, store, driver, egress);
  try {
    await controller.start();
    await controller.seed(seed);
    await assert.rejects(
      controller.pump(),
      (error) =>
        error instanceof AggregateError &&
        error.errors.length === 1 &&
        error.errors[0] instanceof ReclamationError,
    );
    assert.equal(store.runs()[0]!.phase, 'executing');
    await controller.close();
    controller = new Controller(root, path.join(root, 'dataset'), spec, store, driver, egress);
    await controller.start();
    await controller.pump();
    assert.equal(store.runs()[0]!.phase, 'execution_failed');
    assert.match(store.runs()[0]!.error!, /original task failed/);
    assert.equal(cleanups, 2);
    assert.equal(driver.executions, 1);
    assert.equal(driver.collections, 1);
    await controller.pump();
    assert.equal(driver.executions, 1);
    assert.equal(cleanups, 2);
  } finally {
    await controller.close();
    store.close();
  }
});
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
  await writeFile(path.join(seed, 'package-lock.json'), '{}');
  const driver = new LifecycleDriver();
  driver.failGrading = true;
  let store = new Store(path.join(root, 'state.sqlite'), spec);
  let controller = new Controller(root, path.join(root, 'dataset'), spec, store, driver);
  await controller.start();
  const initial = await controller.seed(seed);
  try {
    await controller.pump();
    assert.equal(driver.executions, 2);
    assert.equal(driver.builds, 1);
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
    assert.equal((await controller.submit(initial.proposal)).digest, initial.digest);
    assert.equal(driver.executions, 2, 'Replayed submission must not resample the candidate');
    await assert.rejects(
      controller.submit({ ...initial.proposal, hypothesis: 'different request' }),
      /Identical candidate/,
    );
    const abort = new AbortController();
    const stopped = new Error('watch acceptance completed');
    const watching = controller.watch(abort.signal);
    // Submit after the watch has started; it must schedule the new candidate without a polling tick.
    await controller.draft(initial.digest, 'changed');
    await writeFile(path.join(root, 'drafts/changed/cordis.patch.yml'), '# changed composition\n[]');
    const cursor = store.cursor();
    const changed = await controller.submit({
      ...initial.proposal,
      draft: 'changed',
      parents: [initial.digest],
    });
    let page = await store.wait(cursor);
    while (!page.events.some((event) => event.type === 'candidate.decision'))
      page = await store.wait(page.cursor);
    assert.equal(store.candidate(changed.digest).phase, 'rejected');
    assert.equal(driver.executions, 4);
    assert.equal(driver.builds, 2);
    abort.abort(stopped);
    await assert.rejects(watching, (error) => error === stopped);
    await controller.pump();
    assert.equal(driver.executions, 4);
  } finally {
    await controller.close();
    store.close();
    const writable = async (dir: string): Promise<void> => {
      await chmod(dir, 0o755);
      for (const item of await readdir(dir, { withFileTypes: true }))
        if (item.isDirectory()) await writable(path.join(dir, item.name));
    };
    await writable(root);
    await rm(root, { recursive: true, force: true });
  }
});

test('build failure is terminal, retains evidence, consumes candidate budget and never enters QA or tasks', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'he-build-failure-'));
  const spec = specification();
  for (const task of spec.tasks) {
    for (const folder of [task.input, task.evaluation])
      await mkdir(path.join(root, 'dataset', folder), { recursive: true });
    task.inputDigest = await treeDigest(path.join(root, 'dataset', task.input));
    task.evaluationDigest = await treeDigest(path.join(root, 'dataset', task.evaluation));
  }
  const seed = path.join(root, 'seed');
  await mkdir(seed);
  await writeFile(
    path.join(seed, 'package.json'),
    JSON.stringify({
      name: 'failure',
      scripts: { build: 'exit 7' },
      dsh: { bundle: { patch: './cordis.patch.yml' } },
    }),
  );
  await writeFile(path.join(seed, 'package-lock.json'), '{}');
  await writeFile(path.join(seed, 'cordis.patch.yml'), '[]');
  class FailedBuilder extends Docker {
    override async executionReference(spec: ContainerSpec) {
      return { name: spec.name, id: spec.name, intent: containerIdentity(spec) };
    }
    calls = 0;
    override async create() {}
    override async inspect() {
      return exited;
    }
    override async collect(spec: ContainerSpec, logDir: string) {
      return this.run(spec, logDir);
    }
    override async run(spec: ContainerSpec, logDir: string) {
      assert.ok(spec.name.startsWith('he-build-'));
      this.calls++;
      await mkdir(logDir, { recursive: true });
      assert.equal(
        spec.mounts.some((mount) => ['/input', '/evaluation', '/var/run/docker.sock'].includes(mount.target)),
        false,
      );
      await writeFile(path.join(logDir, 'stderr.log'), 'compile failure');
      return { ...exited, ExitCode: 7 };
    }
  }
  const driver = new FailedBuilder(),
    store = new Store(path.join(root, 'state.sqlite'), spec);
  const controller = new Controller(root, path.join(root, 'dataset'), spec, store, driver);
  await controller.start();
  try {
    const record = await controller.seed(seed);
    await controller.pump();
    await controller.pump();
    assert.equal(driver.calls, 1);
    assert.equal(store.candidate(record.digest).phase, 'build_failed');
    assert.equal(store.candidates().length, 1);
    assert.deepEqual(store.runs(), []);
    assert.equal(store.getMeta('champion'), undefined);
    const report = JSON.parse(await readFile(path.join(root, 'reports', `${record.digest}.json`), 'utf8'));
    assert.equal(report.decision, null);
    await exportCandidate(root, store, record.digest, path.join(root, 'archive'));
    assert.equal((await readdir(path.join(root, 'archive'))).includes('bundle.tgz'), false);
  } finally {
    await controller.close();
    store.close();
  }
});
