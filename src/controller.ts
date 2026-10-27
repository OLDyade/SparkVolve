import { mkdir, readFile, cp, stat, chmod, readdir, lstat } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Store } from './store.js';
import { atomicJSON, confined, digest, freeze, treeDigest } from './artifacts.js';
import { Docker, readJSON } from './docker.js';
import type { ContainerSpec } from './docker.js';
import { Grade, Proposal, Digest } from './contracts.js';
import { catalog, inspectAsset, importArchive, draftOrigin } from './library.js';
import { collectRequestMetrics } from './metrics.js';
import { buildCandidate, bundlePath, verifyBuild } from './build.js';
import { queueProbe, executeProbe } from './probes.js';
import type { Candidate, CandidateProposal, ExperimentSpec, TaskRun } from './contracts.js';
import { createEgressSession, type EgressFactory, type EgressLifecycle } from './egress-session.js';
import { prepareExecution, collectExecution, ReclamationError, settleExecutionFailure } from './execution.js';

export class Controller {
  readonly owner = randomUUID();
  private active: Promise<void> | undefined;
  private activeSignal: AbortSignal | undefined;
  private heartbeat?: ReturnType<typeof setInterval>;
  private leaseError?: Error;
  constructor(
    readonly root: string,
    readonly dataset: string,
    readonly spec: ExperimentSpec,
    readonly store: Store,
    readonly docker = new Docker(),
    readonly egress: EgressFactory = createEgressSession,
  ) {}
  async start(): Promise<void> {
    if (this.spec.researchLibrary) await this.libraryRoot();
    await this.verificationRoot();
    const environment = this.spec.runtime.environment;
    if (
      environment &&
      (await treeDigest(confined(this.dataset, environment.directory))) !== environment.digest
    )
      throw new Error('Runtime environment digest mismatch');
    for (const task of this.spec.tasks) {
      if ((await treeDigest(confined(this.dataset, task.input))) !== task.inputDigest)
        throw new Error(`Input digest mismatch: ${task.id}`);
      if ((await treeDigest(confined(this.dataset, task.evaluation))) !== task.evaluationDigest)
        throw new Error(`Evaluation digest mismatch: ${task.id}`);
    }
    this.store.acquire(this.owner, Date.now(), 30_000);
    this.heartbeat = setInterval(() => {
      try {
        this.store.assertLease(this.owner);
        this.store.acquire(this.owner, Date.now(), 30_000);
      } catch (error) {
        this.leaseError = error as Error;
      }
    }, 5_000);
  }
  async close(): Promise<void> {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.store.release(this.owner);
  }
  private assertOwner(): void {
    if (this.leaseError) throw this.leaseError;
    this.store.assertLease(this.owner);
  }
  status() {
    return {
      cursor: this.store.cursor(),
      specification: this.spec,
      champion: this.store.getMeta('champion') ?? null,
      candidates: this.store.candidates(),
      runs: this.store.runs(),
      probes: this.store.probes(),
      importedDrafts: this.store.events().filter((event) => event.type === 'draft.imported'),
      conclusion: this.store.getMeta('searchConclusion')
        ? JSON.parse(this.store.getMeta('searchConclusion')!)
        : null,
    };
  }
  async draft(parent: string, name: string): Promise<void> {
    this.assertOwner();
    this.store.candidate(parent);
    const target = confined(path.join(this.root, 'drafts'), name);
    try {
      await stat(target);
      throw new Error('Draft already exists');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    await cp(path.join(this.root, 'candidates', parent), target, { recursive: true });
    // Editable copies have independent permissions; frozen artifacts stay read-only.
    const { inventory } = await import('./artifacts.js');
    const writableDirectories = async (directory: string): Promise<void> => {
      await chmod(directory, 0o755);
      for (const entry of await readdir(directory, { withFileTypes: true }))
        if (entry.isDirectory()) await writableDirectories(path.join(directory, entry.name));
    };
    await writableDirectories(target);
    for (const entry of await inventory(target))
      await chmod(confined(target, entry.path), entry.executable ? 0o755 : 0o644);
  }
  private async libraryRoot(): Promise<string> {
    const library = this.spec.researchLibrary;
    if (!library) throw new Error('No research library authorized by the experiment contract');
    const directory = confined(this.dataset, library.directory);
    if ((await treeDigest(directory)) !== library.digest)
      throw new Error('Research library snapshot changed');
    return directory;
  }
  async library(query = '') {
    return await catalog(await this.libraryRoot(), query);
  }
  async asset(archive: string, file?: string) {
    return await inspectAsset(await this.libraryRoot(), archive, file);
  }
  async importAsset(archive: string, draft: string): Promise<void> {
    this.assertOwner();
    if (this.spec.purpose !== 'search' || this.store.getMeta('searchConclusion'))
      throw new Error('Only an open search can import research assets');
    const library = await this.libraryRoot();
    Digest.parse(archive);
    await inspectAsset(library, archive);
    await importArchive(this.root, this.store, confined(library, archive), draft);
  }
  async submit(raw: unknown): Promise<Candidate> {
    this.assertOwner();
    if (this.store.getMeta('searchConclusion')) throw new Error('Search has concluded');
    const proposal = Proposal.parse(raw);
    const origin = draftOrigin(this.store, proposal.draft);
    const source = confined(path.join(this.root, 'drafts'), proposal.draft);
    const hash = await treeDigest(source);
    if (this.store.candidates().some((c) => c.digest === hash))
      throw new Error('Identical candidate already exists; no resampling');
    if (this.store.candidates().length >= this.spec.budget.candidates)
      throw new Error('Candidate budget exhausted');
    for (const parent of proposal.parents) this.store.candidate(parent);
    await stat(confined(source, this.spec.candidate.patch));
    const pkg = JSON.parse(await readFile(path.join(source, 'package.json'), 'utf8')) as {
      dsh?: { bundle?: { patch?: string } };
    };
    if (pkg.dsh?.bundle?.patch?.replace(/^\.\//, '') !== this.spec.candidate.patch)
      throw new Error('Candidate must be a native DSH Bundle with the contracted patch');
    await stat(path.join(source, 'package-lock.json'));
    await freeze(source, path.join(this.root, 'candidates', hash));
    const candidate: Candidate = {
      digest: hash,
      proposal,
      phase: 'frozen',
      ordinal: this.store.candidates().length,
      ...(origin ? { origin } : {}),
    };
    this.store.addCandidate(candidate);
    return candidate;
  }
  async probe(raw: unknown) {
    this.assertOwner();
    return await queueProbe(this.root, this.store, raw);
  }
  finish(reason: string): void {
    this.assertOwner();
    if (this.store.probes().some((probe) => probe.phase === 'queued'))
      throw new Error('Wait for pending probes before concluding');
    if (this.store.candidates().some((c) => c.phase === 'frozen' || c.phase === 'running'))
      throw new Error('Wait for pending candidates before concluding');
    this.store.transaction(() => {
      if (this.store.getMeta('searchConclusion')) throw new Error('Search already concluded');
      const conclusion = {
        reason,
        at: new Date().toISOString(),
        champion: this.store.getMeta('champion') ?? null,
      };
      this.store.setMeta('searchConclusion', JSON.stringify(conclusion));
      this.store.event('search.concluded', conclusion);
    });
  }
  async seed(source: string): Promise<Candidate> {
    if (this.store.candidates().length) throw new Error('Experiment already initialized');
    await cp(source, path.join(this.root, 'drafts', 'baseline'), {
      recursive: true,
      errorOnExist: true,
      force: false,
    });
    const proposal: CandidateProposal = {
      draft: 'baseline',
      parents: [],
      actions: ['compose'],
      evidence: ['Researcher-supplied initial harness'],
      hypothesis: 'Establish the fixed-task baseline',
      expectedChange: 'No quality claim before evaluation',
    };
    return await this.submit(proposal);
  }
  pump(signal?: AbortSignal): Promise<void> {
    if (this.active) return this.active;
    this.activeSignal = signal;
    this.active = this.advance().finally(() => {
      this.active = undefined;
      this.activeSignal = undefined;
    });
    return this.active;
  }
  async watch(signal: AbortSignal): Promise<void> {
    for (;;) {
      signal.throwIfAborted();
      await this.pump(signal);
      if (this.store.runs().some((r) => r.phase === 'scoring_failed'))
        throw new Error('Scoring failure; rescore original delivery explicitly');
      // A candidate may have been submitted while the previous pump was finishing.
      const cursor = this.store.cursor();
      if (
        this.store.candidates().some((c) => c.phase === 'frozen' || c.phase === 'running') ||
        this.store.probes().some((probe) => probe.phase === 'queued')
      )
        continue;
      await this.store.wait(cursor, { signal });
    }
  }
  private async advance(): Promise<void> {
    for (const probe of this.store.probes().filter((item) => item.phase === 'queued')) {
      this.assertOwner();
      await executeProbe({
        root: this.root,
        dataset: this.dataset,
        spec: this.spec,
        store: this.store,
        docker: this.docker,
        probe,
        assertOwner: () => this.assertOwner(),
        ...(this.activeSignal ? { signal: this.activeSignal } : {}),
      });
    }
    for (const candidate of this.store.candidates()) {
      this.assertOwner();
      if (candidate.phase === 'frozen') {
        if (!candidate.build) {
          try {
            const build = await buildCandidate(
              this.root,
              this.store.getMeta('experimentId')!,
              this.spec,
              candidate,
              this.docker,
              this.activeSignal,
            );
            this.assertOwner();
            this.store.transaction(() => {
              this.store.updateCandidate({ ...candidate, build });
              this.store.event('candidate.built', { candidate: candidate.digest, build });
            });
          } catch (error) {
            this.activeSignal?.throwIfAborted();
            this.assertOwner();
            this.store.transaction(() => {
              this.store.updateCandidate({ ...candidate, phase: 'build_failed', buildError: String(error) });
              this.store.event('candidate.build_failed', {
                candidate: candidate.digest,
                error: String(error),
              });
            });
            continue;
          }
        }
        await this.qa(this.store.candidate(candidate.digest));
      }
      if (this.store.candidate(candidate.digest).phase === 'running')
        await this.evaluate(this.store.candidate(candidate.digest));
    }
    // Reports are projections of committed state. Rebuild even after a crash between decision and file write.
    for (const candidate of this.store.candidates()) {
      if (['champion', 'rejected', 'build_failed', 'qa_failed'].includes(candidate.phase))
        await this.report(candidate.digest);
    }
  }
  private async report(id: string): Promise<void> {
    const runs = this.store.runs(id);
    const usage = await Promise.all(
      runs.map(async (run) => {
        const file = path.join(this.root, 'runs', run.id, 'trace', 'metrics.json');
        try {
          return { run: run.id, status: 'reported', metrics: await readJSON(file) };
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
          return { run: run.id, status: 'unavailable', metrics: null };
        }
      }),
    );
    const baseline = this.store.candidates()[0];
    const baseRuns = baseline ? this.store.runs(baseline.digest) : [];
    const paired = runs.map((run) => {
      const base = baseRuns.find((item) => item.task === run.task && item.repetition === run.repetition);
      const score = run.grade?.score ?? this.spec.metric.failure;
      const baseScore = base ? (base.grade?.score ?? this.spec.metric.failure) : null;
      return {
        task: run.task,
        repetition: run.repetition,
        score,
        baselineScore: baseScore,
        delta: baseScore === null ? null : score - baseScore,
      };
    });
    await atomicJSON(path.join(this.root, 'reports', `${id}.json`), {
      specificationDigest: digest(this.spec),
      candidate: this.store.candidate(id),
      decision: ['champion', 'rejected'].includes(this.store.candidate(id).phase)
        ? this.store.decision(id)
        : null,
      runs,
      usage,
      paired,
      evidenceBoundary:
        'Development selection is not independent validation; request metrics count DSH adapter streams, not hidden provider retries.',
    });
  }
  private async qa(candidate: Candidate): Promise<void> {
    await verifyBuild(this.root, candidate);
    const verification = await this.verificationRoot();
    const root = path.join(this.root, 'qa', candidate.digest);
    await mkdir(path.join(root, 'work'), { recursive: true });
    const environment = this.spec.runtime.environment;
    await atomicJSON(path.join(root, 'launch.json'), {
      profile: this.spec.runtime.profile,
      model: this.spec.executor,
      patches: [
        ...(environment ? [`/environment/${environment.patch}`] : []),
        `/candidate/${this.spec.candidate.patch}`,
      ],
      command: null,
      behaviorModule: this.spec.candidate.qa ? `/verification/${this.spec.candidate.qa.entry}` : null,
      timeoutSeconds: this.spec.timeoutSeconds,
    });
    const result = await this.docker.run(
      {
        name: `he-qa-${digest([this.store.getMeta('experimentId'), candidate.digest]).slice(0, 32)}`,
        image: this.spec.runtime.image,
        command: ['node', '/app/dist/runtime/qa.js', '/qa-launch.json'],
        mounts: [
          ...(verification ? [{ source: verification, target: '/verification', writable: false }] : []),
          ...(environment
            ? [
                {
                  source: confined(this.dataset, environment.directory),
                  target: '/environment',
                  writable: false,
                },
              ]
            : []),
          {
            source: bundlePath(this.root, candidate),
            target: '/candidate',
            writable: false,
          },
          { source: path.join(root, 'work'), target: '/workspace', writable: true },
          { source: path.join(root, 'launch.json'), target: '/qa-launch.json', writable: false },
        ],
        env: {},
        isolation: this.spec.isolation,
        network: this.spec.isolation.network.qa,
        timeoutSeconds: this.spec.timeoutSeconds,
      },
      root,
      this.activeSignal,
    );
    this.assertOwner();
    if (result.ExitCode !== 0) {
      this.store.transaction(() => {
        this.store.updateCandidate({
          ...candidate,
          phase: 'qa_failed',
          qaError: `QA container exited ${result.ExitCode}`,
        });
        this.store.event('candidate.qa', { candidate: candidate.digest, ...result });
      });
      return;
    }
    this.store.event('candidate.qa', { candidate: candidate.digest, ...result });
    const runs = this.spec.tasks.flatMap((task) =>
      Array.from({ length: this.spec.repetitions }, (_, repetition): TaskRun => {
        const id = digest({
          experiment: this.store.getMeta('experimentId'),
          spec: this.spec,
          candidate: candidate.digest,
          task: task.id,
          repetition,
          attempt: 0,
        });
        return {
          id,
          candidate: candidate.digest,
          task: task.id,
          repetition,
          attempt: 0,
          gradeAttempt: 0,
          phase: 'queued',
          container: `he-run-${id.slice(0, 40)}`,
          gradeContainer: `he-grade-${id.slice(0, 40)}-0`,
        };
      }),
    );
    this.store.admit(candidate, runs);
  }
  private async verificationRoot(): Promise<string | null> {
    const qa = this.spec.candidate.qa;
    if (!qa) return null;
    const directory = confined(this.dataset, qa.directory);
    if (!(await lstat(directory)).isDirectory()) throw new Error('Domain QA must be a directory');
    if ((await treeDigest(directory)) !== qa.digest) throw new Error('Domain QA digest mismatch');
    if (!(await lstat(confined(directory, qa.entry))).isFile())
      throw new Error('Domain QA entry must be a regular file');
    return directory;
  }
  private async executionSpec(run: TaskRun, gateway: EgressLifecycle | null): Promise<ContainerSpec> {
    const candidate = this.store.candidate(run.candidate);
    await verifyBuild(this.root, candidate);
    const task = this.spec.tasks.find((t) => t.id === run.task);
    if (!task) throw new Error('Task identity missing');
    const runRoot = path.join(this.root, 'runs', run.id);
    await mkdir(path.join(runRoot, 'work'), { recursive: true });
    await mkdir(path.join(runRoot, 'trace'), { recursive: true });
    const environment = this.spec.runtime.environment;
    const config = {
      profile: this.spec.runtime.profile,
      model: this.spec.executor,
      patch: `/candidate/${this.spec.candidate.patch}`,
      environmentPatch: environment ? `/environment/${environment.patch}` : null,
      prompt: task.prompt,
      timeoutSeconds: this.spec.timeoutSeconds,
    };
    await atomicJSON(path.join(runRoot, 'launch.json'), config);
    return {
      name: run.container,
      image: this.spec.runtime.image,
      command: ['node', '/app/dist/runtime/worker.js', '/launch.json'],
      mounts: [
        ...(environment
          ? [
              {
                source: confined(this.dataset, environment.directory),
                target: '/environment',
                writable: false,
              },
            ]
          : []),
        { source: bundlePath(this.root, candidate), target: '/candidate', writable: false },
        { source: confined(this.dataset, task.input), target: '/input', writable: false },
        { source: path.join(runRoot, 'work'), target: '/workspace', writable: true },
        { source: path.join(runRoot, 'trace'), target: '/trace', writable: true },
        { source: path.join(runRoot, 'launch.json'), target: '/launch.json', writable: false },
      ],
      env: Object.fromEntries(
        this.spec.executor.credentialEnv.map((key) => [key, 'egress-client-placeholder']),
      ),
      isolation: this.spec.isolation,
      network: gateway ? await gateway.candidateNetwork() : 'none',
      timeoutSeconds: this.spec.timeoutSeconds,
    };
  }
  private async execute(run: TaskRun): Promise<void> {
    const gateway =
      this.spec.isolation.network.executor === 'controlled'
        ? this.egress(
            {
              root: path.join(this.root, 'runs', run.id, 'egress'),
              execution: run.container,
              image: this.spec.runtime.image,
              isolation: this.spec.isolation,
              routes: this.spec.egress.executor,
              timeoutSeconds: this.spec.timeoutSeconds,
            },
            this.docker,
          )
        : null;
    let spec: ContainerSpec | undefined;
    if (run.phase === 'queued') {
      this.assertOwner();
      this.store.transition(run.id, 'queued', 'executing', { startedAt: new Date().toISOString() });
    }
    const runRoot = path.join(this.root, 'runs', run.id);
    const pendingFailure = await settleExecutionFailure(runRoot, this.docker, gateway);
    if (pendingFailure !== null) {
      this.assertOwner();
      this.store.transition(run.id, 'executing', 'execution_failed', {
        error: pendingFailure,
        completedAt: new Date().toISOString(),
      });
      return;
    }
    try {
      spec = await prepareExecution(
        path.join(this.root, 'runs', run.id),
        { specification: this.spec, execution: run.id },
        this.docker,
        gateway,
        () => this.executionSpec(run, gateway),
        process.env,
      );
      const result = await collectExecution(
        path.join(this.root, 'runs', run.id),
        spec,
        path.join(this.root, 'runs', run.id, 'execution'),
        this.docker,
        gateway,
        this.activeSignal,
      );
      await collectRequestMetrics(path.join(this.root, 'runs', run.id, 'trace'));
      this.assertOwner();
      this.store.event('run.exit', { id: run.id, ...result });
      if (result.ExitCode !== 0) throw new Error(`Executor exited ${result.ExitCode}`);
      const delivery = path.join(this.root, 'runs', run.id, 'delivery');
      let deliveryDigest: string;
      try {
        await stat(delivery);
        deliveryDigest = await treeDigest(delivery);
        if (deliveryDigest !== (await treeDigest(path.join(this.root, 'runs', run.id, 'work'))))
          throw new Error('Interrupted delivery snapshot mismatch');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        deliveryDigest = await freeze(path.join(this.root, 'runs', run.id, 'work'), delivery);
      }
      this.store.transition(run.id, 'executing', 'delivered', {
        deliveryDigest,
        completedAt: new Date().toISOString(),
      });
    } catch (error) {
      this.activeSignal?.throwIfAborted();
      if (error instanceof ReclamationError) {
        this.store.event('run.reclamation_failed', { id: run.id, error: String(error.cause) });
        throw error;
      }
      const failure = await settleExecutionFailure(runRoot, this.docker, gateway, error);
      this.assertOwner();
      this.store.transition(run.id, 'executing', 'execution_failed', {
        error: failure!,
        completedAt: new Date().toISOString(),
      });
    }
  }
  private async score(run: TaskRun): Promise<void> {
    const task = this.spec.tasks.find((t) => t.id === run.task);
    if (!task) throw new Error('Missing task');
    const root = path.join(this.root, 'runs', run.id);
    if ((await treeDigest(path.join(root, 'delivery'))) !== run.deliveryDigest)
      throw new Error('Delivery was modified after execution');
    const gradeDir = path.join(root, `grade-${run.gradeAttempt}`);
    await mkdir(gradeDir, { recursive: true });
    if (run.phase === 'delivered') this.store.transition(run.id, 'delivered', 'scoring');
    try {
      const result = await this.docker.run(
        {
          name: run.gradeContainer,
          image: this.spec.evaluator.image,
          command: this.spec.evaluator.command,
          mounts: [
            { source: path.join(root, 'delivery'), target: '/delivery', writable: false },
            { source: confined(this.dataset, task.input), target: '/input', writable: false },
            { source: confined(this.dataset, task.evaluation), target: '/evaluation', writable: false },
            { source: gradeDir, target: '/workspace', writable: true },
          ],
          env: {},
          isolation: this.spec.isolation,
          network: this.spec.isolation.network.evaluator,
          timeoutSeconds: this.spec.evaluator.timeoutSeconds,
        },
        path.join(root, `grading-${run.gradeAttempt}`),
        this.activeSignal,
      );
      if (result.ExitCode !== 0) throw new Error(`Evaluator exited ${result.ExitCode}`);
      const grade = Grade.parse(await readJSON(path.join(gradeDir, 'result.json')));
      if (grade.score < this.spec.metric.minimum || grade.score > this.spec.metric.maximum)
        throw new Error('Evaluator score outside specification bounds');
      this.assertOwner();
      this.store.transition(run.id, 'scoring', 'scored', { grade });
    } catch (error) {
      this.activeSignal?.throwIfAborted();
      this.assertOwner();
      this.store.transition(run.id, 'scoring', 'scoring_failed', { error: String(error) });
    }
  }
  async rescore(id: string): Promise<void> {
    this.assertOwner();
    const run = this.store.runs().find((r) => r.id === id);
    if (!run || run.phase !== 'scoring_failed') throw new Error('Only scoring failures can be rescored');
    const gradeAttempt = run.gradeAttempt + 1;
    const next = this.store.transition(id, 'scoring_failed', 'scoring', {
      gradeAttempt,
      gradeContainer: `he-grade-${id.slice(0, 40)}-${gradeAttempt}`,
    });
    await this.score(next);
  }
  private async evaluate(candidate: Candidate): Promise<void> {
    if ((await treeDigest(path.join(this.root, 'candidates', candidate.digest))) !== candidate.digest)
      throw new Error('Frozen candidate modified');
    const queue = this.store.runs(candidate.digest);
    if (!queue.length) throw new Error('Candidate has no registered runs; investigate interrupted admission');
    const worker = async (): Promise<void> => {
      for (;;) {
        this.assertOwner();
        const run = queue.shift();
        if (!run) return;
        const failures = this.store
          .runs(candidate.digest)
          .filter((r) => r.phase === 'execution_failed').length;
        if (run.phase === 'queued' && failures > this.spec.failureLimit) {
          this.store.transition(run.id, 'queued', 'cancelled', { error: 'Failure budget exhausted' });
          continue;
        }
        if (run.phase === 'queued' || run.phase === 'executing') await this.execute(run);
        const current = this.store.runs(candidate.digest).find((r) => r.id === run.id)!;
        if (current.phase === 'delivered' || current.phase === 'scoring') await this.score(current);
      }
    };
    const results = await Promise.allSettled(Array.from({ length: this.spec.concurrency }, worker));
    const errors = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    if (errors.length)
      throw new AggregateError(
        errors.map((e) => e.reason),
        'Experiment worker failure',
      );
    if (this.store.runs(candidate.digest).some((r) => r.phase === 'scoring_failed')) return;
    this.store.decide(candidate.digest);
  }
}
