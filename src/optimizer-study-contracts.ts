import { z } from 'zod';
import { BuildIdentity, Digest, Experiment, Id, Isolation, Model, RelativePath } from './contracts.js';
import { canonical, digest } from './artifacts.js';
import { EgressRoute } from './egress.js';
import { controlPaths } from './control-routes.js';
import { studyPaths } from './study-paths.js';

/** Locations are relative to the trusted study input root; identities exclude those locations. */
export const FrozenStudyBundle = z.strictObject({
  source: z.strictObject({ directory: RelativePath, digest: Digest }),
  artifact: z.strictObject({ directory: RelativePath, identity: BuildIdentity }),
});
export const FrozenStudyMethod = FrozenStudyBundle.extend({ composition: RelativePath });
export type FrozenStudyBundleRef = z.infer<typeof FrozenStudyBundle>;
export type FrozenStudyMethodRef = z.infer<typeof FrozenStudyMethod>;

export function studyMethodIdentity(method: FrozenStudyMethodRef): string {
  return digest({
    sourceDigest: method.source.digest,
    build: method.artifact.identity,
    composition: method.composition,
  });
}
export function studyMethodCandidateIdentity(sourceDigest: string, composition: string): string {
  return digest({ sourceDigest: Digest.parse(sourceDigest), composition: RelativePath.parse(composition) });
}

const FrozenExperiment = z.strictObject({
  specification: Experiment,
  dataset: z.strictObject({ directory: RelativePath, digest: Digest }),
});
export const OptimizerSearchCase = z.strictObject({
  id: Id,
  seed: FrozenStudyBundle,
  search: FrozenExperiment,
  assessment: FrozenExperiment,
});
export type OptimizerSearchCaseSpec = z.infer<typeof OptimizerSearchCase>;
export const StudyStage = z.enum(['development', 'validation']);
export type StudyStageName = z.infer<typeof StudyStage>;

export const OptimizerStudy = z
  .strictObject({
    name: Id,
    objective: z.string().min(1),
    baseline: FrozenStudyMethod,
    metaOptimizer: FrozenStudyMethod,
    metaRuntime: z.strictObject({
      runtime: Experiment.shape.runtime,
      model: Model,
      isolation: Isolation,
      egress: z.array(EgressRoute),
    }),
    methodBuild: z.strictObject({
      image: Experiment.shape.runtime.shape.image,
      timeoutSeconds: z.number().int().positive(),
    }),
    methodQA: z.strictObject({ directory: RelativePath, digest: Digest, entry: RelativePath }).nullable(),
    developmentCases: z.array(OptimizerSearchCase).min(1),
    validationCases: z.array(OptimizerSearchCase).min(1),
    repetitions: z.number().int().positive(),
    budget: z.strictObject({
      methodCandidates: z.number().int().min(2),
      metaOptimizerSeconds: z.number().int().positive(),
      concurrentSearches: z.number().int().positive(),
    }),
    selection: z.strictObject({ failureLimit: z.number().int().nonnegative() }),
  })
  .superRefine((spec, ctx) => {
    const routes = spec.metaRuntime.egress;
    if (
      new Set(routes.map((route) => route.id)).size !== routes.length ||
      new Set(routes.map((route) => `${route.method} ${route.path}`)).size !== routes.length
    )
      ctx.addIssue({ code: 'custom', message: 'Duplicate meta optimizer egress route' });
    const credentials = new Set(routes.flatMap((route) => (route.credential ? [route.credential.env] : [])));
    if (spec.metaRuntime.model.credentialEnv.some((name) => !credentials.has(name)))
      ctx.addIssue({ code: 'custom', message: 'Meta optimizer credential has no trusted egress route' });
    if (
      routes.some(
        (route) =>
          route.credential?.env === 'EVOLUTION_TOKEN' ||
          [...controlPaths, ...studyPaths].some((reserved) => reserved === route.path),
      )
    )
      ctx.addIssue({
        code: 'custom',
        message: 'Meta optimizer routes cannot shadow the controller capability',
      });
    const ids = [...spec.developmentCases, ...spec.validationCases].map((item) => item.id);
    if (new Set(ids).size !== ids.length)
      ctx.addIssue({
        code: 'custom',
        message: 'Study case IDs must be unique across development and validation',
      });
    const metric = spec.developmentCases[0]!.assessment.specification.metric;
    const overlaps = (left: string, right: string) =>
      left === right || left.startsWith(right + '/') || right.startsWith(left + '/');
    const cases = [...spec.developmentCases, ...spec.validationCases];
    const publicRoots = [
      spec.baseline.source.directory,
      spec.baseline.artifact.directory,
      spec.metaOptimizer.source.directory,
      spec.metaOptimizer.artifact.directory,
      ...(spec.metaRuntime.runtime.environment ? [spec.metaRuntime.runtime.environment.directory] : []),
      ...(spec.methodQA ? [spec.methodQA.directory] : []),
      ...cases.flatMap((item) => [item.seed.source.directory, item.seed.artifact.directory]),
    ];
    const sealedRoots = [
      ...cases.map((item) => item.assessment.dataset.directory),
      ...spec.validationCases.map((item) => item.search.dataset.directory),
    ];
    if (publicRoots.some((publicRoot) => sealedRoots.some((sealedRoot) => overlaps(publicRoot, sealedRoot))))
      ctx.addIssue({
        code: 'custom',
        message: 'Public study mounts must be disjoint from all sealed search and assessment datasets',
      });
    for (const item of [...spec.developmentCases, ...spec.validationCases]) {
      if (
        item.search.specification.purpose !== 'search' ||
        item.assessment.specification.purpose !== 'validation'
      )
        ctx.addIssue({
          code: 'custom',
          message: `Case ${item.id} must pair a search and an independent validation contract`,
        });
      if (canonical(item.assessment.specification.metric) !== canonical(metric))
        ctx.addIssue({
          code: 'custom',
          message: 'Study assessments require the same metric definition and failure value',
        });
      if (
        item.search.dataset.directory === item.assessment.dataset.directory ||
        item.search.dataset.directory.startsWith(item.assessment.dataset.directory + '/') ||
        item.assessment.dataset.directory.startsWith(item.search.dataset.directory + '/')
      )
        ctx.addIssue({
          code: 'custom',
          message: `Case ${item.id} search and assessment datasets must be disjoint`,
        });
    }
    const denominator =
      Math.min(spec.developmentCases.length, spec.validationCases.length) * spec.repetitions;
    if (spec.selection.failureLimit >= denominator)
      ctx.addIssue({
        code: 'custom',
        message: 'Study failure limit must leave at least one successful search instance per stage',
      });
    for (const [key, value] of Object.entries(studyAllocationCeiling(spec)))
      if (!Number.isSafeInteger(value))
        ctx.addIssue({ code: 'custom', message: `Study allocation ${key} exceeds exact integer accounting` });
  });
export type OptimizerStudySpec = z.infer<typeof OptimizerStudy>;

export interface StudyAllocation {
  candidates: number;
  probes: number;
  optimizerSeconds: number;
  searchTasks: number;
  assessmentTasks: number;
}
/** Fixed per-instance allocation, derived from the registered child contracts, never model supplied. */
export function studyJobAllocation(item: OptimizerSearchCaseSpec): StudyAllocation {
  const search = item.search.specification,
    assessment = item.assessment.specification;
  return {
    candidates: search.budget.candidates,
    probes: search.probes?.limit ?? 0,
    optimizerSeconds: search.budget.optimizerSeconds,
    searchTasks: search.budget.candidates * search.tasks.length * search.repetitions,
    assessmentTasks: assessment.tasks.length * assessment.repetitions,
  };
}
export function studyAllocationCeiling(spec: {
  developmentCases: OptimizerSearchCaseSpec[];
  validationCases: OptimizerSearchCaseSpec[];
  repetitions: number;
  budget: { methodCandidates: number };
}): StudyAllocation {
  const total: StudyAllocation = {
    candidates: 0,
    probes: 0,
    optimizerSeconds: 0,
    searchTasks: 0,
    assessmentTasks: 0,
  };
  for (const [cases, methods] of [
    [spec.developmentCases, spec.budget.methodCandidates],
    [spec.validationCases, 2],
  ] as const)
    for (const item of cases) {
      const allocation = studyJobAllocation(item);
      for (const key of Object.keys(total) as Array<keyof StudyAllocation>)
        total[key] += allocation[key] * methods * spec.repetitions;
    }
  return total;
}
