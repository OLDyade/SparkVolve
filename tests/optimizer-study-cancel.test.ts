import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { atomicJSON, digest } from '../src/artifacts.js';
import { Docker, type ContainerReference, type ContainerSpec } from '../src/docker.js';
import { prepareExecution } from '../src/execution.js';
import { containerIdentity } from '../src/isolation.js';
import {
  OptimizerStudy,
  studyMethodIdentity,
  type FrozenStudyMethodRef,
} from '../src/optimizer-study-contracts.js';
import { OptimizerStudyStore } from '../src/optimizer-study-store.js';
import { OptimizerStudyCoordinator } from '../src/optimizer-study.js';
import { cancelOptimizerStudy } from '../src/optimizer-study-cancel.js';
import { Store } from '../src/store.js';
import { specification, hash } from './fixtures.js';

class Driver extends Docker {
  containers = new Map<string, { reference: ContainerReference; running: boolean }>();
  creates = 0;
  removals = 0;
  stops = 0;
  interrupt = false;
  override async create(spec: ContainerSpec) {
    this.containers.set(spec.name, {
      reference: { name: spec.name, id: String(++this.creates), intent: containerIdentity(spec) },
      running: true,
    });
  }
  override async inspect(name: string) {
    const item = this.containers.get(name);
    return item
      ? {
          Status: item.running ? 'running' : 'exited',
          Running: item.running,
          ExitCode: 0,
          StartedAt: '2026-10-28T00:00:00Z',
          FinishedAt: '',
        }
      : undefined;
  }
  override async executionReference(spec: ContainerSpec) {
    const item = this.containers.get(spec.name);
    assert.ok(item);
    assert.equal(item.reference.intent, containerIdentity(spec));
    return item.reference;
  }
  override async failureEvidence(spec: ContainerSpec, directory: string, original?: ContainerReference) {
    const item = this.containers.get(spec.name);
    assert.ok(item);
    assert.deepEqual(item.reference, original);
    item.running = false;
    this.stops++;
    await atomicJSON(path.join(directory, 'observation.json'), item.reference);
    return item.reference;
  }
  override async remove(reference: ContainerReference) {
    const item = this.containers.get(reference.name);
    if (!item) return;
    assert.deepEqual(reference, item.reference);
    assert.equal(item.running, false);
    this.containers.delete(reference.name);
    this.removals++;
    if (this.interrupt) {
      this.interrupt = false;
      throw Error('Interrupted after removal');
    }
  }
}
async function register(root: string, directory: string, driver: Driver) {
  const base = specification();
  const spec: ContainerSpec = {
    name: `study-cancel-${digest(directory).slice(0, 24)}`,
    image: base.runtime.image,
    command: ['node', 'worker'],
    mounts: [],
    network: 'none',
    env: {},
    timeoutSeconds: 60,
    isolation: base.isolation,
  };
  await mkdir(path.join(root, directory), { recursive: true });
  await prepareExecution(path.join(root, directory), { directory }, driver, null, async () => spec, {});
  return spec;
}
function method(name: string): FrozenStudyMethodRef {
  return {
    source: { directory: `methods/${name}/source`, digest: digest(name) },
    artifact: {
      directory: `methods/${name}/artifact`,
      identity: {
        artifactDigest: hash,
        bundleDigest: hash,
        tarballDigest: hash,
        lockDigest: hash,
        image: specification().runtime.image,
      },
    },
    composition: 'plugins.yml',
  };
}
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'he-study-cancel-')),
    base = specification();
  const item = (id: string) => ({
    id,
    seed: { source: method('h').source, artifact: method('h').artifact },
    search: { specification: base, dataset: { directory: `${id}/search`, digest: hash } },
    assessment: {
      specification: { ...base, purpose: 'validation', budget: { ...base.budget, candidates: 1 } },
      dataset: { directory: `${id}/assessment`, digest: hash },
    },
  });
  const spec = OptimizerStudy.parse({
    name: 'cancel-study',
    objective: 'Recover original registered descendants',
    baseline: method('g0'),
    metaOptimizer: method('meta'),
    metaRuntime: { runtime: base.runtime, model: base.optimizer, isolation: base.isolation, egress: [] },
    methodBuild: base.candidate.build,
    methodQA: null,
    developmentCases: [item('development')],
    validationCases: [item('sealed')],
    repetitions: 2,
    budget: { methodCandidates: 3, metaOptimizerSeconds: 60, concurrentSearches: 1 },
    selection: { failureLimit: 1 },
  });
  await atomicJSON(path.join(root, 'registration.json'), spec);
  const store = new OptimizerStudyStore(path.join(root, 'study.sqlite'), spec),
    owner = 'test-owner';
  store.acquire(owner, Date.now(), 60_000);
  return { root, spec, base, store, owner, driver: new Driver() };
}
test('study cancellation refuses a live owner and records truly unstarted jobs without creating children', async () => {
  const f = await fixture();
  try {
    const job = f.store.reserveJob(f.owner, {
      comparisonArm: null,
      stage: 'development',
      method: studyMethodIdentity(f.spec.baseline),
      caseId: 'development',
      repetition: 0,
    });
    await assert.rejects(cancelOptimizerStudy(f.root, f.driver), /active coordinator/);
    assert.equal(f.store.state().phase, 'developing');
    f.store.release(f.owner);
    const receipt = await cancelOptimizerStudy(f.root, f.driver);
    assert.equal(receipt.children[0]!.search.state, 'unstarted');
    assert.equal(receipt.children[0]!.assessment.state, 'unstarted');
    assert.equal(f.driver.creates, 0);
    await assert.rejects(readFile(path.join(f.root, job.childRoot, 'experiment.sqlite')), { code: 'ENOENT' });
    assert.equal(f.store.state().phase, 'cancelled');
    assert.equal(f.store.state().cleanupDigest, digest(receipt));
    assert.deepEqual(await cancelOptimizerStudy(f.root, f.driver), receipt);
    await assert.rejects(new OptimizerStudyCoordinator(f.root, f.store, f.driver).start(), /cannot start/);
    await atomicJSON(path.join(f.root, 'study-cancellation.json'), { changed: true });
    await assert.rejects(cancelOptimizerStudy(f.root, f.driver), /missing or changed/);
    assert.deepEqual(JSON.parse(await readFile(path.join(f.root, 'study-cancellation.json'), 'utf8')), {
      changed: true,
    });
  } finally {
    f.store.close();
    await rm(f.root, { recursive: true, force: true });
  }
});
test('study recovers child, successful method and completed meta cleanup without traversing writable directories', async () => {
  const f = await fixture();
  try {
    const job = f.store.reserveJob(f.owner, {
      comparisonArm: null,
      stage: 'development',
      method: studyMethodIdentity(f.spec.baseline),
      caseId: 'development',
      repetition: 0,
    });
    f.store.startJob(f.owner, job.id, digest(f.base));
    const childRoot = path.join(f.root, job.childRoot);
    await atomicJSON(path.join(childRoot, 'experiment.json'), f.base);
    const child = new Store(path.join(childRoot, 'experiment.sqlite'), f.base);
    child.reserveSubmission({
      digest: hash,
      phase: 'frozen',
      proposal: {
        draft: 'baseline',
        parents: [],
        actions: ['compose'],
        evidence: ['registered'],
        hypothesis: 'baseline',
        expectedChange: 'none',
      },
    });
    child.commitSubmission(hash);
    child.close();
    await register(childRoot, `builds/${hash}`, f.driver);
    const candidates = [];
    for (const name of ['ready', 'pending']) {
      const value = method(name);
      const candidate = f.store.reserveMethod(f.owner, {
        source: value.source,
        composition: value.composition,
        proposal: {
          draft: name,
          parents: [f.spec.baseline.source.digest],
          actions: ['author'],
          evidence: ['development'],
          hypothesis: 'new method',
          expectedChange: 'new behavior',
        },
      });
      candidates.push(candidate);
      if (name === 'ready') f.store.publishMethod(f.owner, candidate.id, value);
      await register(
        f.root,
        `methods/${candidate.id}/optimizer-harness/builds/${candidate.source.digest}`,
        f.driver,
      );
    }
    await register(f.root, `methods/${candidates[0]!.id}/optimizer-harness/qa`, f.driver);
    const forged = await register(
      f.root,
      `methods/${candidates[0]!.id}/optimizer-harness/builds/${candidates[0]!.source.digest}/work/forged`,
      f.driver,
    );
    f.store.reserveMetaEpisode(f.owner, 0, 60);
    f.store.startMetaEpisode(f.owner, 0);
    f.store.finishMetaEpisode(f.owner, 0, 'complete', 1, hash);
    await register(f.root, 'meta-optimizer/0', f.driver);
    f.store.reserveMetaEpisode(f.owner, 1, 59);
    f.store.startMetaEpisode(f.owner, 1);
    await register(f.root, 'meta-optimizer/1', f.driver);
    f.store.release(f.owner);
    f.driver.interrupt = true;
    await assert.rejects(cancelOptimizerStudy(f.root, f.driver), /Interrupted after removal/);
    assert.equal(f.store.state().phase, 'cancelling');
    const created = f.driver.creates;
    const receipt = await cancelOptimizerStudy(f.root, f.driver);
    assert.equal(f.driver.creates, created);
    assert.equal(f.driver.containers.size, 1);
    assert.equal(f.driver.containers.get(forged.name)?.running, true);
    assert.equal(receipt.children[0]!.search.state, 'cancelled');
    assert.equal(receipt.children[0]!.assessment.state, 'unstarted');
    assert.equal(f.store.method(candidates[0]!.id).phase, 'ready');
    assert.equal(f.store.method(candidates[1]!.id).phase, 'cancelled');
    assert.equal(f.store.metaEpisodes()[0]!.phase, 'complete');
    assert.equal(f.store.metaEpisodes()[1]!.phase, 'cancelled');
    assert.equal(f.store.cleanupRecords().filter((record) => record.kind === 'method').length, 3);
    assert.equal(f.store.cleanupRecords().filter((record) => record.kind === 'meta').length, 2);
    assert.deepEqual(await cancelOptimizerStudy(f.root, f.driver), receipt);
    assert.equal(f.driver.creates, created);
  } finally {
    f.store.close();
    await rm(f.root, { recursive: true, force: true });
  }
});
test('orphaned child execution evidence cannot be relabelled as unstarted', async () => {
  const f = await fixture();
  try {
    const job = f.store.reserveJob(f.owner, {
      comparisonArm: null,
      stage: 'development',
      method: studyMethodIdentity(f.spec.baseline),
      caseId: 'development',
      repetition: 0,
    });
    await register(f.root, `${job.childRoot}/runs/forged`, f.driver);
    f.store.release(f.owner);
    await assert.rejects(cancelOptimizerStudy(f.root, f.driver), /without its original experiment ledger/);
    assert.equal(f.store.state().phase, 'cancelling');
    assert.equal(f.driver.stops, 0);
  } finally {
    f.store.close();
    await rm(f.root, { recursive: true, force: true });
  }
});
