import { containerIdentity } from '../src/isolation.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, chmod, readdir, cp, unlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { specification } from './fixtures.js';
import { treeDigest, fileDigest, atomicJSON } from '../src/artifacts.js';
import { Docker, type ContainerSpec } from '../src/docker.js';
import { validateStudy, validateFrozenArm } from '../src/validation.js';
import { cancelValidationStudy } from '../src/validation-cancel.js';

test('single-arm and paired validation preserve built artifacts and resume without new executions', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'he-study-'));
  const spec = {
    ...specification(),
    purpose: 'validation' as const,
    repetitions: 2,
    constraints: [
      {
        id: 'preserve',
        metric: 'preserved',
        aggregation: 'each' as const,
        operator: 'gte' as const,
        threshold: 1,
      },
    ],
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
    await writeFile(path.join(bundle, 'package-lock.json'), '{}');
    await writeFile(path.join(bundle, 'score.txt'), '-1');
    const sourceDigest = await treeDigest(bundle);
    const artifact = path.join(root, `built-${id}`);
    await mkdir(artifact);
    await cp(bundle, path.join(artifact, 'bundle'), { recursive: true });
    await writeFile(path.join(artifact, 'bundle/score.txt'), String(score));
    await writeFile(path.join(artifact, 'bundle/build-nonce.txt'), String(Date.now()));
    await writeFile(path.join(artifact, 'bundle.tgz'), `archive-${id}`);
    const receipt = {
      sourceDigest,
      lockDigest: await fileDigest(path.join(bundle, 'package-lock.json')),
      bundleDigest: await treeDigest(path.join(artifact, 'bundle')),
      tarballDigest: await fileDigest(path.join(artifact, 'bundle.tgz')),
    };
    await atomicJSON(path.join(artifact, 'receipt.json'), receipt);
    arms.push({
      id,
      source: bundle,
      digest: sourceDigest,
      artifact,
      build: {
        artifactDigest: await treeDigest(artifact),
        bundleDigest: receipt.bundleDigest,
        tarballDigest: receipt.tarballDigest,
        lockDigest: receipt.lockDigest,
        image: spec.candidate.build.image,
      },
    });
  }
  const exited = {
    Status: 'exited',
    Running: false,
    ExitCode: 0,
    StartedAt: '2026-10-27T00:00:00Z',
    FinishedAt: '2026-10-27T00:00:01Z',
  };
  class Driver extends Docker {
    override async executionReference(spec: ContainerSpec) {
      return { name: spec.name, id: spec.name, intent: containerIdentity(spec) };
    }
    override async inspect() {
      return exited;
    }
    override async halt() {}
    creations = 0;
    override async create(spec: ContainerSpec) {
      assert.ok(!spec.name.startsWith('he-build-'), 'Independent validation must never rebuild artifacts');
      this.creations++;
      const source = spec.mounts.find((m) => m.target === '/candidate')!.source;
      const work = spec.mounts.find((m) => m.target === '/workspace')!.source;
      await writeFile(path.join(work, 'score.txt'), await readFile(path.join(source, 'score.txt')));
    }
    override async collect() {
      return exited;
    }
    override async run(spec: ContainerSpec, _logDir?: string, _signal?: AbortSignal) {
      if (spec.name.startsWith('he-build-')) {
        throw new Error('Independent validation must never rebuild selected artifacts');
      }
      if (spec.name.startsWith('he-qa-')) return exited;
      assert.equal(spec.network, 'none');
      assert.deepEqual(spec.env, {});
      const delivery = spec.mounts.find((m) => m.target === '/delivery')!.source;
      const work = spec.mounts.find((m) => m.target === '/workspace')!.source;
      await writeFile(
        path.join(work, 'result.json'),
        JSON.stringify({
          score: Number(await readFile(path.join(delivery, 'score.txt'), 'utf8')),
          metrics: {
            preserved: Number(await readFile(path.join(delivery, 'score.txt'), 'utf8')) < 0.5 ? 1 : 0.9,
          },
          feedback: 'independent fixture',
        }),
      );
      return exited;
    }
  }
  const driver = new Driver(),
    study = path.join(root, 'study');
  try {
    const single = path.join(root, 'single');
    const observed = await validateFrozenArm(single, spec, dataset, arms[0], driver);
    assert.equal(observed.mean, 0.25);
    assert.equal(observed.complete, true);
    assert.equal(observed.samples!.length, 4);
    await validateFrozenArm(single, spec, dataset, arms[0], driver);
    assert.equal(driver.creations, 4);
    await assert.rejects(
      validateFrozenArm(
        single,
        spec,
        dataset,
        {
          ...arms[0],
          build: { ...arms[0]!.build, bundleDigest: '0'.repeat(64) },
        },
        driver,
      ),
      /integrity mismatch/,
    );
    const stopped = new Error('Parent study interrupted');
    await assert.rejects(
      validateFrozenArm(
        path.join(root, 'never-started'),
        spec,
        dataset,
        arms[0],
        driver,
        AbortSignal.abort(stopped),
      ),
      (error) => error === stopped,
    );
    assert.equal(driver.creations, 4);
    const abortBeforeRegistration = path.join(root, 'aborted-validation');
    await assert.rejects(
      validateStudy(abortBeforeRegistration, spec, dataset, arms, driver, AbortSignal.abort(stopped)),
      (error) => error === stopped,
    );
    await assert.rejects(readFile(path.join(abortBeforeRegistration, 'registration.json')), {
      code: 'ENOENT',
    });

    const stopValidation = new AbortController();
    class InterruptingDriver extends Driver {
      observedSignal = false;
      override async run(input: ContainerSpec, logDir?: string, signal?: AbortSignal) {
        if (input.name.startsWith('he-qa-')) {
          assert.equal(signal, stopValidation.signal, 'CLI-facing study signal must reach the arm worker');
          this.observedSignal = true;
          stopValidation.abort(stopped);
          signal!.throwIfAborted();
        }
        return await super.run(input, logDir, signal);
      }
    }
    const interruptedDriver = new InterruptingDriver(),
      interruptedStudy = path.join(root, 'interrupted-validation');
    await assert.rejects(
      validateStudy(interruptedStudy, spec, dataset, arms, interruptedDriver, stopValidation.signal),
      (error) => error === stopped,
    );
    assert.equal(interruptedDriver.observedSignal, true);
    assert.equal(interruptedDriver.creations, 0);
    await assert.rejects(readFile(path.join(interruptedStudy, 'arms/candidate/experiment.sqlite')), {
      code: 'ENOENT',
    });
    await assert.rejects(readFile(path.join(interruptedStudy, 'comparison.json')), { code: 'ENOENT' });
    const cancellation = await cancelValidationStudy(interruptedStudy, interruptedDriver);
    assert.equal(cancellation.outcome, 'cancelled');
    assert.deepEqual(
      cancellation.arms.map((arm) => arm.cleanup.state),
      ['cancelled', 'unstarted'],
    );
    assert.deepEqual(await cancelValidationStudy(interruptedStudy, interruptedDriver), cancellation);
    await assert.rejects(
      validateStudy(interruptedStudy, spec, dataset, arms, interruptedDriver),
      /cancellation has started/,
    );
    assert.equal(interruptedDriver.creations, 0);
    await writeFile(path.join(interruptedStudy, 'validation-cancellation.json'), '{}');
    await assert.rejects(cancelValidationStudy(interruptedStudy, interruptedDriver), /receipt changed/);

    await validateStudy(study, spec, dataset, arms, driver);
    // The immutable intent survives a missing registration projection.
    await unlink(path.join(study, 'registration.json'));
    await validateStudy(study, spec, dataset, arms, driver);
    assert.equal(driver.creations, 12);
    const report = JSON.parse(await readFile(path.join(study, 'comparison.json'), 'utf8'));
    assert.equal(report.comparisons[0].meanDelta, 0.5);
    assert.equal(report.comparisons[0].pairs.length, 4);
    assert.equal(report.comparisons[0].perTask.length, 2);
    assert.equal(report.comparisons[0].strictImprovement, false);
    assert.equal(report.results[0].constraints[0].status, 'passed');
    assert.equal(report.results[1].constraints[0].status, 'violated');
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
