import { chmod, cp, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { channel } from 'node:diagnostics_channel';
import { setTimeout as delay } from 'node:timers/promises';
import { EventCursor, type EventPage } from './events.js';
import { atomicJSON, confined, digest, fileDigest, freeze, inventory, treeDigest } from './artifacts.js';
import { Experiment, Id, Proposal, RelativePath, type ExperimentSpec } from './contracts.js';
import { Docker, readJSON, type ContainerSpec } from './docker.js';
import { verifyArtifact, verifyBuild } from './build.js';
import { Controller } from './controller.js';
import { prepareExperiment, evolve } from './experiment.js';
import { prepareOptimizer, type OptimizerPreparationSpec } from './optimizer-harness.js';
import { collectExecution, prepareExecution, ReclamationError, settleExecutionFailure } from './execution.js';
import { Store } from './store.js';
import { validateFrozenArm } from './validation.js';
import {
  RegisteredOptimizerStudy,
  developmentStudy,
  isFixedComparison,
  studyCases,
  registeredStudyMethods,
  studyMethodIdentity,
  studyArmIdentity,
  type FrozenStudyBundleRef,
  type FrozenStudyMethodRef,
  type RegisteredOptimizerStudySpec,
  type StudyStageName,
} from './optimizer-study-contracts.js';
import { OptimizerStudyStore, type StudyJob, type StudyMethodCandidate } from './optimizer-study-store.js';
import { StudyBranchReceipt, type StudyBranchResult } from './study-control.js';

export interface StudyTransport {
  host: string;
  port: number;
  endpoint: string;
}
const done = new Set(['complete', 'failed', 'cancelled']);
const branchPublications = channel('harness-evolution:study-branch');
function requiresReclamation(error: unknown): boolean {
  return (
    error instanceof ReclamationError ||
    (error instanceof AggregateError && error.errors.some(requiresReclamation)) ||
    (error instanceof Error && error.cause !== undefined && requiresReclamation(error.cause))
  );
}
async function removeStaging(directory: string): Promise<void> {
  const writable = async (root: string): Promise<void> => {
    await chmod(root, 0o755);
    for (const item of await readdir(root, { withFileTypes: true }))
      if (item.isDirectory()) await writable(path.join(root, item.name));
  };
  await writable(directory);
  await rm(directory, { recursive: true });
}

async function verifyBundle(root: string, bundle: FrozenStudyBundleRef): Promise<void> {
  const source = confined(root, bundle.source.directory);
  if ((await treeDigest(source)) !== bundle.source.digest) throw Error('Study bundle source digest mismatch');
  await verifyArtifact(
    confined(root, bundle.artifact.directory),
    bundle.source.digest,
    bundle.artifact.identity,
  );
  if ((await fileDigest(path.join(source, 'package-lock.json'))) !== bundle.artifact.identity.lockDigest)
    throw Error('Study bundle source lock differs from frozen artifact');
}

/** Register before publishing. The complete input snapshot is host-private; no meta worker mounts it. */
export async function prepareOptimizerStudy(
  root: string,
  raw: unknown,
  inputs: string,
): Promise<RegisteredOptimizerStudySpec> {
  const spec = RegisteredOptimizerStudy.parse(raw);
  inputs = await realpath(inputs);
  await mkdir(root, { recursive: true });
  const entries = await readdir(root);
  if (entries.length && !entries.includes('study.sqlite'))
    throw Error('Existing study directory has no registration ledger');
  const store = new OptimizerStudyStore(path.join(root, 'study.sqlite'), spec);
  try {
    const frozen = path.join(root, 'inputs');
    let prepared = false;
    try {
      const existing = await readJSON(path.join(root, 'registration.json'));
      if (digest(existing) !== store.registrationDigest) throw Error('Study registration snapshot mismatch');
      prepared = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    if (prepared) {
      const expected = await readJSON(path.join(root, 'inputs-digest.json'));
      if (expected !== (await treeDigest(inputs)) || expected !== (await treeDigest(frozen)))
        throw Error('Prepared study input snapshot changed');
    } else {
      const published = await freeze(inputs, frozen, path.join(root, 'publications'));
      await atomicJSON(path.join(root, 'inputs-digest.json'), published);
    }
    for (const method of registeredStudyMethods(spec)) await verifyBundle(frozen, method);
    const environment = isFixedComparison(spec) ? null : spec.metaRuntime.runtime.environment;
    if (environment && (await treeDigest(confined(frozen, environment.directory))) !== environment.digest)
      throw Error('Study meta runtime environment digest mismatch');
    if (
      !isFixedComparison(spec) &&
      spec.methodQA &&
      (await treeDigest(confined(frozen, spec.methodQA.directory))) !== spec.methodQA.digest
    )
      throw Error('Study method QA digest mismatch');
    for (const item of studyCases(spec)) {
      await verifyBundle(frozen, item.seed);
      for (const registration of [item.search, item.assessment])
        if (
          (await treeDigest(confined(frozen, registration.dataset.directory))) !== registration.dataset.digest
        )
          throw Error(`Study dataset digest mismatch: ${item.id}`);
    }
    await atomicJSON(path.join(root, 'registration.json'), spec);
  } finally {
    store.close();
  }
  return spec;
}

/** Host orchestration only. Every search is the production Controller/DSH path; no task-result callback. */
export class OptimizerStudyCoordinator {
  readonly owner = randomUUID();
  private heartbeat?: ReturnType<typeof setInterval>;
  private readonly lifetime = new AbortController();
  private readonly submissions = new Map<string, Promise<StudyMethodCandidate>>();
  private pumping: Promise<void> | undefined;
  private admission: Promise<void> = Promise.resolve();
  private evaluation: Promise<unknown> = Promise.resolve();
  constructor(
    readonly root: string,
    readonly store: OptimizerStudyStore,
    readonly docker = new Docker(),
  ) {}
  get spec(): RegisteredOptimizerStudySpec {
    return this.store.spec;
  }
  get inputs(): string {
    return path.join(this.root, 'inputs');
  }
  async start(): Promise<void> {
    if (['cancelling', 'cancelled'].includes(this.store.state().phase))
      throw Error('Cancelled study cannot start');
    const registration = await readJSON(path.join(this.root, 'registration.json'));
    if (digest(registration) !== this.store.registrationDigest)
      throw Error('Study registration snapshot mismatch');
    if ((await treeDigest(this.inputs)) !== (await readJSON(path.join(this.root, 'inputs-digest.json'))))
      throw Error('Prepared study input snapshot changed');
    this.store.acquire(this.owner, Date.now(), 30_000);
    this.heartbeat = setInterval(() => {
      try {
        this.store.assertLease(this.owner);
        this.store.acquire(this.owner, Date.now(), 30_000);
      } catch (error) {
        this.lifetime.abort(error);
      }
    }, 5_000);
  }
  async close(): Promise<void> {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.store.release(this.owner);
  }
  private signal(signal?: AbortSignal): AbortSignal {
    this.store.assertLease(this.owner);
    return signal ? AbortSignal.any([signal, this.lifetime.signal]) : this.lifetime.signal;
  }
  private admit<T>(action: () => Promise<T>): Promise<T> {
    const operation = this.admission.then(action);
    this.admission = operation.then(
      () => {},
      () => {},
    );
    return operation;
  }
  private methodRoot(method: FrozenStudyMethodRef): string {
    const id = studyMethodIdentity(method);
    return registeredStudyMethods(this.spec).some((registered) => id === studyMethodIdentity(registered))
      ? this.inputs
      : this.root;
  }
  private preparation(method: ExperimentSpec['optimizerHarness']): OptimizerPreparationSpec {
    const spec = developmentStudy(this.spec);
    return {
      optimizerHarness: method,
      runtime: {
        ...spec.metaRuntime.runtime,
        environment: spec.metaRuntime.runtime.environment
          ? { ...spec.metaRuntime.runtime.environment, directory: 'runtime-environment' }
          : null,
      },
      optimizer: spec.metaRuntime.model,
      isolation: spec.metaRuntime.isolation,
      timeoutSeconds: spec.methodBuild.timeoutSeconds,
    };
  }
  async submitMethod(
    raw: { proposal: unknown; composition: string },
    externalSignal?: AbortSignal,
  ): Promise<StudyMethodCandidate> {
    return this.admit(() => this.submitMethodAdmission(raw, externalSignal));
  }
  private async submitMethodAdmission(
    raw: { proposal: unknown; composition: string },
    externalSignal?: AbortSignal,
  ): Promise<StudyMethodCandidate> {
    const signal = this.signal(externalSignal);
    signal.throwIfAborted();
    await this.assertDevelopmentOpen();
    const proposal = Proposal.parse(raw.proposal),
      composition = RelativePath.parse(raw.composition);
    const draft = confined(path.join(this.root, 'drafts'), proposal.draft),
      sourceDigest = await treeDigest(draft);
    const source = { directory: `methods/sources/${sourceDigest}`, digest: sourceDigest };
    const reservation = this.store.reserveMethod(this.owner, { source, composition, proposal });
    if (reservation.phase !== 'preparing') return reservation;
    const active = this.submissions.get(reservation.id);
    if (active) return active;
    const operation = this.freezeMethod(reservation, draft, signal).finally(() =>
      this.submissions.delete(reservation.id),
    );
    this.submissions.set(reservation.id, operation);
    return operation;
  }
  private async freezeMethod(reservation: StudyMethodCandidate, draft: string, signal: AbortSignal) {
    try {
      if (
        (await freeze(
          draft,
          confined(this.root, reservation.source.directory),
          path.join(this.root, 'publications'),
        )) !== reservation.source.digest
      )
        throw Error('Method draft changed while publishing');
      signal.throwIfAborted();
      return reservation;
    } catch (error) {
      signal.throwIfAborted();
      this.store.failMethod(this.owner, reservation.id, String(error));
      throw error;
    }
  }
  private async prepareMethod(
    reservation: StudyMethodCandidate,
    signal: AbortSignal,
  ): Promise<StudyMethodCandidate> {
    const spec = developmentStudy(this.spec);
    const home = path.join(this.root, 'methods', reservation.id);
    try {
      const source = confined(this.root, reservation.source.directory);
      try {
        if ((await treeDigest(source)) !== reservation.source.digest)
          throw Error('Frozen method source changed');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        await this.freezeMethod(
          reservation,
          confined(path.join(this.root, 'drafts'), reservation.proposal!.draft),
          signal,
        );
      }
      // The preparation dataset contains only source and the registered public runtime environment.
      const staging = await mkdtemp(path.join(this.root, '.method-input-'));
      try {
        await cp(confined(this.root, reservation.source.directory), path.join(staging, 'source'), {
          recursive: true,
        });
        const environment = spec.metaRuntime.runtime.environment;
        if (environment) {
          await cp(confined(this.inputs, environment.directory), path.join(staging, 'runtime-environment'), {
            recursive: true,
            errorOnExist: true,
            force: false,
          });
        }
        await freeze(staging, path.join(home, 'inputs'), path.join(this.root, 'publications'));
      } finally {
        await removeStaging(staging);
      }
      const prepared = await prepareOptimizer(
        home,
        path.join(home, 'inputs'),
        this.preparation({
          kind: 'source',
          source: { directory: 'source', digest: reservation.source.digest },
          composition: reservation.composition,
          build: spec.methodBuild,
        }),
        this.docker,
        signal,
      );
      await this.methodQA(home, prepared.sourceDigest, signal);
      return this.store.publishMethod(this.owner, reservation.id, {
        source: reservation.source,
        composition: prepared.composition,
        artifact: {
          directory: path.relative(
            this.root,
            path.join(home, 'optimizer-harness/artifacts', prepared.sourceDigest),
          ),
          identity: prepared.build,
        },
      });
    } catch (error) {
      signal.throwIfAborted();
      if (requiresReclamation(error)) throw error;
      this.store.failMethod(this.owner, reservation.id, String(error));
      throw error;
    }
  }
  private async methodQA(home: string, sourceDigest: string, signal: AbortSignal): Promise<void> {
    const spec = developmentStudy(this.spec);
    if (!spec.methodQA) return;
    const qa = path.join(home, 'method-qa');
    await mkdir(path.join(qa, 'work'), { recursive: true });
    const native = path.join(home, 'optimizer-harness/qa');
    const launch = (await readJSON(path.join(native, 'launch.json'))) as Record<string, unknown>;
    await atomicJSON(path.join(qa, 'launch.json'), {
      ...launch,
      behaviorModule: `/verification/${spec.methodQA.entry}`,
    });
    const original = (await readJSON(path.join(native, 'execution-spec.json'))) as ContainerSpec;
    const container: ContainerSpec = {
      ...original,
      name: `he-study-gqa-${digest([path.resolve(this.root), sourceDigest]).slice(0, 32)}`,
      mounts: [
        ...original.mounts.filter((mount) => !['/workspace', '/launch.json'].includes(mount.target)),
        { source: path.join(qa, 'work'), target: '/workspace', writable: true },
        { source: path.join(qa, 'launch.json'), target: '/launch.json', writable: false },
        {
          source: confined(this.inputs, spec.methodQA.directory),
          target: '/verification',
          writable: false,
        },
      ],
    };
    const identity = digest(container);
    try {
      const accepted = await readJSON(path.join(qa, 'accepted.json'));
      if (digest(accepted) !== digest({ identity })) throw Error('Method QA receipt changed');
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    const failed = await settleExecutionFailure(qa, this.docker, null);
    if (failed) throw Error(`Method QA already failed: ${failed}`);
    try {
      const execution = await prepareExecution(qa, identity, this.docker, null, async () => container, {});
      const result = await collectExecution(qa, execution, path.join(qa, 'logs'), this.docker, null, signal);
      if (result.ExitCode !== 0) throw Error(`Method behavior QA exited ${result.ExitCode}`);
      await atomicJSON(path.join(qa, 'accepted.json'), { identity });
    } catch (error) {
      signal.throwIfAborted();
      await settleExecutionFailure(qa, this.docker, null, error);
      throw error;
    }
  }
  private ready(method: string): FrozenStudyMethodRef {
    const candidate = this.store
      .methods()
      .find((entry) => entry.methodIdentity === method && entry.phase === 'ready');
    if (!candidate?.method) throw Error('Unknown frozen optimizer method');
    return candidate.method;
  }
  private async assertDevelopmentOpen() {
    this.signal().throwIfAborted();
    if (this.store.state().phase !== 'developing') throw Error('Development access is closed');
    try {
      await readFile(path.join(this.root, 'development-conclusion.json'));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw error;
    }
    throw Error('Development has already concluded');
  }
  async branch(parent: string, draft: string): Promise<StudyBranchResult> {
    return this.admit(() => this.branchAdmission(parent, draft));
  }
  private async branchAdmission(parent: string, draft: string): Promise<StudyBranchResult> {
    await this.assertDevelopmentOpen();
    draft = Id.parse(draft);
    const candidate = this.store.method(parent);
    if (candidate.phase !== 'ready' || !candidate.method)
      throw Error('Method branch requires a ready frozen parent');
    const target = confined(path.join(this.root, 'drafts'), RelativePath.parse(draft));
    const source = confined(this.methodRoot(candidate.method), candidate.method.source.directory);
    if ((await treeDigest(source)) !== candidate.source.digest) throw Error('Branch parent source changed');
    await mkdir(path.join(this.root, 'draft-origins'), { recursive: true });
    const origin = { draft, parent: candidate.id, sourceDigest: candidate.source.digest };
    const db = new DatabaseSync(path.join(this.root, 'draft-origins', `${digest(draft)}.sqlite`));
    const directories = async (dir: string): Promise<void> => {
      await chmod(dir, 0o755);
      for (const entry of await readdir(dir, { withFileTypes: true }))
        if (entry.isDirectory()) await directories(path.join(dir, entry.name));
    };
    try {
      db.exec(
        'CREATE TABLE IF NOT EXISTS origin(id INTEGER PRIMARY KEY CHECK(id=1),identity TEXT NOT NULL,staging TEXT NOT NULL,phase TEXT NOT NULL); BEGIN IMMEDIATE;',
      );
      db.prepare('INSERT OR IGNORE INTO origin VALUES(1,?,?,?)').run(
        digest(origin),
        `${target}.${randomUUID()}.staging`,
        'preparing',
      );
      db.exec('COMMIT; BEGIN IMMEDIATE;');
      branchPublications.publish({ root: this.root, draft, phase: 'reserved' });
      const record = db.prepare('SELECT * FROM origin WHERE id=1').get() as {
        identity: string;
        staging: string;
        phase: string;
      };
      if (record.identity !== digest(origin)) throw Error('Draft origin changed');
      let present = false;
      try {
        const stat = await lstat(target);
        if (!stat.isDirectory() || stat.isSymbolicLink()) throw Error('Draft destination is not a directory');
        present = true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      if (record.phase === 'published') {
        if (!present) throw Error('Published editable draft is missing');
      } else {
        if (present) {
          if ((await treeDigest(target)) !== candidate.source.digest)
            throw Error('Uncommitted draft content changed');
        } else {
          await mkdir(path.dirname(target), { recursive: true });
          try {
            await directories(record.staging);
            await rm(record.staging, { recursive: true });
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
          }
          await cp(source, record.staging, { recursive: true });
          await directories(record.staging);
          for (const entry of await inventory(record.staging))
            await chmod(confined(record.staging, entry.path), entry.executable ? 0o755 : 0o644);
          if ((await treeDigest(record.staging)) !== candidate.source.digest)
            throw Error('Draft source changed during publication');
          await rename(record.staging, target);
          branchPublications.publish({ root: this.root, draft, phase: 'published' });
        }
        await atomicJSON(path.join(this.root, 'draft-origins', `${digest(draft)}.json`), origin);
        db.exec("UPDATE origin SET phase='published' WHERE id=1;");
      }
      db.exec('COMMIT;');
    } finally {
      if (db.isTransaction) db.exec('ROLLBACK');
      db.close();
    }
    return StudyBranchReceipt.parse({
      draft,
      path: `/workspace/${draft}`,
      targetRole: 'search-optimizer',
      parent: {
        candidateId: candidate.id,
        sourceDigest: candidate.source.digest,
        methodIdentity: studyMethodIdentity(candidate.method),
        composition: candidate.method.composition,
      },
    });
  }
  pump(transport: StudyTransport, externalSignal?: AbortSignal): Promise<void> {
    if (this.pumping) return this.pumping;
    const operation = this.advance(transport, externalSignal).finally(() => {
      this.pumping = undefined;
    });
    this.pumping = operation;
    return operation;
  }
  private async advance(transport: StudyTransport, externalSignal?: AbortSignal): Promise<void> {
    const signal = this.signal(externalSignal);
    signal.throwIfAborted();
    if (this.store.state().phase !== 'developing') throw Error('Study is not accepting development work');
    await this.reconcileMethods(signal);
    for (const candidate of this.store.methods()) {
      const current = this.store.method(candidate.id);
      if (
        current.phase === 'ready' &&
        !this.store.methodReport(current.methodIdentity!, 'development').complete
      )
        await this.evaluateMethod(current.methodIdentity!, transport, signal);
    }
    await this.report();
  }
  async reconcileMethods(externalSignal?: AbortSignal): Promise<void> {
    const signal = this.signal(externalSignal);
    signal.throwIfAborted();
    if (this.store.state().phase !== 'developing') throw Error('Study is not accepting development work');
    for (const candidate of this.store.methods()) {
      if (candidate.phase === 'preparing') {
        const pending = this.submissions.get(candidate.id);
        if (pending) await pending;
        if (this.store.method(candidate.id).phase === 'preparing') {
          try {
            await this.prepareMethod(candidate, signal);
          } catch (error) {
            signal.throwIfAborted();
            if (this.store.method(candidate.id).phase !== 'failed') throw error;
          }
        }
      }
    }
  }
  async finishDevelopment(reason: string): Promise<void> {
    return this.admit(() => this.finishDevelopmentAdmission(reason));
  }
  private async finishDevelopmentAdmission(reason: string): Promise<void> {
    await this.assertDevelopmentOpen();
    if (!reason.trim()) throw Error('Development conclusion requires a reason');
    if (
      this.submissions.size ||
      this.store.methods().some((method) => method.phase === 'preparing') ||
      this.store
        .methods()
        .some(
          (method) =>
            method.phase === 'ready' &&
            !this.store.methodReport(method.methodIdentity!, 'development').complete,
        )
    )
      throw Error('Development still has pending methods or incomplete search-instance denominators');
    await atomicJSON(path.join(this.root, 'development-conclusion.json'), {
      reason,
      at: new Date().toISOString(),
      registrationDigest: this.store.registrationDigest,
    });
  }
  publicStatus() {
    if (this.store.state().phase !== 'developing') throw Error('Development access is closed');
    const spec = developmentStudy(this.spec);
    return {
      registrationDigest: this.store.registrationDigest,
      objective: this.spec.objective,
      cases: spec.developmentCases.map((item) => ({
        id: item.id,
        objective: item.search.specification.objective,
        metric: item.assessment.specification.metric,
        budget: item.search.specification.budget,
        taskCount: item.search.specification.tasks.length,
        repetitions: item.search.specification.repetitions,
      })),
      budget: this.spec.budget,
      methods: this.store.methods().map((method) => ({
        id: method.id,
        ordinal: method.ordinal,
        sourceDigest: method.source.digest,
        composition: method.composition,
        proposal: method.proposal,
        phase: method.phase,
        methodIdentity: method.methodIdentity ?? null,
        error:
          method.phase === 'failed'
            ? 'Method preparation failed; inspect the authorized method build evidence'
            : null,
      })),
      reports: this.store
        .methods()
        .filter((method) => method.phase === 'ready')
        .map((method) => this.store.methodReport(method.methodIdentity!, 'development')),
      jobs: this.store
        .jobs()
        .filter((job) => job.stage === 'development')
        .map((job) => ({
          id: job.id,
          method: job.method,
          caseId: job.caseId,
          repetition: job.repetition,
          phase: job.phase,
          allocation: job.allocation,
          result: job.result ?? null,
          error:
            job.phase === 'failed' ? 'Search instance failed; retained in the registered denominator' : null,
        })),
      metaEpisodes: this.store.metaEpisodes(),
      cursor: this.store.cursor(),
    };
  }
  async events(
    options: { cursor: EventCursor; timeoutMs: number; limit: number },
    externalSignal: AbortSignal,
  ): Promise<EventPage> {
    const signal = this.signal(externalSignal);
    if (!Number.isSafeInteger(options.timeoutMs) || options.timeoutMs < 0 || options.timeoutMs > 60_000)
      throw Error('Invalid study event wait');
    let cursor = EventCursor.parse(options.cursor);
    const deadline = Date.now() + options.timeoutMs;
    for (;;) {
      signal.throwIfAborted();
      if (this.store.state().phase !== 'developing') throw Error('Development access is closed');
      const page = this.store.page(cursor, options.limit);
      const events = page.events.flatMap((event) => {
        const body = event.body as Record<string, unknown>;
        if (event.type.startsWith('method.'))
          return [{ ...event, body: { id: body.id, phase: event.type.slice(7) } }];
        if (event.type.startsWith('job.') && typeof body.id === 'string') {
          const job = this.store.job(body.id);
          if (job.stage !== 'development') return [];
          return [
            {
              ...event,
              body: {
                id: job.id,
                method: job.method,
                caseId: job.caseId,
                repetition: job.repetition,
                phase: event.type.slice(4),
              },
            },
          ];
        }
        return [];
      });
      cursor = page.cursor;
      if (events.length || page.hasMore || Date.now() >= deadline) return { ...page, events };
      await delay(Math.min(100, Math.max(1, deadline - Date.now())), undefined, { signal });
    }
  }
  /** Serializes method batches, while each batch runs at the registered search-instance concurrency. */
  evaluateMethod(method: string, transport: StudyTransport, externalSignal?: AbortSignal) {
    const operation = this.evaluation.then(() =>
      this.evaluate({ method, comparisonArm: null }, 'development', transport, externalSignal),
    );
    this.evaluation = operation.catch(() => {});
    return operation;
  }
  private async evaluate(
    target: { method: string; comparisonArm: string | null },
    stage: StudyStageName,
    transport: StudyTransport,
    externalSignal?: AbortSignal,
  ) {
    const { method, comparisonArm } = target;
    const signal = this.signal(externalSignal);
    signal.throwIfAborted();
    this.ready(method);
    const cases = studyCases(this.spec, stage);
    const jobs = cases.flatMap((item) =>
      Array.from({ length: this.spec.repetitions }, (_, repetition) =>
        this.store.reserveJob(this.owner, { stage, method, comparisonArm, caseId: item.id, repetition }),
      ),
    );
    jobs.sort((a, b) => Number(b.phase !== 'reserved') - Number(a.phase !== 'reserved'));
    const worker = async () => {
      for (;;) {
        signal.throwIfAborted();
        const job = jobs.shift();
        if (!job) return;
        if (!done.has(job.phase)) await this.runJob(job, transport, signal);
      }
    };
    const results = await Promise.allSettled(
      Array.from({ length: this.spec.budget.concurrentSearches }, worker),
    );
    signal.throwIfAborted();
    const errors = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected');
    await this.report();
    if (errors.length)
      throw new AggregateError(
        errors.map((error) => error.reason),
        'Study worker failed',
      );
    return comparisonArm === null
      ? this.store.methodReport(method, stage)
      : this.store.armReport(comparisonArm);
  }
  private async dataset(
    job: StudyJob,
    method: FrozenStudyMethodRef,
  ): Promise<{ directory: string; spec: ExperimentSpec }> {
    const item = studyCases(this.spec).find((item) => item.id === job.caseId)!;
    const directory = path.join(this.root, 'job-inputs', job.id);
    const staging = await mkdtemp(path.join(this.root, '.search-input-'));
    try {
      const original = confined(this.inputs, item.search.dataset.directory);
      if ((await treeDigest(original)) !== item.search.dataset.digest)
        throw Error('Registered search dataset changed');
      await cp(original, staging, { recursive: true });
      const namespace = '.optimizer-study';
      if ((await readdir(staging)).includes(namespace))
        throw Error('Search dataset occupies reserved optimizer-study namespace');
      await mkdir(path.join(staging, namespace));
      const base = this.methodRoot(method);
      await verifyBundle(base, method);
      await cp(confined(base, method.source.directory), path.join(staging, namespace, 'source'), {
        recursive: true,
      });
      await cp(confined(base, method.artifact.directory), path.join(staging, namespace, 'artifact'), {
        recursive: true,
      });
      await freeze(staging, directory, path.join(this.root, 'publications'));
      const spec = Experiment.parse({
        ...item.search.specification,
        hostSearchProtocol: isFixedComparison(this.spec)
          ? this.spec.arms.find((arm) => studyArmIdentity(arm) === job.comparisonArm)!.hostSearchProtocol
          : item.search.specification.hostSearchProtocol,
        optimizerHarness: {
          kind: 'artifact',
          source: { directory: `${namespace}/source`, digest: method.source.digest },
          artifact: { directory: `${namespace}/artifact`, identity: method.artifact.identity },
          composition: method.composition,
        },
      });
      return { directory, spec };
    } finally {
      await removeStaging(staging);
    }
  }
  protected async runJob(initial: StudyJob, transport: StudyTransport, signal: AbortSignal): Promise<void> {
    const item = studyCases(this.spec).find((item) => item.id === initial.caseId)!;
    const childRoot = confined(this.root, initial.childRoot);
    try {
      let job = this.store.job(initial.id);
      if (job.phase === 'reserved' || job.phase === 'searching') {
        const input = await this.dataset(job, this.ready(job.method));
        this.store.startJob(this.owner, job.id, digest(input.spec));
        await verifyBundle(this.inputs, item.seed);
        await prepareExperiment(
          childRoot,
          input.spec,
          input.directory,
          confined(this.inputs, item.seed.source.directory),
          this.docker,
        );
        const child = new Store(path.join(childRoot, 'experiment.sqlite'), input.spec);
        const controller = new Controller(
          childRoot,
          path.join(childRoot, 'dataset'),
          input.spec,
          child,
          this.docker,
        );
        try {
          await controller.start();
          const baseline = child.candidate(item.seed.source.digest);
          if (baseline.build && digest(baseline.build) !== digest(item.seed.artifact.identity))
            throw Error('Shared H0 build identity changed');
          if (!baseline.build) {
            await freeze(
              confined(this.inputs, item.seed.artifact.directory),
              path.join(childRoot, 'artifacts', baseline.digest),
              path.join(childRoot, 'publications'),
            );
            await verifyBuild(childRoot, { ...baseline, build: item.seed.artifact.identity });
            child.transaction(() => {
              child.updateCandidate({ ...baseline, build: item.seed.artifact.identity });
              child.event('candidate.build_imported', {
                candidate: baseline.digest,
                build: item.seed.artifact.identity,
              });
            });
          }
          if (!child.getMeta('searchConclusion')) await evolve(controller, { ...transport, signal });
          else await controller.pump(signal);
          const champion = child.getMeta('champion');
          if (!champion) throw Error('Search completed without an eligible selected harness');
          const candidate = child.candidate(champion);
          if (!candidate.build) throw Error('Selected harness has no frozen build');
          await verifyBuild(childRoot, candidate);
          const harness: FrozenStudyBundleRef = {
            source: { directory: `${job.childRoot}/candidates/${champion}`, digest: champion },
            artifact: { directory: `${job.childRoot}/artifacts/${champion}`, identity: candidate.build },
          };
          this.store.startAssessment(this.owner, job.id, harness, digest(item.assessment.specification));
        } finally {
          await controller.close();
          child.close();
        }
        job = this.store.job(job.id);
      }
      if (job.phase !== 'assessing' || !job.selectedHarness)
        throw Error('Study job has no frozen assessment selection');
      await verifyBundle(this.root, job.selectedHarness);
      const assessment = confined(this.inputs, item.assessment.dataset.directory);
      if ((await treeDigest(assessment)) !== item.assessment.dataset.digest)
        throw Error('Registered assessment dataset changed');
      const result = await validateFrozenArm(
        confined(this.root, job.assessmentRoot),
        item.assessment.specification,
        assessment,
        {
          id: job.id,
          source: confined(this.root, job.selectedHarness.source.directory),
          digest: job.selectedHarness.source.digest,
          artifact: confined(this.root, job.selectedHarness.artifact.directory),
          build: job.selectedHarness.artifact.identity,
        },
        this.docker,
        signal,
      );
      if (!result.complete || result.mean === null || !result.samples)
        throw Error('Independent assessment denominator incomplete');
      const reportFile = path.join(this.root, 'job-reports', `${job.id}.json`);
      await atomicJSON(reportFile, result);
      this.store.completeJob(this.owner, job.id, {
        score: result.mean,
        failures: result.failures,
        denominator: result.samples.length,
        constraintsSatisfied: result.constraints.every((constraint) => constraint.status === 'passed'),
        reportDigest: digest(result),
      });
    } catch (error) {
      signal.throwIfAborted();
      if (requiresReclamation(error)) throw error;
      this.store.failJob(this.owner, initial.id, String(error));
      await atomicJSON(path.join(this.root, 'job-reports', `${initial.id}.json`), {
        job: initial.id,
        status: 'failed',
        error: String(error),
      });
    }
  }
  beginValidation() {
    return this.store.beginValidation(this.owner);
  }
  private async runPairedComparison(transport: StudyTransport, externalSignal?: AbortSignal) {
    const signal = this.signal(externalSignal);
    const plan = this.store.freezeFixedDispatchPlan(this.owner);
    for (const [index, block] of plan.blocks.entries()) {
      signal.throwIfAborted();
      const jobs = block.jobs.map((id) => this.store.job(id));
      if (jobs.every((job) => done.has(job.phase))) continue;
      if (
        plan.blocks
          .slice(index + 1)
          .some((later) => later.jobs.some((id) => this.store.job(id).phase !== 'reserved'))
      )
        throw Error('Paired dispatch block barrier was violated');
      // Reattach already-running jobs first without changing the frozen order of unstarted arms.
      const queue = jobs
        .filter((job) => !done.has(job.phase))
        .sort((a, b) => Number(b.phase !== 'reserved') - Number(a.phase !== 'reserved'));
      const worker = async () => {
        for (;;) {
          signal.throwIfAborted();
          const job = queue.shift();
          if (!job) return;
          this.ready(job.method);
          await this.runJob(job, transport, signal);
        }
      };
      const results = await Promise.allSettled(
        Array.from({ length: this.spec.budget.concurrentSearches }, worker),
      );
      signal.throwIfAborted();
      await this.report();
      const errors = results.filter(
        (result): result is PromiseRejectedResult => result.status === 'rejected',
      );
      if (errors.length)
        throw new AggregateError(
          errors.map((error) => error.reason),
          'Paired study block failed',
        );
      if (block.jobs.some((id) => !done.has(this.store.job(id).phase)))
        throw Error('Paired study block has unfinished jobs');
    }
  }
  runValidation(transport: StudyTransport, externalSignal?: AbortSignal) {
    const operation = this.evaluation.then(async () => {
      const state = this.store.state();
      if (state.phase !== 'validating' || (!isFixedComparison(this.spec) && !state.selectedMethod))
        throw Error('Validation selection is not frozen');
      const targets = this.store.validationTargets();
      // Register the entire final denominator before any method starts executing.
      for (const target of targets)
        for (const item of studyCases(this.spec, 'validation'))
          for (let repetition = 0; repetition < this.spec.repetitions; repetition++)
            this.store.reserveJob(this.owner, {
              stage: 'validation',
              ...target,
              caseId: item.id,
              repetition,
            });
      if (isFixedComparison(this.spec)) await this.runPairedComparison(transport, externalSignal);
      else for (const target of targets) await this.evaluate(target, 'validation', transport, externalSignal);
      const result = this.store.finish(
        this.owner,
        'Registered independent validation completed; results retained without automatic release',
      );
      await this.report();
      return result;
    });
    this.evaluation = operation.catch(() => {});
    return operation;
  }
  status() {
    return {
      registrationDigest: this.store.registrationDigest,
      state: this.store.state(),
      methods: this.store.methods(),
      jobs: this.store.jobs(),
      allocation: this.store.reservedAllocation(),
      metaEpisodes: this.store.metaEpisodes(),
      cursor: this.store.cursor(),
    };
  }
  reportSnapshot() {
    const methods = this.store.methods().filter((method) => method.phase === 'ready');
    const fixed = isFixedComparison(this.spec);
    return {
      ...this.status(),
      protocol: fixed ? 'fixed-comparison' : 'development-selection',
      development: fixed
        ? []
        : methods.map((method) => this.store.methodReport(method.methodIdentity!, 'development')),
      validation: this.store.validationReports(),
      comparison: this.store.comparisonReport(),
      boundary: fixed
        ? 'All preregistered comparison methods receive independent search and assessment. No development selector, meta optimizer or automatic release.'
        : 'Development selects methods. Sealed validation reports the frozen selection with complete denominators; no automatic release.',
    };
  }
  async report(): Promise<void> {
    await atomicJSON(path.join(this.root, 'study-report.json'), this.reportSnapshot());
  }
}
