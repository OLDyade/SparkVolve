import { z } from 'zod';
import { isIP } from 'node:net';
import ipaddr from 'ipaddr.js';
import { EgressRoute } from './egress.js';
import { controlPaths } from './control-routes.js';
import { EgressPool, poolCapacity, ipv4Range } from './ip-pool.js';

/** Default elapsed task budget; parsed contracts persist the effective value. */
export const DEFAULT_TASK_TIMEOUT_SECONDS = 600;

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
export const BuildContract = z.strictObject({ image: Image, timeoutSeconds: z.number().int().positive() });
export const OptimizerHarness = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('source'),
    source: z.strictObject({ directory: RelativePath, digest: Digest }),
    composition: RelativePath,
    build: BuildContract,
  }),
  z.strictObject({
    kind: z.literal('artifact'),
    source: z.strictObject({ directory: RelativePath, digest: Digest }),
    composition: RelativePath,
    artifact: z.strictObject({ directory: RelativePath, identity: BuildIdentity }),
  }),
]);
export const PreparedOptimizer = z.strictObject({
  sourceDigest: Digest,
  build: BuildIdentity,
  composition: RelativePath,
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
export const EgressDns = z
  .array(
    z
      .string()
      .refine(
        (value) =>
          isIP(value) === 4 &&
          value !== '0.0.0.0' &&
          !['loopback', 'multicast', 'broadcast'].includes(ipaddr.parse(value).range()),
        'DNS requires a literal IPv4 server outside loopback, unspecified, multicast and broadcast ranges',
      ),
  )
  .min(1)
  .max(3, 'The Linux system resolver supports at most three nameservers')
  .refine((servers) => new Set(servers).size === servers.length, 'Duplicate DNS server');
export const Isolation = z
  .strictObject({
    runtime: Id,
    user: z.strictObject({ uid: z.number().int().positive(), gid: z.number().int().nonnegative() }),
    memoryMiB: z.number().int().positive().max(1_048_576),
    cpus: z.number().positive().max(1024).multipleOf(0.001),
    pids: z.number().int().positive().max(1_048_576),
    tmpMiB: z.number().int().positive().max(1_048_576),
    homeMiB: z.number().int().positive().max(1_048_576),
    network: z.strictObject({
      egressPool: EgressPool,
      egressDns: EgressDns,
      optimizer: z.literal('controlled'),
      executor: z.enum(['controlled', 'none']),
      build: z.enum(['bridge', 'none']),
      qa: z.literal('none'),
      evaluator: z.literal('none'),
    }),
  })
  .superRefine((spec, ctx) => {
    if (!EgressPool.safeParse(spec.network.egressPool).success) return;
    const pool = ipv4Range(spec.network.egressPool);
    for (const server of spec.network.egressDns) {
      if (isIP(server) !== 4) continue;
      const address = ipv4Range(`${server}/32`).first;
      if (address >= pool.first && address <= pool.last)
        ctx.addIssue({
          code: 'custom',
          path: ['network', 'egressDns'],
          message: 'DNS server overlaps the egress address pool',
        });
    }
  });
export type IsolationSpec = z.infer<typeof Isolation>;
export const OutcomeConstraint = z.strictObject({
  id: Id,
  metric: Id,
  aggregation: z.enum(['each', 'mean']),
  operator: z.enum(['gte', 'lte']),
  threshold: z.number().finite(),
});
export type OutcomeConstraintSpec = z.infer<typeof OutcomeConstraint>;
/** Frozen host authority; the optimizer cannot alter its own feedback permissions. */
export const HostSearchProtocol = z.strictObject({
  ancestry: z.enum(['unrestricted', 'seed-only']),
  feedback: z.enum(['full', 'mechanical']),
  /** Optional fixed development subset; unsampled tasks never acquire invented scores. */
  screening: z
    .strictObject({
      tasks: z
        .array(Id)
        .min(1)
        .refine((ids) => new Set(ids).size === ids.length, 'Duplicate screening task'),
      minimumBaselineDelta: z.number().finite(),
    })
    .optional(),
  /** Exact source files editable relative to H0; omitted means unrestricted source evolution. */
  editableFiles: z
    .array(RelativePath)
    .min(1)
    .refine((files) => new Set(files).size === files.length, 'Duplicate editable file')
    .optional(),
});
export type HostSearchProtocolSpec = z.infer<typeof HostSearchProtocol>;
export const Experiment = z
  .strictObject({
    name: Id,
    objective: z.string().min(1),
    purpose: z.enum(['search', 'validation']),
    hostSearchProtocol: HostSearchProtocol,
    isolation: Isolation,
    egress: z.strictObject({ optimizer: z.array(EgressRoute), executor: z.array(EgressRoute) }),
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
    optimizerHarness: OptimizerHarness,
    researchLibrary: z.strictObject({ directory: RelativePath, digest: Digest }).nullable(),
    capabilities: z
      .strictObject({ directory: RelativePath, digest: Digest, resolutionLimit: z.number().int().positive() })
      .nullable(),
    evaluator: z.strictObject({
      image: Image,
      command: z.array(z.string()).min(1),
      timeoutSeconds: z.number().positive(),
    }),
    candidate: z.strictObject({
      patch: RelativePath,
      build: BuildContract,
      qa: z.strictObject({ directory: RelativePath, digest: Digest, entry: RelativePath }).nullable(),
    }),
    tasks: z.array(Task).min(1),
    repetitions: z.number().int().positive(),
    concurrency: z.number().int().positive(),
    timeoutSeconds: z.number().int().positive().default(DEFAULT_TASK_TIMEOUT_SECONDS),
    failureLimit: z.number().int().nonnegative(),
    budget: z.strictObject({
      candidates: z.number().int().positive(),
      optimizerSeconds: z.number().int().positive(),
    }),
    probes: z
      .strictObject({ limit: z.number().int().positive(), timeoutSeconds: z.number().int().positive() })
      .nullable(),
    metric: z.strictObject({
      name: Id,
      direction: z.enum(['maximize', 'minimize']),
      minimum: z.number(),
      maximum: z.number(),
      failure: z.number(),
    }),
    constraints: z.array(OutcomeConstraint),
  })
  .superRefine((spec, ctx) => {
    if (spec.hostSearchProtocol.feedback === 'mechanical' && spec.hostSearchProtocol.ancestry !== 'seed-only')
      ctx.addIssue({ code: 'custom', message: 'Mechanical feedback requires seed-only ancestry' });
    if (
      spec.hostSearchProtocol.ancestry === 'seed-only' &&
      (spec.probes !== null || spec.researchLibrary !== null || spec.candidate.qa !== null)
    )
      ctx.addIssue({
        code: 'custom',
        message: 'Seed-only protocol requires probes, researchLibrary and domain QA to be null',
      });
    const screening = spec.hostSearchProtocol.screening;
    if (
      screening &&
      (spec.purpose !== 'search' ||
        spec.hostSearchProtocol.feedback !== 'full' ||
        screening.tasks.length >= spec.tasks.length ||
        screening.tasks.some((id) => !spec.tasks.some((task) => task.id === id)))
    )
      ctx.addIssue({
        code: 'custom',
        message: 'Screening requires a proper subset of registered search tasks',
      });
    const slots = 2 * (1 + (spec.isolation.network.executor === 'controlled' ? spec.concurrency : 0));
    if (poolCapacity(spec.isolation.network.egressPool) < slots)
      ctx.addIssue({
        code: 'custom',
        message: `Egress pool needs at least ${slots} /29 leases for executor concurrency plus optimizer`,
      });
    for (const role of ['optimizer', 'executor'] as const) {
      const routes = spec.egress[role];
      if (
        new Set(routes.map((r) => r.id)).size !== routes.length ||
        new Set(routes.map((r) => `${r.method} ${r.path}`)).size !== routes.length
      )
        ctx.addIssue({ code: 'custom', message: `Duplicate ${role} egress route` });
      const credentials = new Set(routes.flatMap((r) => (r.credential ? [r.credential.env] : [])));
      if (spec[role].credentialEnv.some((key) => !credentials.has(key)))
        ctx.addIssue({ code: 'custom', message: `${role} credential has no trusted egress route` });
    }
    if (
      spec.egress.optimizer.some(
        (r) => controlPaths.some((p) => p === r.path) || r.credential?.env === 'SPARKVOLVE_TOKEN',
      )
    )
      ctx.addIssue({ code: 'custom', message: 'Optimizer routes cannot shadow the controller capability' });
    if (spec.isolation.network.executor === 'controlled' && !spec.egress.executor.length)
      ctx.addIssue({ code: 'custom', message: 'Controlled executor requires explicit egress routes' });
    if (spec.isolation.network.executor === 'none' && spec.egress.executor.length)
      ctx.addIssue({ code: 'custom', message: 'Offline executor cannot declare egress routes' });
    if (new Set(spec.tasks.map((t) => t.id)).size !== spec.tasks.length)
      ctx.addIssue({ code: 'custom', message: 'Duplicate task IDs' });
    if (new Set(spec.constraints.map((c) => c.id)).size !== spec.constraints.length)
      ctx.addIssue({ code: 'custom', message: 'Duplicate constraint IDs' });
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
    if (spec.purpose === 'validation' && spec.probes !== null)
      ctx.addIssue({ code: 'custom', message: 'Validation does not authorize optimizer probes' });
    const publicRoots = [
      ...spec.tasks.map((t) => t.input),
      spec.optimizerHarness.source.directory,
      ...(spec.optimizerHarness.kind === 'artifact' ? [spec.optimizerHarness.artifact.directory] : []),
      ...(spec.researchLibrary ? [spec.researchLibrary.directory] : []),
      ...(spec.capabilities ? [spec.capabilities.directory] : []),
      ...(spec.runtime.environment ? [spec.runtime.environment.directory] : []),
      ...(spec.candidate.qa ? [spec.candidate.qa.directory] : []),
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
export const ProbeRequest = z.strictObject({
  draft: Id,
  suite: Id,
  entry: RelativePath,
  hypothesis: z.string().min(1),
});
export interface Probe {
  id: string;
  request: z.infer<typeof ProbeRequest>;
  sourceDigest: string;
  suiteDigest: string;
  phase: 'queued' | 'passed' | 'failed';
  queuedAt: string;
  completedAt?: string;
  build?: z.infer<typeof BuildIdentity>;
  error?: string;
  exitCode?: number;
  executionMilliseconds?: number;
}
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
  | 'screened_out'
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
  phase: 'frozen' | 'build_failed' | 'qa_failed' | 'running' | 'rejected' | 'champion' | 'screened_out';
  ordinal: number;
  build?: z.infer<typeof BuildIdentity>;
  buildError?: string;
  qaError?: string;
  mean?: number;
  origin?: { archiveId: string; recordDigest: string; sourceCandidate: string };
}
