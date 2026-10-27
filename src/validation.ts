import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { Digest, Id, Experiment, BuildIdentity, type ExperimentSpec } from './contracts.js';
import { atomicJSON, digest, freeze, treeDigest } from './artifacts.js';
import { initialize } from './experiment.js';
import { Controller } from './controller.js';
import { Store } from './store.js';
import { Docker } from './docker.js';
import { verifyArtifact, verifyBuild } from './build.js';

export const Arms = z
  .array(
    z.strictObject({
      id: Id,
      source: z.string().min(1),
      digest: Digest,
      artifact: z.string().min(1),
      build: BuildIdentity,
    }),
  )
  .min(2)
  .refine((arms) => new Set(arms.map((arm) => arm.id)).size === arms.length, 'Duplicate arm identifiers');

/** Pre-register all arms before any task starts. One common validation contract, no optimization API. */
export async function validateStudy(
  root: string,
  raw: ExperimentSpec,
  dataset: string,
  rawArms: unknown,
  docker = new Docker(),
): Promise<void> {
  const spec = Experiment.parse(raw),
    arms = Arms.parse(rawArms);
  if (spec.purpose !== 'validation') throw new Error('A paired study requires a validation specification');
  const registration = { specification: spec, datasetDigest: await treeDigest(dataset), arms };
  try {
    const saved: unknown = JSON.parse(await readFile(path.join(root, 'registration.json'), 'utf8'));
    if (digest(saved) !== digest(registration)) throw new Error('Study registration changed');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    await mkdir(root);
    for (const arm of arms) {
      if ((await treeDigest(arm.source)) !== arm.digest) throw new Error(`Arm digest mismatch: ${arm.id}`);
      await verifyArtifact(arm.artifact, arm.digest, arm.build);
      await freeze(arm.source, path.join(root, 'sources', arm.id));
      await freeze(arm.artifact, path.join(root, 'artifacts', arm.id));
    }
    await atomicJSON(path.join(root, 'registration.json'), registration);
  }
  for (const arm of arms) {
    const armRoot = path.join(root, 'arms', arm.id);
    await mkdir(path.dirname(armRoot), { recursive: true });
    try {
      await readFile(path.join(armRoot, 'experiment.json'));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      await initialize(armRoot, spec, dataset, path.join(root, 'sources', arm.id));
    }
    const store = new Store(path.join(armRoot, 'experiment.sqlite'), spec);
    const controller = new Controller(armRoot, path.join(armRoot, 'dataset'), spec, store, docker);
    try {
      await controller.start();
      const candidate = store.candidate(arm.digest);
      if (!candidate.build) {
        const artifact = path.join(armRoot, 'artifacts', arm.digest);
        try {
          await readFile(path.join(artifact, 'receipt.json'));
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
          await freeze(path.join(root, 'artifacts', arm.id), artifact);
        }
        await verifyBuild(armRoot, { ...candidate, build: arm.build });
        store.transaction(() => {
          store.updateCandidate({ ...candidate, build: arm.build });
          store.event('candidate.build_imported', { candidate: arm.digest, build: arm.build });
        });
      }
      await controller.pump();
    } finally {
      await controller.close();
      store.close();
    }
  }
  await writeStudyReport(root);
}

export async function writeStudyReport(root: string): Promise<void> {
  const registration = JSON.parse(await readFile(path.join(root, 'registration.json'), 'utf8')) as {
    specification: ExperimentSpec;
    arms: z.infer<typeof Arms>;
  };
  const { specification: spec, arms } = registration;
  const results = arms.map((arm) => {
    const store = new Store(path.join(root, 'arms', arm.id, 'experiment.sqlite'), spec);
    try {
      const candidates = store.candidates(),
        runs = store.runs();
      if (candidates.length !== 1 || candidates[0]!.digest !== arm.digest)
        throw new Error(`Arm identity mismatch: ${arm.id}`);
      const complete =
        runs.length === spec.tasks.length * spec.repetitions &&
        runs.every((r) => ['scored', 'execution_failed', 'cancelled'].includes(r.phase));
      const samples = complete
        ? runs.map((r) => ({
            task: r.task,
            repetition: r.repetition,
            score: r.grade?.score ?? spec.metric.failure,
            phase: r.phase,
          }))
        : null;
      return {
        id: arm.id,
        candidate: arm.digest,
        build: candidates[0]!.build,
        complete,
        failures: runs.filter((r) => r.phase !== 'scored').length,
        mean: samples ? samples.reduce((sum, r) => sum + r.score, 0) / samples.length : null,
        samples,
      };
    } finally {
      store.close();
    }
  });
  const baseline = results[0]!;
  const comparisons = results.slice(1).map((arm) => {
    if (!baseline.samples || !arm.samples) return { arm: arm.id, status: 'incomplete', pairs: null };
    const pairs = arm.samples.map((sample) => {
      const base = baseline.samples!.find(
        (b) => b.task === sample.task && b.repetition === sample.repetition,
      )!;
      return {
        task: sample.task,
        repetition: sample.repetition,
        baseline: base.score,
        score: sample.score,
        delta: sample.score - base.score,
      };
    });
    const meanDelta = pairs.reduce((sum, p) => sum + p.delta, 0) / pairs.length;
    const perTask = spec.tasks.map((task) => {
      const selected = pairs.filter((p) => p.task === task.id);
      return { task: task.id, meanDelta: selected.reduce((s, p) => s + p.delta, 0) / selected.length };
    });
    const sampleSd =
      pairs.length > 1
        ? Math.sqrt(pairs.reduce((s, p) => s + (p.delta - meanDelta) ** 2, 0) / (pairs.length - 1))
        : null;
    return {
      arm: arm.id,
      status: 'complete',
      meanDelta,
      sampleSd,
      pairs,
      perTask,
      strictImprovement:
        arm.failures <= spec.failureLimit &&
        baseline.failures <= spec.failureLimit &&
        (spec.metric.direction === 'maximize' ? meanDelta > 0 : meanDelta < 0),
    };
  });
  await atomicJSON(path.join(root, 'comparison.json'), {
    registrationDigest: digest(registration),
    order: arms.map((a) => a.id),
    results,
    comparisons,
    boundary:
      'Paired descriptive results, full denominator. Repetitions share tasks; sample SD is not a confidence interval. Validation feedback must not be reused as unseen evaluation. No automatic release.',
  });
}
