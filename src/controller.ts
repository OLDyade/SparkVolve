import { mkdir, readFile, cp, stat, chmod, readdir } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Store } from './store.js';
import { atomicJSON, confined, digest, freeze, treeDigest } from './artifacts.js';
import { Docker, readJSON } from './docker.js';
import type { ContainerSpec } from './docker.js';
import { Grade, Proposal } from './contracts.js';
import { collectRequestMetrics } from './metrics.js';
import type { Candidate, CandidateProposal, ExperimentSpec, TaskRun } from './contracts.js';

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
  ) {}
  async start(): Promise<void> {
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
  status(): unknown {
    return {
      specification: this.spec,
      champion: this.store.getMeta('champion') ?? null,
      candidates: this.store.candidates(),
      runs: this.store.runs(),
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
  async submit(raw: unknown): Promise<Candidate> {
    this.assertOwner();
    if (this.store.getMeta('searchConclusion')) throw new Error('Search has concluded');
    const proposal = Proposal.parse(raw);
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
    await freeze(source, path.join(this.root, 'candidates', hash));
    const candidate: Candidate = {
      digest: hash,
      proposal,
      phase: 'frozen',
      ordinal: this.store.candidates().length,
    };
    this.store.addCandidate(candidate);
    return candidate;
  }
  finish(reason: string): void {
    this.assertOwner();
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
  private async advance(): Promise<void> {
    for (const candidate of this.store.candidates()) {
      this.assertOwner();
      if (candidate.phase === 'frozen') await this.qa(candidate);
      if (this.store.candidate(candidate.digest).phase === 'running') await this.evaluate(candidate);
    }
    // Reports are projections of committed state. Rebuild even after a crash between decision and file write.
    for (const candidate of this.store.candidates()) {
      if (candidate.phase === 'champion' || candidate.phase === 'rejected')
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
      decision: this.store.decision(id),
      runs,
      usage,
      paired,
      evidenceBoundary:
        'Development selection is not independent validation; request metrics count DSH adapter streams, not hidden provider retries.',
    });
  }
  private async qa(candidate: Candidate): Promise<void> {
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
      command: this.spec.candidate.qa,
      timeoutSeconds: this.spec.timeoutSeconds,
    });
    const result = await this.docker.run(
      {
        name: `he-qa-${digest([this.store.getMeta('experimentId'), candidate.digest]).slice(0, 32)}`,
        image: this.spec.runtime.image,
        command: ['node', '/app/dist/runtime/qa.js', '/qa-launch.json'],
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
          {
            source: path.join(this.root, 'candidates', candidate.digest),
            target: '/candidate',
            writable: false,
          },
          { source: path.join(root, 'work'), target: '/workspace', writable: true },
          { source: path.join(root, 'launch.json'), target: '/qa-launch.json', writable: false },
        ],
        env: this.credentials(this.spec.executor.credentialEnv),
        network: 'none',
        timeoutSeconds: this.spec.timeoutSeconds,
      },
      root,
      this.activeSignal,
    );
    this.assertOwner();
    this.store.event('candidate.qa', { candidate: candidate.digest, ...result });
    if (result.ExitCode !== 0) {
      this.store.updateCandidate({
        ...candidate,
        phase: 'qa_failed',
        qaError: `QA container exited ${result.ExitCode}`,
      });
      return;
    }
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
  private credentials(names: string[]): Record<string, string> {
    return Object.fromEntries(
      names.map((name) => {
        const value = process.env[name];
        if (!value) throw new Error(`Missing credential environment: ${name}`);
        return [name, value];
      }),
    );
  }
  private async executionSpec(run: TaskRun): Promise<ContainerSpec> {
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
        { source: path.join(this.root, 'candidates', run.candidate), target: '/candidate', writable: false },
        { source: confined(this.dataset, task.input), target: '/input', writable: false },
        { source: path.join(runRoot, 'work'), target: '/workspace', writable: true },
        { source: path.join(runRoot, 'trace'), target: '/trace', writable: true },
        { source: path.join(runRoot, 'launch.json'), target: '/launch.json', writable: false },
      ],
      env: run.phase === 'queued' ? this.credentials(this.spec.executor.credentialEnv) : {},
      network: 'bridge',
      timeoutSeconds: this.spec.timeoutSeconds,
    };
  }
  private async execute(run: TaskRun): Promise<void> {
    const spec = await this.executionSpec(run);
    if (run.phase === 'queued') {
      this.assertOwner();
      this.store.transition(run.id, 'queued', 'executing', { startedAt: new Date().toISOString() });
      // Write intent before create. A lost create acknowledgement is reconciled by its unique name.
      try {
        await this.docker.create(spec);
      } catch (error) {
        if (!(await this.docker.inspect(spec.name))) throw error;
      }
    }
    try {
      const result = await this.docker.collect(
        spec,
        path.join(this.root, 'runs', run.id, 'execution'),
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
      this.assertOwner();
      this.store.transition(run.id, 'executing', 'execution_failed', {
        error: String(error),
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
          network: 'none',
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
