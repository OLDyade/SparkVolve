import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, chmod, readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { specification } from './fixtures.js';
import { treeDigest } from '../src/artifacts.js';
import { Docker, type ContainerSpec } from '../src/docker.js';
import { validateStudy } from '../src/validation.js';

test('paired validation freezes all arms, preserves repetitions and resumes without new executions', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'he-study-'));
  const spec = {
    ...specification(),
    purpose: 'validation' as const,
    repetitions: 2,
    budget: { candidates: 1, optimizerSeconds: 60 },
  };
  const dataset = path.join(root, 'dataset');
  for (const task of spec.tasks) {
    for (const dir of [task.input, task.evaluation]) {
      await mkdir(path.join(dataset, dir), { recursive: true });
      await writeFile(path.join(dataset, dir, 'data.txt'), task.id);
    }
    task.inputDigest = await treeDigest(path.join(dataset, task.input));
    task.evaluationDigest = await treeDigest(path.join(dataset, task.evaluation));
  }
  const arms = [];
  for (const [id, score] of [
    ['baseline', 0.25],
    ['candidate', 0.75],
  ] as const) {
    const bundle = path.join(root, id);
    await mkdir(bundle);
    await writeFile(
      path.join(bundle, 'package.json'),
      JSON.stringify({ name: id, dsh: { bundle: { patch: './cordis.patch.yml' } } }),
    );
    await writeFile(path.join(bundle, 'cordis.patch.yml'), '[]');
    await writeFile(path.join(bundle, 'score.txt'), String(score));
    arms.push({ id, bundle, digest: await treeDigest(bundle) });
  }
  const exited = {
    Status: 'exited',
    Running: false,
    ExitCode: 0,
    StartedAt: '2026-10-27T00:00:00Z',
    FinishedAt: '2026-10-27T00:00:01Z',
  };
  class Driver extends Docker {
    creations = 0;
    override async create(spec: ContainerSpec) {
      this.creations++;
      const source = spec.mounts.find((m) => m.target === '/candidate')!.source;
      const work = spec.mounts.find((m) => m.target === '/workspace')!.source;
      await writeFile(path.join(work, 'score.txt'), await readFile(path.join(source, 'score.txt')));
    }
    override async collect() {
      return exited;
    }
    override async run(spec: ContainerSpec) {
      if (spec.name.startsWith('he-qa-')) return exited;
      assert.equal(spec.network, 'none');
      assert.deepEqual(spec.env, {});
      const delivery = spec.mounts.find((m) => m.target === '/delivery')!.source;
      const work = spec.mounts.find((m) => m.target === '/workspace')!.source;
      await writeFile(
        path.join(work, 'result.json'),
        JSON.stringify({
          score: Number(await readFile(path.join(delivery, 'score.txt'), 'utf8')),
          metrics: {},
          feedback: 'independent fixture',
        }),
      );
      return exited;
    }
  }
  const driver = new Driver(),
    study = path.join(root, 'study');
  try {
    await validateStudy(study, spec, dataset, arms, driver);
    await validateStudy(study, spec, dataset, arms, driver);
    assert.equal(driver.creations, 8);
    const report = JSON.parse(await readFile(path.join(study, 'comparison.json'), 'utf8'));
    assert.equal(report.comparisons[0].meanDelta, 0.5);
    assert.equal(report.comparisons[0].pairs.length, 4);
    assert.equal(report.comparisons[0].perTask.length, 2);
    await assert.rejects(
      validateStudy(study, { ...spec, repetitions: 3 }, dataset, arms, driver),
      /registration changed/,
    );
  } finally {
    const writable = async (dir: string): Promise<void> => {
      await chmod(dir, 0o755);
      for (const item of await readdir(dir, { withFileTypes: true }))
        if (item.isDirectory()) await writable(path.join(dir, item.name));
    };
    await writable(root);
    await rm(root, { recursive: true, force: true });
  }
});
