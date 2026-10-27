import { containerIdentity } from '../src/isolation.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, cp, writeFile, chmod, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Docker, type ContainerSpec } from '../src/docker.js';
import { prepareOptimizer, optimizerBundlePath } from '../src/optimizer-harness.js';
import { buildBundle } from '../src/build.js';
import { atomicJSON, fileDigest, freeze, treeDigest } from '../src/artifacts.js';
import { Experiment } from '../src/contracts.js';
import { specification } from './fixtures.js';
import { optimizerArtifactFixture } from './optimizer-fixture.js';

const exited = {
  Status: 'exited',
  Running: false,
  ExitCode: 0,
  StartedAt: '2026-10-28T00:00:00Z',
  FinishedAt: '2026-10-28T00:00:01Z',
};
class Driver extends Docker {
  override async executionReference(spec: ContainerSpec) {
    return { name: spec.name, id: spec.name, intent: containerIdentity(spec) };
  }
  created: ContainerSpec[] = [];
  collected: ContainerSpec[] = [];
  present = true;
  exitCode = 0;
  built = new Set<string>();
  override async create(spec: ContainerSpec) {
    this.created.push(spec);
  }
  override async inspect() {
    return this.present ? exited : undefined;
  }
  override async halt() {}
  override async collect(spec: ContainerSpec) {
    this.collected.push(spec);
    if (spec.name.startsWith('he-build-') && this.exitCode === 0 && !this.built.has(spec.name)) {
      const source = spec.mounts.find((m) => m.target === '/source')!.source;
      const output = path.join(spec.mounts.find((m) => m.target === '/workspace')!.source, 'output');
      await mkdir(output, { recursive: true });
      await cp(source, path.join(output, 'bundle'), { recursive: true });
      await writeFile(path.join(output, 'bundle.tgz'), 'mock archive');
      await atomicJSON(path.join(output, 'receipt.json'), {
        sourceDigest: await treeDigest(source),
        lockDigest: await fileDigest(path.join(source, 'package-lock.json')),
        bundleDigest: await treeDigest(path.join(output, 'bundle')),
        tarballDigest: await fileDigest(path.join(output, 'bundle.tgz')),
      });
      this.built.add(spec.name);
    }
    return { ...exited, ExitCode: this.exitCode };
  }
}

test('G source builds once, loads native preset from artifact, and prepared recovery only verifies', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'he-g-source-'));
  const spec = specification();
  await optimizerArtifactFixture(root, spec);
  spec.optimizerHarness = {
    kind: 'source',
    source: spec.optimizerHarness.source,
    composition: 'plugins.yml',
    build: spec.candidate.build,
  };
  const driver = new Driver();
  const result = await prepareOptimizer(root, path.join(root, 'dataset'), spec, driver);
  assert.equal(driver.created.length, 2);
  assert.ok(driver.created[0]!.name.startsWith('he-build-'));
  const qa = driver.created[1]!;
  assert.ok(qa.name.startsWith('he-gqa-'));
  assert.equal(qa.network, 'none');
  assert.equal(qa.mounts.find((m) => m.target === '/method')!.source, optimizerBundlePath(root, result));
  assert.equal(qa.mounts.find((m) => m.target === '/method')!.writable, false);
  const patch = await readFile(qa.mounts.find((m) => m.target === '/optimizer.patch.yml')!.source, 'utf8');
  assert.match(patch, /preset: evolution/);
  assert.match(patch, /\/method\/plugins.yml/);
  driver.present = false;
  assert.deepEqual(await prepareOptimizer(root, path.join(root, 'dataset'), spec, driver), result);
  assert.equal(driver.created.length, 2);
  await assert.rejects(
    prepareOptimizer(
      root,
      path.join(root, 'dataset'),
      { ...spec, optimizerHarness: { ...spec.optimizerHarness, composition: 'other.yml' } },
      driver,
    ),
    /contract changed/,
  );
  const frozen = path.join(root, 'optimizer-harness/candidates', result.sourceDigest, 'package-lock.json');
  await chmod(frozen, 0o644);
  await writeFile(frozen, '{}');
  await assert.rejects(
    prepareOptimizer(root, path.join(root, 'dataset'), spec, driver),
    /source or lock mismatch/,
  );
});

test('frozen G artifact never builds; identity survives a second independent experiment root', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'he-g-artifact-'));
  const spec = specification();
  await optimizerArtifactFixture(root, spec);
  const driver = new Driver();
  const one = await prepareOptimizer(root, path.join(root, 'dataset'), spec, driver);
  const second = await mkdtemp(path.join(os.tmpdir(), 'he-g-artifact-second-'));
  const two = await prepareOptimizer(second, path.join(root, 'dataset'), spec, driver);
  assert.deepEqual(one, two);
  assert.ok(driver.created.every((c) => c.name.startsWith('he-gqa-')));
  const aborted = AbortSignal.abort(Error('parent stopped'));
  await assert.rejects(
    prepareOptimizer('/not-created', '/not-read', spec, driver, aborted),
    /parent stopped/,
  );
  assert.equal(driver.created.length, 2);
});

test('G invalid composition, lock, legacy source shape and evaluation overlap fail explicitly', async () => {
  assert.equal(
    Experiment.safeParse({
      ...specification(),
      optimizerHarness: { directory: 'old', digest: 'a'.repeat(64), composition: 'plugins.yml' },
    }).success,
    false,
  );
  const root = await mkdtemp(path.join(os.tmpdir(), 'he-g-invalid-'));
  const spec = specification();
  await optimizerArtifactFixture(root, spec);
  assert.equal(spec.optimizerHarness.kind, 'artifact');
  if (spec.optimizerHarness.kind !== 'artifact') throw Error('fixture');
  assert.equal(
    Experiment.safeParse({
      ...spec,
      optimizerHarness: {
        ...spec.optimizerHarness,
        artifact: { ...spec.optimizerHarness.artifact, directory: 'private/one' },
      },
    }).success,
    false,
  );
  spec.optimizerHarness.composition = 'absent.yml';
  const driver = new Driver();
  await assert.rejects(prepareOptimizer(root, path.join(root, 'dataset'), spec, driver), /ENOENT/);
  assert.equal(driver.created.length, 0);
});

test('shared G/H build resumes original intent and refuses missing original container or changed contract', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'he-shared-build-'));
  const spec = specification();
  const source = path.join(root, 'source');
  await mkdir(source);
  await writeFile(path.join(source, 'package-lock.json'), '{}');
  const id = await treeDigest(source);
  await freeze(source, path.join(root, 'candidates', id), path.join(root, 'publications'));
  const driver = new Driver();
  const one = await buildBundle(root, root, id, spec.candidate.build, spec.isolation, driver);
  const two = await buildBundle(root, root, id, spec.candidate.build, spec.isolation, driver);
  assert.deepEqual(one, two);
  assert.equal(driver.created.length, 1);
  assert.equal(driver.collected.length, 2);
  driver.present = false;
  await assert.rejects(
    buildBundle(root, root, id, spec.candidate.build, spec.isolation, driver),
    /Original execution container missing/,
  );
  assert.equal(driver.created.length, 1);
  const failed = await readFile(path.join(root, 'builds', id, 'execution-failure.json'), 'utf8');
  assert.match(failed, /reclaimed/);
});

test('G native loading failure is terminal and recovery never creates another container', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'he-g-failure-'));
  const spec = specification();
  await optimizerArtifactFixture(root, spec);
  const driver = new Driver();
  driver.exitCode = 7;
  await assert.rejects(prepareOptimizer(root, path.join(root, 'dataset'), spec, driver), /exited 7/);
  await assert.rejects(
    prepareOptimizer(root, path.join(root, 'dataset'), spec, driver),
    /no automatic retry/,
  );
  assert.equal(driver.created.length, 1);
  await assert.rejects(readFile(path.join(root, 'optimizer-harness/prepared.json')), { code: 'ENOENT' });
  await rm(path.join(root, 'optimizer-harness/qa/execution-failure.json'));
  driver.present = false;
  await assert.rejects(
    prepareOptimizer(root, path.join(root, 'dataset'), spec, driver),
    /Original execution container missing/,
  );
  assert.equal(driver.created.length, 1);
});

test('parent interruption while collecting G build or native QA resumes the same original container', async () => {
  for (const stage of ['build', 'qa'] as const) {
    const root = await mkdtemp(path.join(os.tmpdir(), `he-g-${stage}-interrupted-`));
    const spec = specification();
    await optimizerArtifactFixture(root, spec);
    if (stage === 'build')
      spec.optimizerHarness = {
        kind: 'source',
        source: spec.optimizerHarness.source,
        composition: 'plugins.yml',
        build: spec.candidate.build,
      };
    const abort = new AbortController();
    class Interrupted extends Driver {
      interrupted = false;
      halts = 0;
      override async halt() {
        this.halts++;
      }
      override async collect(container: ContainerSpec) {
        if (!this.interrupted && container.name.startsWith(stage === 'build' ? 'he-build-' : 'he-gqa-')) {
          this.interrupted = true;
          abort.abort(Error('parent interrupted collection'));
          throw abort.signal.reason;
        }
        return super.collect(container);
      }
    }
    const driver = new Interrupted();
    await assert.rejects(
      prepareOptimizer(root, path.join(root, 'dataset'), spec, driver, abort.signal),
      /parent interrupted collection/,
    );
    const interruptedName = driver.created[0]!.name;
    assert.equal(driver.halts, 0);
    const failure =
      stage === 'build'
        ? path.join(
            root,
            'optimizer-harness/builds',
            spec.optimizerHarness.source.digest,
            'execution-failure.json',
          )
        : path.join(root, 'optimizer-harness/qa/execution-failure.json');
    await assert.rejects(readFile(failure), { code: 'ENOENT' });
    await prepareOptimizer(root, path.join(root, 'dataset'), spec, driver);
    assert.equal(driver.created.filter((c) => c.name === interruptedName).length, 1);
    assert.equal(driver.halts, 0);
  }
});
