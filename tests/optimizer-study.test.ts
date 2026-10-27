import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod, cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { ReclamationError } from '../src/execution.js';
import { atomicJSON, digest, fileDigest, treeDigest } from '../src/artifacts.js';
import { Docker, type ContainerSpec } from '../src/docker.js';
import { containerIdentity } from '../src/isolation.js';
import {
  OptimizerStudy,
  studyMethodIdentity,
  type FrozenStudyMethodRef,
} from '../src/optimizer-study-contracts.js';
import { OptimizerStudyStore } from '../src/optimizer-study-store.js';
import { OptimizerStudyCoordinator, prepareOptimizerStudy } from '../src/optimizer-study.js';
import { optimizerArtifactFixture } from './optimizer-fixture.js';
import { specification } from './fixtures.js';

const exited = {
  Status: 'exited',
  Running: false,
  ExitCode: 0,
  StartedAt: '2026-10-28T00:00:00Z',
  FinishedAt: '2026-10-28T00:00:01Z',
};
class Driver extends Docker {
  created: ContainerSpec[] = [];
  builds = 0;
  tasks = 0;
  grades = 0;
  failBuild = false;
  override async create(spec: ContainerSpec) {
    this.created.push(spec);
    if (spec.name.startsWith('he-run-')) {
      this.tasks++;
      await writeFile(
        path.join(spec.mounts.find((mount) => mount.target === '/workspace')!.source, 'delivery.txt'),
        'actual fixture delivery',
      );
    }
  }
  override async inspect() {
    return exited;
  }
  override async halt() {}
  override async executionReference(spec: ContainerSpec) {
    return { name: spec.name, id: spec.name, intent: containerIdentity(spec) };
  }
  override async collect(spec: ContainerSpec) {
    if (spec.name.startsWith('he-build-')) {
      this.builds++;
      if (this.failBuild) return { ...exited, ExitCode: 7 };
      const source = spec.mounts.find((mount) => mount.target === '/source')!.source;
      const output = path.join(spec.mounts.find((mount) => mount.target === '/workspace')!.source, 'output');
      await mkdir(output, { recursive: true });
      await cp(source, path.join(output, 'bundle'), { recursive: true });
      await writeFile(path.join(output, 'bundle.tgz'), 'synthetic artifact');
      await atomicJSON(path.join(output, 'receipt.json'), {
        sourceDigest: await treeDigest(source),
        lockDigest: await fileDigest(path.join(source, 'package-lock.json')),
        bundleDigest: await treeDigest(path.join(output, 'bundle')),
        tarballDigest: await fileDigest(path.join(output, 'bundle.tgz')),
      });
    }
    return exited;
  }
  override async run(spec: ContainerSpec) {
    if (spec.name.startsWith('he-qa-')) return exited;
    assert.ok(spec.name.startsWith('he-grade-'));
    this.grades++;
    await atomicJSON(
      path.join(spec.mounts.find((mount) => mount.target === '/workspace')!.source, 'result.json'),
      { score: 0.75, metrics: {}, feedback: 'independent synthetic evaluator' },
    );
    return exited;
  }
}
async function writable(directory: string): Promise<void> {
  await chmod(directory, 0o755);
  for (const entry of await readdir(directory, { withFileTypes: true }))
    if (entry.isDirectory()) await writable(path.join(directory, entry.name));
}
async function fixture() {
  const parent = await mkdtemp(path.join(os.tmpdir(), 'he-study-coordinator-')),
    inputs = path.join(parent, 'dataset'),
    root = path.join(parent, 'study');
  const base = specification();
  await optimizerArtifactFixture(parent, base);
  assert.equal(base.optimizerHarness.kind, 'artifact');
  if (base.optimizerHarness.kind !== 'artifact') throw Error('fixture');
  const method: FrozenStudyMethodRef = {
    source: base.optimizerHarness.source,
    artifact: base.optimizerHarness.artifact,
    composition: base.optimizerHarness.composition,
  };
  const cases = [];
  for (const id of ['development', 'sealed']) {
    const specs = [];
    for (const role of ['search', 'assessment']) {
      const spec = structuredClone(base),
        directory = `${id}/${role}`;
      for (const task of spec.tasks) {
        for (const area of [task.input, task.evaluation]) {
          const folder = path.join(inputs, directory, area);
          await mkdir(folder, { recursive: true });
          await writeFile(path.join(folder, 'value.txt'), `${id}-${role}-${area}`);
        }
        task.inputDigest = await treeDigest(path.join(inputs, directory, task.input));
        task.evaluationDigest = await treeDigest(path.join(inputs, directory, task.evaluation));
      }
      if (role === 'assessment') {
        spec.purpose = 'validation';
        spec.budget.candidates = 1;
        spec.probes = null;
      }
      specs.push({
        specification: spec,
        dataset: { directory, digest: await treeDigest(path.join(inputs, directory)) },
      });
    }
    cases.push({
      id,
      seed: { source: method.source, artifact: method.artifact },
      search: specs[0]!,
      assessment: specs[1]!,
    });
  }
  const spec = OptimizerStudy.parse({
    name: 'study-fixture',
    objective: 'Test native optimizer study orchestration',
    baseline: method,
    metaOptimizer: method,
    metaRuntime: { runtime: base.runtime, model: base.optimizer, isolation: base.isolation, egress: [] },
    methodBuild: base.candidate.build,
    methodQA: null,
    developmentCases: [cases[0]],
    validationCases: [cases[1]],
    repetitions: 1,
    budget: { methodCandidates: 3, metaOptimizerSeconds: 60, concurrentSearches: 1 },
    selection: { failureLimit: 0 },
  });
  await prepareOptimizerStudy(root, spec, inputs);
  const store = new OptimizerStudyStore(path.join(root, 'study.sqlite'), spec),
    driver = new Driver(),
    coordinator = new OptimizerStudyCoordinator(root, store, driver);
  await coordinator.start();
  return {
    parent,
    root,
    inputs,
    spec,
    store,
    driver,
    coordinator,
    cleanup: async () => {
      await coordinator.close();
      store.close();
      await writable(parent);
      await rm(parent, { recursive: true });
    },
  };
}
test('study freezes all registered inputs and never reconstructs missing prepared snapshots', async () => {
  const f = await fixture();
  try {
    await prepareOptimizerStudy(f.root, f.spec, f.inputs);
    assert.equal(f.driver.created.length, 0);
    assert.equal(await treeDigest(path.join(f.root, 'inputs')), await treeDigest(f.inputs));
    await writable(path.join(f.root, 'inputs'));
    await rm(path.join(f.root, 'inputs'), { recursive: true });
    await assert.rejects(prepareOptimizerStudy(f.root, f.spec, f.inputs), { code: 'ENOENT' });
    await assert.rejects(readFile(path.join(f.root, 'inputs/optimizer-bundle/package.json')), {
      code: 'ENOENT',
    });
  } finally {
    await f.cleanup();
  }
});
test('method submission freezes before returning, native build publishes once and branches replay safely', async () => {
  const f = await fixture();
  try {
    const baseline = f.store.methods()[0]!;
    const branch = await f.coordinator.branch(baseline.id, 'new-method');
    assert.deepEqual(branch, {
      draft: 'new-method',
      path: '/workspace/new-method',
      targetRole: 'search-optimizer',
      parent: {
        candidateId: baseline.id,
        sourceDigest: baseline.source.digest,
        methodIdentity: studyMethodIdentity(baseline.method!),
        composition: baseline.method!.composition,
      },
    });
    const draft = path.join(f.root, 'drafts/new-method');
    await writeFile(path.join(draft, 'plugins.yml'), '# independently changed G\n[]');
    assert.deepEqual(await f.coordinator.branch(baseline.id, 'new-method'), branch);
    assert.match(await readFile(path.join(draft, 'plugins.yml'), 'utf8'), /independently changed/);
    const submission = {
      composition: 'plugins.yml',
      proposal: {
        draft: 'new-method',
        parents: [baseline.source.digest],
        actions: ['author'],
        evidence: ['development search evidence'],
        hypothesis: 'Change optimizer composition',
        expectedChange: 'Different native method',
      },
    };
    const reserved = await f.coordinator.submitMethod(submission);
    assert.equal(reserved.phase, 'preparing');
    assert.equal(f.driver.created.length, 0);
    assert.equal(await treeDigest(path.join(f.root, reserved.source.directory)), reserved.source.digest);
    await f.coordinator.reconcileMethods();
    assert.equal(f.store.method(reserved.id).phase, 'ready', f.store.method(reserved.id).error);
    assert.equal(f.driver.builds, 1, f.store.method(reserved.id).error);
    await f.coordinator.reconcileMethods();
    assert.equal(f.driver.builds, 1);
    const allMounts = f.driver.created.flatMap((container) => container.mounts.map((mount) => mount.source));
    assert.ok(allMounts.every((mount) => !mount.includes('/sealed/') && !mount.includes('/assessment/')));
    assert.equal((await f.coordinator.submitMethod(submission)).phase, 'ready');
  } finally {
    await f.cleanup();
  }
});
test('failed native method builds keep their slot and are not resampled by resume', async () => {
  const f = await fixture();
  try {
    const baseline = f.store.methods()[0]!;
    await f.coordinator.branch(baseline.id, 'bad-method');
    await writeFile(path.join(f.root, 'drafts/bad-method/plugins.yml'), '# mutation\n[]');
    const reserved = await f.coordinator.submitMethod({
      composition: 'plugins.yml',
      proposal: {
        draft: 'bad-method',
        parents: [baseline.source.digest],
        actions: ['author'],
        evidence: ['development trace'],
        hypothesis: 'Native failure fixture',
        expectedChange: 'Recorded failure',
      },
    });
    f.driver.failBuild = true;
    await f.coordinator.reconcileMethods();
    assert.equal(f.store.method(reserved.id).phase, 'failed');
    assert.equal(f.driver.builds, 1);
    f.driver.failBuild = false;
    await f.coordinator.reconcileMethods();
    assert.equal(f.driver.builds, 1);
  } finally {
    await f.cleanup();
  }
});
test('frozen assessment recovery uses actual validation tasks and never duplicates completed deliveries', async () => {
  const f = await fixture();
  try {
    const method = studyMethodIdentity(f.spec.baseline),
      item = f.spec.developmentCases[0]!;
    const job = f.store.reserveJob(f.coordinator.owner, {
      comparisonArm: null,
      stage: 'development',
      method,
      caseId: item.id,
      repetition: 0,
    });
    f.store.startJob(f.coordinator.owner, job.id, digest(item.search.specification));
    f.store.startAssessment(
      f.coordinator.owner,
      job.id,
      {
        source: { ...item.seed.source, directory: `inputs/${item.seed.source.directory}` },
        artifact: { ...item.seed.artifact, directory: `inputs/${item.seed.artifact.directory}` },
      },
      digest(item.assessment.specification),
    );
    const transport = { host: '127.0.0.1', port: 0, endpoint: 'http://127.0.0.1:0' };
    const report = await f.coordinator.evaluateMethod(method, transport);
    assert.equal(report.complete, true);
    assert.equal(report.mean, 0.75);
    assert.equal(f.driver.tasks, 2);
    assert.equal(f.driver.grades, 2);
    assert.equal(f.driver.builds, 0);
    assert.equal(f.store.job(job.id).result?.denominator, 2);
    await f.coordinator.evaluateMethod(method, transport);
    assert.equal(f.driver.tasks, 2);
    assert.equal(f.driver.grades, 2);
    const exposed = JSON.stringify(f.coordinator.publicStatus());
    assert.ok(!exposed.includes('sealed'));
    assert.ok(!exposed.includes('/assessment'));
    assert.ok(!exposed.includes('private/'));
    await f.coordinator.finishDevelopment('Development evidence is complete');
    await assert.rejects(f.coordinator.branch(f.store.methods()[0]!.id, 'late'), /already concluded/);
    f.coordinator.beginValidation();
    assert.throws(() => f.coordinator.publicStatus(), /closed/);
    await assert.rejects(
      f.coordinator.events(
        { cursor: f.store.cursor(), limit: 100, timeoutMs: 0 },
        new AbortController().signal,
      ),
      /closed/,
    );
  } finally {
    await f.cleanup();
  }
});

test('method cleanup interruption remains resumable and only reclaims the original failed container', async () => {
  const f = await fixture();
  await f.coordinator.close();
  class FailedCleanup extends Driver {
    collections = 0;
    halts = 0;
    override async collect(spec: ContainerSpec) {
      if (spec.name.startsWith('he-build-')) {
        this.collections++;
        throw Error('Original compiler transport failed');
      }
      return super.collect(spec);
    }
    override async halt() {
      if (++this.halts === 1) throw Error('Reclamation interrupted');
    }
  }
  const driver = new FailedCleanup(),
    coordinator = new OptimizerStudyCoordinator(f.root, f.store, driver);
  await coordinator.start();
  try {
    const baseline = f.store.methods()[0]!;
    await coordinator.branch(baseline.id, 'interrupted');
    await writeFile(path.join(f.root, 'drafts/interrupted/plugins.yml'), '# new source\n[]');
    const candidate = await coordinator.submitMethod({
      composition: 'plugins.yml',
      proposal: {
        draft: 'interrupted',
        parents: [baseline.source.digest],
        actions: ['author'],
        evidence: ['source trace'],
        hypothesis: 'Failure propagation',
        expectedChange: 'Durable cleanup',
      },
    });
    await assert.rejects(coordinator.reconcileMethods(), ReclamationError);
    assert.equal(f.store.method(candidate.id).phase, 'preparing');
    assert.equal(driver.collections, 1);
    assert.equal(driver.created.length, 1);
    await coordinator.reconcileMethods();
    assert.equal(f.store.method(candidate.id).phase, 'failed');
    assert.equal(driver.collections, 1);
    assert.equal(driver.created.length, 1);
    assert.equal(driver.halts, 2);
  } finally {
    await coordinator.close();
    await f.cleanup();
  }
});

test('SIGKILL before and after editable draft publication resumes one registered branch', async (t) => {
  for (const phase of ['reserved', 'published'])
    await t.test(phase, async () => {
      const f = await fixture();
      await f.coordinator.close();
      try {
        const parent = f.store.methods()[0]!.id;
        const code = `import {channel} from 'node:diagnostics_channel';
        import {readFile} from 'node:fs/promises';
        import {OptimizerStudyStore} from ${JSON.stringify(new URL('../src/optimizer-study-store.ts', import.meta.url).href)};
        import {OptimizerStudyCoordinator} from ${JSON.stringify(new URL('../src/optimizer-study.ts', import.meta.url).href)};
        const root=${JSON.stringify(f.root)},spec=JSON.parse(await readFile(root+'/registration.json','utf8'));
        const store=new OptimizerStudyStore(root+'/study.sqlite',spec),coordinator=new OptimizerStudyCoordinator(root,store);
        store.acquire(coordinator.owner,Date.now(),500);
        channel('harness-evolution:study-branch').subscribe(event=>{if(event.phase===${JSON.stringify(phase)})process.kill(process.pid,'SIGKILL')});
        await coordinator.branch(${JSON.stringify(parent)},'recoverable');`;
        const result = await new Promise<{ signal: NodeJS.Signals | null; stderr: string }>(
          (resolve, reject) => {
            const child = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', code], {
              stdio: ['ignore', 'ignore', 'pipe'],
            });
            let stderr = '';
            child.stderr.on('data', (part) => {
              stderr += part;
            });
            child.on('error', reject);
            child.on('exit', (_code, signal) => resolve({ signal, stderr }));
          },
        );
        assert.equal(result.signal, 'SIGKILL', result.stderr);
        await delay(550);
        await f.coordinator.start();
        await f.coordinator.branch(parent, 'recoverable');
        assert.equal(
          await treeDigest(path.join(f.root, 'drafts/recoverable')),
          f.spec.baseline.source.digest,
        );
        await writeFile(path.join(f.root, 'drafts/recoverable/plugins.yml'), '# preserve editable content');
        await f.coordinator.branch(parent, 'recoverable');
        assert.match(
          await readFile(path.join(f.root, 'drafts/recoverable/plugins.yml'), 'utf8'),
          /preserve editable content/,
        );
      } finally {
        await f.cleanup();
      }
    });
});
