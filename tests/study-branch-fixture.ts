import { chmod, mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { treeDigest } from '../src/artifacts.js';
import { OptimizerStudy } from '../src/optimizer-study-contracts.js';
import { OptimizerStudyStore } from '../src/optimizer-study-store.js';
import { OptimizerStudyCoordinator, prepareOptimizerStudy } from '../src/optimizer-study.js';
import type { StudyControl } from '../src/study-control.js';
import { specification } from './fixtures.js';
import { optimizerArtifactFixture } from './optimizer-fixture.js';

/** Branch-only fixture: real source publication, no model, search, build or grader execution. */
export async function studyBranchFixture() {
  const parent = await mkdtemp(path.join(os.tmpdir(), 'he-study-branch-'));
  const root = path.join(parent, 'study');
  const child = specification();
  await optimizerArtifactFixture(parent, child);
  if (child.optimizerHarness.kind !== 'artifact') throw Error('Expected synthetic frozen method');
  const method = {
    source: child.optimizerHarness.source,
    artifact: child.optimizerHarness.artifact,
    composition: child.optimizerHarness.composition,
  };
  const item = async (id: string) => {
    const register = async (role: 'search' | 'assessment') => {
      const specification = structuredClone(child),
        directory = `${id}/${role}`;
      const input = path.join(parent, 'dataset', directory);
      for (const task of specification.tasks) {
        for (const area of [task.input, task.evaluation]) {
          await mkdir(path.join(input, area), { recursive: true });
          await writeFile(path.join(input, area, 'fixture.txt'), `${id}/${role}/${area}`);
        }
        task.inputDigest = await treeDigest(path.join(input, task.input));
        task.evaluationDigest = await treeDigest(path.join(input, task.evaluation));
      }
      if (role === 'assessment') {
        specification.purpose = 'validation';
        specification.budget.candidates = 1;
        specification.probes = null;
      }
      return { specification, dataset: { directory, digest: await treeDigest(input) } };
    };
    return {
      id,
      seed: { source: method.source, artifact: method.artifact },
      search: await register('search'),
      assessment: await register('assessment'),
    };
  };
  const spec = OptimizerStudy.parse({
    name: 'branch-fixture',
    objective: 'Verify native optimizer branch receipt',
    baseline: method,
    metaOptimizer: method,
    metaRuntime: { runtime: child.runtime, model: child.optimizer, isolation: child.isolation, egress: [] },
    methodBuild: child.candidate.build,
    methodQA: null,
    developmentCases: [await item('development')],
    validationCases: [await item('sealed')],
    repetitions: 1,
    budget: { methodCandidates: 2, metaOptimizerSeconds: 60, concurrentSearches: 1 },
    selection: { failureLimit: 0 },
  });
  await prepareOptimizerStudy(root, spec, path.join(parent, 'dataset'));
  const store = new OptimizerStudyStore(path.join(root, 'study.sqlite'), spec);
  const coordinator = new OptimizerStudyCoordinator(root, store);
  await coordinator.start();
  const unused = async () => {
    throw Error('Unexpected non-branch capability');
  };
  const control: StudyControl = {
    status: () => coordinator.publicStatus(),
    branch: (candidate, draft) => coordinator.branch(candidate, draft),
    submit: unused,
    events: unused,
    finish: unused,
    search: unused,
    evidence: unused,
    materialize: unused,
  };
  return {
    root,
    coordinator,
    store,
    spec,
    control,
    close: async () => {
      await coordinator.close();
      store.close();
      const writable = async (directory: string): Promise<void> => {
        await chmod(directory, 0o755);
        for (const entry of await readdir(directory, { withFileTypes: true }))
          if (entry.isDirectory()) await writable(path.join(directory, entry.name));
      };
      await writable(parent);
      await rm(parent, { recursive: true });
    },
  };
}
