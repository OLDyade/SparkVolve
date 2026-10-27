import { z } from 'zod';

export const Digest = z.string().regex(/^[a-f0-9]{64}$/);
export const Id = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,95}$/);
export const RelativePath = z
  .string()
  .min(1)
  .refine(
    (value) =>
      !value.startsWith('/') &&
      !value.includes('\\') &&
      value.split('/').every((p) => p !== '..' && p !== '.' && p !== ''),
    'Expected a confined relative path',
  );
export const Image = z.string().regex(/^(sha256:[a-f0-9]{64}|[^\s]+@sha256:[a-f0-9]{64})$/);
export const BuildIdentity = z.strictObject({
  artifactDigest: Digest,
  bundleDigest: Digest,
  tarballDigest: Digest,
  lockDigest: Digest,
  image: Image,
});
export const Model = z.strictObject({
  provider: z.string().min(1),
  model: z.string().min(1),
  reasoningEffort: z.string().min(1).nullable(),
  maxTokens: z.number().int().positive(),
  credentialEnv: z.array(z.string().regex(/^[A-Z][A-Z0-9_]*$/)),
});
export const Task = z.strictObject({
  id: Id,
  prompt: z.string().min(1),
  input: RelativePath,
  inputDigest: Digest,
  evaluation: RelativePath,
  evaluationDigest: Digest,
});
export const BundleRef = z.strictObject({ directory: RelativePath, digest: Digest, patch: RelativePath });
export const Experiment = z
  .strictObject({
    name: Id,
    objective: z.string().min(1),
    purpose: z.enum(['search', 'validation']),
    runtime: z.strictObject({
      image: Image,
      dshVersion: z.literal('0.2.1-rc.4'),
      profile: z.enum(['sdk', 'sdk-minimal']),
      environment: z
        .strictObject({ directory: RelativePath, digest: Digest, patch: RelativePath })
        .nullable(),
    }),
    executor: Model,
    optimizer: Model,
    optimizerHarness: z.strictObject({ directory: RelativePath, digest: Digest, composition: RelativePath }),
    evaluator: z.strictObject({
      image: Image,
      command: z.array(z.string()).min(1),
      timeoutSeconds: z.number().positive(),
    }),
    candidate: z.strictObject({
      patch: RelativePath,
      build: z.strictObject({
        image: Image,
        network: z.enum(['none', 'bridge']),
        timeoutSeconds: z.number().int().positive(),
      }),
      qa: z.array(z.string()).min(1),
    }),
    tasks: z.array(Task).min(1),
    repetitions: z.number().int().positive(),
    concurrency: z.number().int().positive(),
    timeoutSeconds: z.number().int().positive(),
    failureLimit: z.number().int().nonnegative(),
    budget: z.strictObject({
      candidates: z.number().int().positive(),
      optimizerSeconds: z.number().int().positive(),
    }),
    metric: z.strictObject({
      name: Id,
      direction: z.enum(['maximize', 'minimize']),
      minimum: z.number(),
      maximum: z.number(),
      failure: z.number(),
    }),
  })
  .superRefine((spec, ctx) => {
    if (new Set(spec.tasks.map((t) => t.id)).size !== spec.tasks.length)
      ctx.addIssue({ code: 'custom', message: 'Duplicate task IDs' });
    if (
      spec.metric.minimum >= spec.metric.maximum ||
      spec.metric.failure < spec.metric.minimum ||
      spec.metric.failure > spec.metric.maximum
    )
      ctx.addIssue({ code: 'custom', message: 'Invalid metric bounds' });
    if (spec.failureLimit >= spec.tasks.length * spec.repetitions)
      ctx.addIssue({ code: 'custom', message: 'Failure limit must leave at least one successful execution' });
    if (spec.purpose === 'validation' && spec.budget.candidates !== 1)
      ctx.addIssue({
        code: 'custom',
        message: 'Validation admits one frozen candidate and exposes no optimizer feedback endpoint',
      });
    const publicRoots = [
      ...spec.tasks.map((t) => t.input),
      spec.optimizerHarness.directory,
      ...(spec.runtime.environment ? [spec.runtime.environment.directory] : []),
    ];
    if (
      publicRoots.some((input) =>
        spec.tasks.some(
          (t) =>
            input === t.evaluation ||
            input.startsWith(`${t.evaluation}/`) ||
            t.evaluation.startsWith(`${input}/`),
        ),
      )
    )
      ctx.addIssue({
        code: 'custom',
        message: 'Public mounts and evaluation-private directories must be disjoint',
      });
  });
export const Proposal = z.strictObject({
  draft: Id,
  parents: z.array(Digest),
  actions: z.array(z.enum(['enable', 'disable', 'tune', 'swap', 'compose', 'author'])).min(1),
  evidence: z.array(z.string().min(1)).min(1),
  hypothesis: z.string().min(1),
  expectedChange: z.string().min(1),
});
export const Grade = z.strictObject({
  score: z.number().finite(),
  metrics: z.record(z.string(), z.number().finite()),
  feedback: z.string(),
});
export type ExperimentSpec = z.infer<typeof Experiment>;
export type ModelSpec = z.infer<typeof Model>;
export type TaskSpec = z.infer<typeof Task>;
export type CandidateProposal = z.infer<typeof Proposal>;
export type GradeResult = z.infer<typeof Grade>;
export type RunPhase =
  | 'queued'
  | 'executing'
  | 'execution_failed'
  | 'delivered'
  | 'scoring'
  | 'scoring_failed'
  | 'scored'
  | 'cancelled';
export interface TaskRun {
  id: string;
  candidate: string;
  task: string;
  repetition: number;
  attempt: number;
  phase: RunPhase;
  container: string;
  gradeContainer: string;
  startedAt?: string;
  completedAt?: string;
  error?: string;
  grade?: GradeResult;
  deliveryDigest?: string;
  gradeAttempt: number;
}
export interface Candidate {
  digest: string;
  proposal: CandidateProposal;
  phase: 'frozen' | 'build_failed' | 'qa_failed' | 'running' | 'rejected' | 'champion';
  ordinal: number;
  build?: z.infer<typeof BuildIdentity>;
  buildError?: string;
  qaError?: string;
  mean?: number;
}
