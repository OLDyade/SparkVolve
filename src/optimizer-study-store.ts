import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { canonical, digest } from './artifacts.js';
import { Digest, Id, Proposal, type CandidateProposal } from './contracts.js';
import { EventCursor, type EventPage } from './events.js';
import {
  FrozenStudyBundle,
  FrozenStudyMethod,
  RegisteredOptimizerStudy,
  developmentStudy,
  isFixedComparison,
  studyCases,
  studyBaselineMethod,
  StudyStage,
  studyAllocationCeiling,
  studyJobAllocation,
  studyMethodCandidateIdentity,
  studyMethodIdentity,
  type FrozenStudyBundleRef,
  type FrozenStudyMethodRef,
  type RegisteredOptimizerStudySpec,
  type StudyAllocation,
  type StudyStageName,
} from './optimizer-study-contracts.js';

export interface StudyMethodCandidate {
  id: string;
  ordinal: number;
  source: FrozenStudyMethodRef['source'];
  composition: string;
  proposal: CandidateProposal | null;
  phase: 'preparing' | 'ready' | 'failed' | 'cancelled';
  method?: FrozenStudyMethodRef;
  methodIdentity?: string;
  error?: string;
  cleanupDigest?: string;
}
export interface StudyJobResult {
  score: number;
  failures: number;
  denominator: number;
  constraintsSatisfied: boolean;
  reportDigest: string;
}
export interface StudyJob {
  id: string;
  stage: StudyStageName;
  method: string;
  caseId: string;
  repetition: number;
  phase: 'reserved' | 'searching' | 'assessing' | 'complete' | 'failed' | 'cancelling' | 'cancelled';
  allocation: StudyAllocation;
  childRoot: string;
  assessmentRoot: string;
  childSpecDigest?: string;
  assessmentSpecDigest?: string;
  selectedHarness?: FrozenStudyBundleRef;
  result?: StudyJobResult;
  error?: string;
  cleanupDigest?: string;
}
export interface StudyMetaEpisode {
  ordinal: number;
  seconds: number;
  phase: 'reserved' | 'running' | 'complete' | 'failed' | 'cancelled';
  actualSeconds?: number | null;
  receiptDigest?: string;
}
export interface StudyState {
  phase: 'developing' | 'validating' | 'complete' | 'cancelling' | 'cancelled';
  selectedMethod?: string;
  cancellation?: { reason: string; at: string };
  conclusion?: { reason: string; at: string };
  cleanupDigest?: string;
}
export interface StudyCleanupRecord {
  kind: 'job-search' | 'job-assessment' | 'method' | 'meta' | 'study';
  id: string;
  digest: string;
}
const terminalJobs = new Set<StudyJob['phase']>(['complete', 'failed', 'cancelled']);

/** Exact sums of JSON decimal scores; equal-denominator comparisons avoid rounding-induced promotion. */
function exactSum(values: number[]): { coefficient: bigint; scale: number } {
  const terms = values.map((value) => {
    const [mantissa, power = '0'] = value.toString().split('e');
    const [whole, fraction = ''] = mantissa!.split('.');
    return { coefficient: BigInt(whole! + fraction), scale: fraction.length - Number(power) };
  });
  const scale = Math.max(0, ...terms.map((term) => term.scale));
  return {
    coefficient: terms.reduce((sum, term) => sum + term.coefficient * 10n ** BigInt(scale - term.scale), 0n),
    scale,
  };
}
function compareScores(left: number[], right: number[]): number {
  if (left.length !== right.length) throw new Error('Method comparison requires identical denominators');
  const a = exactSum(left),
    b = exactSum(right),
    scale = Math.max(a.scale, b.scale);
  const delta =
    a.coefficient * 10n ** BigInt(scale - a.scale) - b.coefficient * 10n ** BigInt(scale - b.scale);
  return delta > 0n ? 1 : delta < 0n ? -1 : 0;
}

/** Trusted parent ledger. Child task records and private assessment material remain in child experiments. */
export class OptimizerStudyStore {
  readonly db: DatabaseSync;
  readonly spec: RegisteredOptimizerStudySpec;
  readonly registrationDigest: string;
  constructor(
    file: string,
    raw: unknown,
    private readonly access: 'read' | 'write' = 'write',
  ) {
    this.spec = RegisteredOptimizerStudy.parse(raw);
    this.registrationDigest = digest(this.spec);
    this.db = new DatabaseSync(file, { readOnly: access === 'read', timeout: 5000 });
    try {
      if (access === 'write') {
        this.db.exec(`PRAGMA journal_mode=WAL;
          CREATE TABLE IF NOT EXISTS metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS methods(id TEXT PRIMARY KEY,body TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY,body TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS meta_episodes(ordinal INTEGER PRIMARY KEY,body TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS events(seq INTEGER PRIMARY KEY AUTOINCREMENT,at TEXT NOT NULL,type TEXT NOT NULL,body TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS lease(id INTEGER PRIMARY KEY CHECK(id=1),owner TEXT NOT NULL,expires INTEGER NOT NULL);`);
        this.transaction(() => {
          const saved = this.meta('registration');
          if (saved !== undefined && saved !== this.registrationDigest)
            throw new Error('Optimizer study registration changed');
          if (saved === undefined) {
            this.setMeta('registration', this.registrationDigest);
            this.setMeta('studyId', randomUUID());
            const fixed = isFixedComparison(this.spec);
            this.setState({ phase: fixed ? 'validating' : 'developing' });
            const methods = fixed ? this.spec.arms.map((arm) => arm.method) : [this.spec.baseline];
            methods.forEach((method, ordinal) =>
              this.putMethod({
                id: studyMethodCandidateIdentity(method.source.digest, method.composition),
                ordinal,
                source: method.source,
                composition: method.composition,
                proposal: null,
                phase: 'ready',
                method,
                methodIdentity: studyMethodIdentity(method),
              }),
            );
            this.event('study.registered', {
              registrationDigest: this.registrationDigest,
              baseline: studyMethodIdentity(studyBaselineMethod(this.spec)),
              ...(fixed ? { protocol: 'fixed-comparison', arms: this.spec.arms } : {}),
              allocation: studyAllocationCeiling(this.spec),
            });
          }
        });
      }
      if (this.meta('registration') !== this.registrationDigest)
        throw new Error('Optimizer study registration changed or missing');
      EventCursor.parse({ experimentId: this.meta('studyId'), sequence: 0 });
    } catch (error) {
      this.db.close();
      throw error;
    }
  }
  close(): void {
    this.db.close();
  }
  private transaction<T>(body: () => T): T {
    if (this.access === 'read') throw new Error('Study store is readonly');
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const value = body();
      this.db.exec('COMMIT');
      return value;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
  private write<T>(owner: string, body: () => T): T {
    return this.transaction(() => {
      this.assertLease(owner);
      return body();
    });
  }
  private meta(key: string): string | undefined {
    return (
      this.db.prepare('SELECT value FROM metadata WHERE key=?').get(key) as { value: string } | undefined
    )?.value;
  }
  private setMeta(key: string, value: string): void {
    this.db
      .prepare('INSERT INTO metadata VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value')
      .run(key, value);
  }
  private setState(state: StudyState): void {
    this.setMeta('state', canonical(state));
  }
  state(): StudyState {
    return JSON.parse(this.meta('state')!);
  }
  private event(type: string, body: unknown): void {
    this.db
      .prepare('INSERT INTO events(at,type,body) VALUES (?,?,?)')
      .run(new Date().toISOString(), type, canonical(body));
  }
  cursor(): EventCursor {
    return {
      experimentId: this.meta('studyId')!,
      sequence: Number(this.db.prepare('SELECT COALESCE(MAX(seq),0) AS seq FROM events').get()!.seq),
    };
  }
  page(raw: EventCursor, limit = 100): EventPage {
    const cursor = EventCursor.parse(raw),
      tail = this.cursor();
    if (cursor.experimentId !== tail.experimentId || cursor.sequence > tail.sequence)
      throw new Error('Study event cursor identity or sequence mismatch');
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
      throw new Error('Event page limit must be between 1 and 100');
    const rows = this.db
      .prepare('SELECT seq,at,type,body FROM events WHERE seq>? ORDER BY seq LIMIT ?')
      .all(cursor.sequence, limit + 1);
    const events = rows.slice(0, limit).map((row) => ({
      sequence: Number(row.seq),
      at: String(row.at),
      type: String(row.type),
      body: JSON.parse(String(row.body)) as unknown,
    }));
    return {
      cursor: { ...cursor, sequence: events.at(-1)?.sequence ?? cursor.sequence },
      events,
      hasMore: rows.length > limit,
    };
  }
  acquire(owner: string, now: number, ttl: number): void {
    if (
      !owner ||
      !Number.isSafeInteger(now) ||
      !Number.isSafeInteger(ttl) ||
      ttl <= 0 ||
      !Number.isSafeInteger(now + ttl)
    )
      throw new Error('Invalid study lease');
    this.transaction(() => {
      const previous = this.db.prepare('SELECT owner,expires FROM lease WHERE id=1').get() as
        { owner: string; expires: number } | undefined;
      if (previous && previous.owner !== owner && previous.expires > now)
        throw new Error('Study has an active coordinator');
      this.db
        .prepare(
          'INSERT INTO lease VALUES (1,?,?) ON CONFLICT(id) DO UPDATE SET owner=excluded.owner,expires=excluded.expires',
        )
        .run(owner, now + ttl);
    });
  }
  assertLease(owner: string): void {
    const lease = this.db.prepare('SELECT owner,expires FROM lease WHERE id=1').get() as
      { owner: string; expires: number } | undefined;
    if (!lease || lease.owner !== owner || lease.expires <= Date.now())
      throw new Error('Study coordinator lease lost');
  }
  release(owner: string): void {
    this.db.prepare('DELETE FROM lease WHERE owner=?').run(owner);
  }
  methods(): StudyMethodCandidate[] {
    return this.db
      .prepare('SELECT body FROM methods ORDER BY rowid')
      .all()
      .map((row) => JSON.parse(String(row.body)));
  }
  method(id: string): StudyMethodCandidate {
    const item = this.methods().find((method) => method.id === id);
    if (!item) throw new Error('Unknown method candidate');
    return item;
  }
  private putMethod(method: StudyMethodCandidate): void {
    this.db
      .prepare('INSERT INTO methods VALUES (?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body')
      .run(method.id, canonical(method));
  }
  reserveMethod(
    owner: string,
    input: { source: FrozenStudyMethodRef['source']; composition: string; proposal: CandidateProposal },
  ): StudyMethodCandidate {
    const source = FrozenStudyMethod.shape.source.parse(input.source),
      proposal = Proposal.parse(input.proposal);
    const id = studyMethodCandidateIdentity(source.digest, input.composition);
    return this.write(owner, () => {
      const existing = this.methods().find((method) => method.id === id);
      if (existing) {
        if (
          canonical(existing.source) !== canonical(source) ||
          canonical(existing.proposal) !== canonical(proposal)
        )
          throw new Error('Method submission changed; no resampling');
        return existing;
      }
      if (this.state().phase !== 'developing') throw new Error('Study is not accepting methods');
      const methods = this.methods();
      if (methods.length >= developmentStudy(this.spec).budget.methodCandidates)
        throw new Error('Method candidate budget exhausted');
      if (
        proposal.parents.some(
          (parent) => !methods.some((method) => method.source.digest === parent && method.phase === 'ready'),
        )
      )
        throw new Error('Method parent is not a ready registered source');
      const candidate: StudyMethodCandidate = {
        id,
        ordinal: methods.length,
        source,
        composition: input.composition,
        proposal,
        phase: 'preparing',
      };
      this.putMethod(candidate);
      this.event('method.reserved', candidate);
      return candidate;
    });
  }
  publishMethod(owner: string, id: string, raw: FrozenStudyMethodRef): StudyMethodCandidate {
    const method = FrozenStudyMethod.parse(raw);
    return this.write(owner, () => {
      const candidate = this.method(id);
      if (candidate.phase === 'ready' && canonical(candidate.method) === canonical(method)) return candidate;
      if (this.state().phase !== 'developing' || candidate.phase !== 'preparing')
        throw new Error('Method is not awaiting preparation');
      if (
        canonical(candidate.source) !== canonical(method.source) ||
        candidate.composition !== method.composition ||
        method.artifact.identity.image !== developmentStudy(this.spec).methodBuild.image
      )
        throw new Error('Prepared method identity does not match its reservation');
      const result: StudyMethodCandidate = {
        ...candidate,
        phase: 'ready',
        method,
        methodIdentity: studyMethodIdentity(method),
      };
      this.putMethod(result);
      this.event('method.ready', result);
      return result;
    });
  }
  failMethod(owner: string, id: string, error: string): void {
    this.write(owner, () => {
      const candidate = this.method(id);
      if (this.state().phase !== 'developing' || candidate.phase !== 'preparing' || !error)
        throw new Error('Method is not awaiting a preparation failure');
      this.putMethod({ ...candidate, phase: 'failed', error });
      this.event('method.failed', { id, error });
    });
  }
  jobs(): StudyJob[] {
    return this.db
      .prepare('SELECT body FROM jobs ORDER BY rowid')
      .all()
      .map((row) => JSON.parse(String(row.body)));
  }
  job(id: string): StudyJob {
    const row = this.db.prepare('SELECT body FROM jobs WHERE id=?').get(id);
    if (!row) throw new Error('Unknown study job');
    return JSON.parse(String(row.body));
  }
  private putJob(job: StudyJob): void {
    this.db
      .prepare('INSERT INTO jobs VALUES (?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body')
      .run(job.id, canonical(job));
  }
  private case(stage: StudyStageName, id: string) {
    const item = studyCases(this.spec, stage).find((item) => item.id === id);
    if (!item) throw new Error('Unknown case in study stage');
    return item;
  }
  reserveJob(
    owner: string,
    raw: { stage: StudyStageName; method: string; caseId: string; repetition: number },
  ): StudyJob {
    const input = {
      stage: StudyStage.parse(raw.stage),
      method: Digest.parse(raw.method),
      caseId: Id.parse(raw.caseId),
      repetition: raw.repetition,
    };
    if (
      !Number.isSafeInteger(input.repetition) ||
      input.repetition < 0 ||
      input.repetition >= this.spec.repetitions
    )
      throw new Error('Search repetition outside registration');
    const item = this.case(input.stage, input.caseId);
    const id = digest({ registration: this.registrationDigest, ...input });
    return this.write(owner, () => {
      const saved = this.jobs().find((job) => job.id === id);
      if (saved) return saved;
      const state = this.state();
      if (state.phase !== (input.stage === 'development' ? 'developing' : 'validating'))
        throw new Error('Study stage is not admitting jobs');
      if (
        !this.methods().some((method) => method.phase === 'ready' && method.methodIdentity === input.method)
      )
        throw new Error('Job method is not a frozen registered artifact');
      if (input.stage === 'validation' && !this.validationMethods().includes(input.method))
        throw new Error('Validation method is outside the frozen protocol');
      const job: StudyJob = {
        id,
        ...input,
        phase: 'reserved',
        allocation: studyJobAllocation(item),
        childRoot: `children/${id}`,
        assessmentRoot: `assessments/${id}`,
      };
      const ceiling = studyAllocationCeiling(this.spec),
        previous = this.reservedAllocation();
      if (
        (Object.keys(ceiling) as Array<keyof StudyAllocation>).some(
          (key) => previous[key] + job.allocation[key] > ceiling[key],
        )
      )
        throw new Error('Registered study allocation exhausted');
      this.putJob(job);
      this.event('job.reserved', job);
      return job;
    });
  }
  reservedAllocation(): StudyAllocation {
    const total: StudyAllocation = {
      candidates: 0,
      probes: 0,
      optimizerSeconds: 0,
      searchTasks: 0,
      assessmentTasks: 0,
    };
    for (const job of this.jobs())
      for (const key of Object.keys(total) as Array<keyof StudyAllocation>) total[key] += job.allocation[key];
    return total;
  }
  startJob(owner: string, id: string, childSpecDigest: string): StudyJob {
    Digest.parse(childSpecDigest);
    return this.write(owner, () => {
      const job = this.job(id);
      if (job.phase === 'searching' && job.childSpecDigest === childSpecDigest) return job;
      if (job.phase !== 'reserved' || !['developing', 'validating'].includes(this.state().phase))
        throw new Error('Study job cannot start');
      if (
        this.jobs().filter((other) => other.phase === 'searching' || other.phase === 'assessing').length >=
        this.spec.budget.concurrentSearches
      )
        throw new Error('Study concurrency allocation exhausted');
      const next: StudyJob = { ...job, phase: 'searching', childSpecDigest };
      this.putJob(next);
      this.event('job.searching', next);
      return next;
    });
  }
  startAssessment(
    owner: string,
    id: string,
    harness: FrozenStudyBundleRef,
    assessmentSpecDigest: string,
  ): StudyJob {
    const selectedHarness = FrozenStudyBundle.parse(harness);
    Digest.parse(assessmentSpecDigest);
    return this.write(owner, () => {
      const job = this.job(id);
      if (
        job.phase === 'assessing' &&
        canonical(job.selectedHarness) === canonical(selectedHarness) &&
        job.assessmentSpecDigest === assessmentSpecDigest
      )
        return job;
      if (job.phase !== 'searching' || !['developing', 'validating'].includes(this.state().phase))
        throw new Error('Study job is not awaiting a frozen harness');
      const next: StudyJob = { ...job, phase: 'assessing', selectedHarness, assessmentSpecDigest };
      this.putJob(next);
      this.event('job.assessing', next);
      return next;
    });
  }
  completeJob(owner: string, id: string, result: StudyJobResult): StudyJob {
    Digest.parse(result.reportDigest);
    return this.write(owner, () => {
      const job = this.job(id),
        spec = this.case(job.stage, job.caseId).assessment.specification;
      if (job.phase === 'complete' && canonical(job.result) === canonical(result)) return job;
      if (job.phase !== 'assessing' || !['developing', 'validating'].includes(this.state().phase))
        throw new Error('Study job is not awaiting assessment');
      if (
        !Number.isFinite(result.score) ||
        result.score < spec.metric.minimum ||
        result.score > spec.metric.maximum ||
        result.denominator !== job.allocation.assessmentTasks ||
        !Number.isSafeInteger(result.failures) ||
        result.failures < 0 ||
        result.failures > result.denominator ||
        typeof result.constraintsSatisfied !== 'boolean'
      )
        throw new Error('Assessment result violates the registered denominator or metric');
      const next: StudyJob = { ...job, phase: 'complete', result };
      this.putJob(next);
      this.event('job.complete', next);
      return next;
    });
  }
  failJob(owner: string, id: string, error: string): StudyJob {
    return this.write(owner, () => {
      const job = this.job(id);
      if (job.phase === 'failed' && job.error === error) return job;
      if (
        terminalJobs.has(job.phase) ||
        job.phase === 'cancelling' ||
        !error ||
        !['developing', 'validating'].includes(this.state().phase)
      )
        throw new Error('Study job cannot fail from its current phase');
      const next: StudyJob = { ...job, phase: 'failed', error };
      this.putJob(next);
      this.event('job.failed', next);
      return next;
    });
  }
  methodReport(method: string, stage: StudyStageName) {
    const cases = studyCases(this.spec, stage);
    const samples = cases.flatMap((item) =>
      Array.from({ length: this.spec.repetitions }, (_, repetition) => {
        const job = this.jobs().find(
          (job) =>
            job.stage === stage &&
            job.method === method &&
            job.caseId === item.id &&
            job.repetition === repetition,
        );
        const cancelledSlot = !job && isFixedComparison(this.spec) && this.state().phase === 'cancelled';
        const complete = cancelledSlot || (job !== undefined && terminalJobs.has(job.phase));
        const successful =
          job?.phase === 'complete' &&
          job.result!.failures <= item.assessment.specification.failureLimit &&
          job.result!.constraintsSatisfied;
        return {
          caseId: item.id,
          repetition,
          job: job?.id ?? null,
          phase: job?.phase ?? (cancelledSlot ? 'cancelled' : 'unreserved'),
          complete,
          successful,
          score: !complete
            ? null
            : job?.phase === 'complete'
              ? job.result!.score
              : item.assessment.specification.metric.failure,
        };
      }),
    );
    return {
      method,
      stage,
      denominator: samples.length,
      complete: samples.every((sample) => sample.complete),
      failures: samples.filter((sample) => sample.complete && !sample.successful).length,
      pending: samples.filter((sample) => !sample.complete).length,
      mean: samples.every((sample) => sample.complete)
        ? samples.reduce((sum, sample) => sum + sample.score!, 0) / samples.length
        : null,
      samples,
    };
  }
  validationMethods(): string[] {
    if (isFixedComparison(this.spec)) return this.spec.arms.map((arm) => studyMethodIdentity(arm.method));
    const selected = this.state().selectedMethod;
    return [...new Set([studyMethodIdentity(this.spec.baseline), ...(selected ? [selected] : [])])];
  }
  comparisonReport() {
    if (!isFixedComparison(this.spec)) return null;
    const spec = this.spec;
    const baselineMethod = studyMethodIdentity(studyBaselineMethod(spec));
    const baseline = this.methodReport(baselineMethod, 'validation');
    const direction = spec.cases[0]!.assessment.specification.metric.direction;
    return {
      baseline: spec.baseline,
      direction,
      arms: spec.arms.map((arm) => {
        const report = this.methodReport(studyMethodIdentity(arm.method), 'validation');
        const pairs = report.samples.map((sample, index) => {
          const reference = baseline.samples[index]!;
          const complete = sample.complete && reference.complete;
          return {
            caseId: sample.caseId,
            repetition: sample.repetition,
            baseline: reference,
            arm: sample,
            complete,
            scoreDelta: complete ? sample.score! - reference.score! : null,
          };
        });
        return {
          id: arm.id,
          ...report,
          pairedMeanDelta: pairs.every((pair) => pair.complete)
            ? pairs.reduce((sum, pair) => sum + pair.scoreDelta!, 0) / pairs.length
            : null,
          pairs,
        };
      }),
      boundary:
        'All registered methods are evaluated independently. Deltas are arm minus baseline over case × search repetition, including terminal failure values; no method selection or automatic promotion.',
    };
  }
  beginValidation(owner: string): StudyState {
    const spec = developmentStudy(this.spec);
    return this.write(owner, () => {
      const state = this.state();
      if (state.phase === 'validating') return state;
      if (
        state.phase !== 'developing' ||
        this.methods().some((method) => method.phase === 'preparing') ||
        this.metaEpisodes().some((episode) => episode.phase === 'reserved' || episode.phase === 'running')
      )
        throw new Error('Development still has active work');
      const ready = this.methods().filter((method) => method.phase === 'ready');
      const reports = ready.map((method) => this.methodReport(method.methodIdentity!, 'development'));
      if (reports.some((report) => !report.complete))
        throw new Error('Development search-instance denominator is incomplete');
      const baseline = reports.find((report) => report.method === studyMethodIdentity(spec.baseline))!;
      if (baseline.failures > spec.selection.failureLimit)
        throw new Error('Baseline search-instance failures exceed registration');
      const direction = spec.developmentCases[0]!.assessment.specification.metric.direction;
      let best = baseline;
      for (const report of reports) {
        if (report.failures > spec.selection.failureLimit) continue;
        const comparison = compareScores(
          report.samples.map((sample) => sample.score!),
          best.samples.map((sample) => sample.score!),
        );
        if (direction === 'maximize' ? comparison > 0 : comparison < 0) best = report;
      }
      const next: StudyState = { phase: 'validating', selectedMethod: best.method };
      this.setState(next);
      this.event('study.method_selected', { ...next, reports });
      return next;
    });
  }
  finish(owner: string, reason: string): StudyState {
    return this.write(owner, () => {
      const state = this.state();
      if (state.phase !== 'validating' || (!isFixedComparison(this.spec) && !state.selectedMethod) || !reason)
        throw new Error('Study is not awaiting a final report');
      const reports = this.validationMethods().map((method) => this.methodReport(method, 'validation'));
      if (reports.some((report) => !report.complete))
        throw new Error('Validation search-instance denominator is incomplete');
      const next: StudyState = {
        ...state,
        phase: 'complete',
        conclusion: { reason, at: new Date().toISOString() },
      };
      this.setState(next);
      this.event('study.complete', { ...next, reports });
      return next;
    });
  }
  metaEpisodes(): StudyMetaEpisode[] {
    return this.db
      .prepare('SELECT body FROM meta_episodes ORDER BY ordinal')
      .all()
      .map((row) => JSON.parse(String(row.body)));
  }
  private putMeta(episode: StudyMetaEpisode): void {
    this.db
      .prepare('INSERT INTO meta_episodes VALUES (?,?) ON CONFLICT(ordinal) DO UPDATE SET body=excluded.body')
      .run(episode.ordinal, canonical(episode));
  }
  reserveMetaEpisode(owner: string, ordinal: number, seconds: number): StudyMetaEpisode {
    const spec = developmentStudy(this.spec);
    if (!Number.isSafeInteger(ordinal) || ordinal < 0 || !Number.isFinite(seconds) || seconds <= 0)
      throw new Error('Invalid meta optimizer reservation');
    return this.write(owner, () => {
      const episodes = this.metaEpisodes(),
        saved = episodes.find((episode) => episode.ordinal === ordinal);
      if (saved) {
        if (saved.seconds !== seconds) throw new Error('Meta episode allocation changed');
        return saved;
      }
      if (
        this.state().phase !== 'developing' ||
        ordinal !== episodes.length ||
        episodes.some((episode) => episode.phase !== 'complete')
      )
        throw new Error('Meta optimizer is not accepting another episode');
      const consumed = episodes.reduce((sum, episode) => sum + episode.actualSeconds!, 0);
      if (seconds > spec.budget.metaOptimizerSeconds - consumed)
        throw new Error('Meta optimizer time allocation exhausted');
      const episode: StudyMetaEpisode = { ordinal, seconds, phase: 'reserved' };
      this.putMeta(episode);
      this.event('meta.reserved', episode);
      return episode;
    });
  }
  startMetaEpisode(owner: string, ordinal: number): StudyMetaEpisode {
    return this.write(owner, () => {
      const episode = this.metaEpisodes().find((item) => item.ordinal === ordinal);
      if (this.state().phase !== 'developing') throw new Error('Meta episode is not reserved');
      if (episode?.phase === 'running') return episode;
      if (episode?.phase !== 'reserved') throw new Error('Meta episode is not reserved');
      const next: StudyMetaEpisode = { ...episode, phase: 'running' };
      this.putMeta(next);
      this.event('meta.running', next);
      return next;
    });
  }
  finishMetaEpisode(
    owner: string,
    ordinal: number,
    phase: 'complete' | 'failed',
    actualSeconds: number | null,
    receiptDigest: string,
  ): StudyMetaEpisode {
    Digest.parse(receiptDigest);
    if (
      (actualSeconds === null && phase !== 'failed') ||
      (actualSeconds !== null && (!Number.isFinite(actualSeconds) || actualSeconds < 0))
    )
      throw new Error('Invalid measured meta optimizer duration');
    return this.write(owner, () => {
      const episode = this.metaEpisodes().find((item) => item.ordinal === ordinal);
      if (
        episode?.phase === phase &&
        episode.actualSeconds === actualSeconds &&
        episode.receiptDigest === receiptDigest
      )
        return episode;
      if (this.state().phase !== 'developing' || !episode || !['reserved', 'running'].includes(episode.phase))
        throw new Error('Meta episode is not awaiting completion');
      const next: StudyMetaEpisode = { ...episode, phase, actualSeconds, receiptDigest };
      this.putMeta(next);
      this.event('meta.completed', next);
      return next;
    });
  }
  cancel(owner: string, reason: string): StudyState {
    return this.write(owner, () => {
      const state = this.state();
      if (state.phase === 'cancelling' || state.phase === 'cancelled') return state;
      if (state.phase === 'complete' || !reason) throw new Error('Completed study cannot be cancelled');
      const next: StudyState = {
        ...state,
        phase: 'cancelling',
        cancellation: { reason, at: new Date().toISOString() },
      };
      this.setState(next);
      for (const job of this.jobs())
        if (!terminalJobs.has(job.phase)) this.putJob({ ...job, phase: 'cancelling' });
      this.event('study.cancelling', next);
      return next;
    });
  }
  cancelJob(owner: string, id: string, cleanupDigest: string): void {
    Digest.parse(cleanupDigest);
    this.write(owner, () => {
      const job = this.job(id);
      if (job.phase === 'cancelled' && job.cleanupDigest === cleanupDigest) return;
      if (this.state().phase !== 'cancelling' || job.phase !== 'cancelling')
        throw new Error('Study job is not awaiting cancellation cleanup');
      this.putJob({ ...job, phase: 'cancelled', cleanupDigest });
      this.event('job.cancelled', { id, cleanupDigest });
    });
  }
  cancelMethod(owner: string, id: string, cleanupDigest: string): void {
    Digest.parse(cleanupDigest);
    this.write(owner, () => {
      const method = this.method(id);
      if (method.phase === 'cancelled' && method.cleanupDigest === cleanupDigest) return;
      if (this.state().phase !== 'cancelling' || method.phase !== 'preparing')
        throw new Error('Method is not awaiting cancellation cleanup');
      this.putMethod({ ...method, phase: 'cancelled', cleanupDigest });
      this.event('method.cancelled', { id, cleanupDigest });
    });
  }
  cancelMetaEpisode(owner: string, ordinal: number, receiptDigest: string): void {
    Digest.parse(receiptDigest);
    this.write(owner, () => {
      const episode = this.metaEpisodes().find((item) => item.ordinal === ordinal);
      if (episode?.phase === 'cancelled' && episode.receiptDigest === receiptDigest) return;
      if (this.state().phase !== 'cancelling' || !episode || !['reserved', 'running'].includes(episode.phase))
        throw new Error('Meta episode is not awaiting cancellation cleanup');
      this.putMeta({ ...episode, phase: 'cancelled', receiptDigest });
      this.event('meta.cancelled', { ordinal, receiptDigest });
    });
  }
  cleanupRecords(): StudyCleanupRecord[] {
    return this.db
      .prepare("SELECT value FROM metadata WHERE key LIKE 'cleanup:%' ORDER BY key")
      .all()
      .map((row) => JSON.parse(String(row.value)));
  }
  recordCleanup(owner: string, record: StudyCleanupRecord): void {
    Digest.parse(record.digest);
    if (
      !['job-search', 'job-assessment', 'method', 'meta', 'study'].includes(record.kind) ||
      !record.id ||
      !/^[A-Za-z0-9_-]+$/.test(record.id)
    )
      throw Error('Invalid study cleanup record');
    this.write(owner, () => {
      if (!['cancelling', 'cancelled'].includes(this.state().phase))
        throw Error('Study is not being cancelled');
      const key = `cleanup:${record.kind}:${record.id}`,
        saved = this.meta(key);
      if (saved !== undefined) {
        if (saved !== canonical(record)) throw Error('Study cleanup receipt changed');
        return;
      }
      if (this.state().phase === 'cancelled') throw Error('Cancelled study cleanup is immutable');
      this.setMeta(key, canonical(record));
      this.event('study.cleanup', record);
    });
  }
  finishCancellation(owner: string, cleanupDigest: string): StudyState {
    Digest.parse(cleanupDigest);
    return this.write(owner, () => {
      const state = this.state();
      if (state.phase === 'cancelled') {
        if (state.cleanupDigest !== cleanupDigest) throw Error('Study cleanup receipt changed');
        return state;
      }
      if (
        state.phase !== 'cancelling' ||
        this.jobs().some((job) => !terminalJobs.has(job.phase)) ||
        this.methods().some((method) => method.phase === 'preparing') ||
        this.metaEpisodes().some((episode) => episode.phase === 'reserved' || episode.phase === 'running')
      )
        throw new Error('Study still has unreclaimed descendants');
      if (
        !this.cleanupRecords().some(
          (record) => record.kind === 'study' && record.id === 'all' && record.digest === cleanupDigest,
        )
      )
        throw Error('Study cleanup aggregation is not registered');
      const next: StudyState = { ...state, phase: 'cancelled', cleanupDigest };
      this.setState(next);
      this.event('study.cancelled', next);
      return next;
    });
  }
}
