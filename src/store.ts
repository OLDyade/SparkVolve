import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { canonical, digest } from './artifacts.js';
import type { Candidate, ExperimentSpec, RunPhase, TaskRun } from './contracts.js';
import { Grade } from './contracts.js';

const edges: Record<RunPhase, readonly RunPhase[]> = {
  queued: ['executing', 'cancelled'],
  executing: ['delivered', 'execution_failed'],
  delivered: ['scoring'],
  scoring: ['scored', 'scoring_failed'],
  scoring_failed: ['scoring'],
  execution_failed: [],
  scored: [],
  cancelled: [],
};

/** The controller owns this database. Optimizers and candidate containers never mount it. */
export class Store {
  readonly db: DatabaseSync;
  constructor(
    file: string,
    readonly spec: ExperimentSpec,
  ) {
    this.db = new DatabaseSync(file);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS metadata(key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS candidates(id TEXT PRIMARY KEY, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS runs(id TEXT PRIMARY KEY, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS events(seq INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, type TEXT NOT NULL, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS lease(id INTEGER PRIMARY KEY CHECK(id=1), owner TEXT NOT NULL, expires INTEGER NOT NULL);`);
    const old = this.getMeta('spec');
    if (old !== undefined && old !== digest(spec))
      throw new Error('Experiment specification changed; use a new experiment directory');
    this.setMeta('spec', digest(spec));
    this.db.prepare('INSERT OR IGNORE INTO metadata VALUES (?,?)').run('experimentId', randomUUID());
  }
  close(): void {
    this.db.close();
  }
  transaction<T>(action: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = action();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
  getMeta(key: string): string | undefined {
    return (
      this.db.prepare('SELECT value FROM metadata WHERE key=?').get(key) as { value: string } | undefined
    )?.value;
  }
  setMeta(key: string, value: string): void {
    this.db
      .prepare('INSERT INTO metadata VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value')
      .run(key, value);
  }
  event(type: string, body: unknown): void {
    this.db
      .prepare('INSERT INTO events(at,type,body) VALUES (?,?,?)')
      .run(new Date().toISOString(), type, canonical(body));
  }
  events(): Array<{ sequence: number; at: string; type: string; body: unknown }> {
    return this.db
      .prepare('SELECT seq,at,type,body FROM events ORDER BY seq')
      .all()
      .map((row) => ({
        sequence: Number(row.seq),
        at: String(row.at),
        type: String(row.type),
        body: JSON.parse(String(row.body)) as unknown,
      }));
  }
  decision(candidate: string): unknown {
    const row = this.db
      .prepare(
        "SELECT body FROM events WHERE type='candidate.decision' AND json_extract(body,'$.candidate')=? ORDER BY seq DESC LIMIT 1",
      )
      .get(candidate);
    if (!row) throw new Error('Decided candidate has no authoritative decision event');
    return JSON.parse(row.body as string) as unknown;
  }
  acquire(owner: string, now: number, ttl: number): void {
    this.transaction(() => {
      const lease = this.db.prepare('SELECT * FROM lease WHERE id=1').get() as
        { owner: string; expires: number } | undefined;
      if (lease && lease.owner !== owner && lease.expires > now)
        throw new Error('Experiment has an active controller');
      this.db
        .prepare(
          'INSERT INTO lease VALUES (1,?,?) ON CONFLICT(id) DO UPDATE SET owner=excluded.owner,expires=excluded.expires',
        )
        .run(owner, now + ttl);
    });
  }
  assertLease(owner: string): void {
    const lease = this.db.prepare('SELECT * FROM lease WHERE id=1').get() as
      { owner: string; expires: number } | undefined;
    if (!lease || lease.owner !== owner || lease.expires <= Date.now())
      throw new Error('Controller lease lost');
  }
  release(owner: string): void {
    this.db.prepare('DELETE FROM lease WHERE owner=?').run(owner);
  }
  candidates(): Candidate[] {
    return this.db
      .prepare('SELECT body FROM candidates ORDER BY rowid')
      .all()
      .map((row) => JSON.parse(row.body as string) as Candidate);
  }
  candidate(id: string): Candidate {
    const row = this.db.prepare('SELECT body FROM candidates WHERE id=?').get(id);
    if (!row) throw new Error(`Unknown candidate ${id}`);
    return JSON.parse(row.body as string) as Candidate;
  }
  addCandidate(candidate: Candidate): void {
    this.transaction(() => {
      if (this.candidates().length >= this.spec.budget.candidates)
        throw new Error('Candidate budget exhausted');
      for (const parent of candidate.proposal.parents) this.candidate(parent);
      this.db.prepare('INSERT INTO candidates VALUES (?,?)').run(candidate.digest, canonical(candidate));
      this.event('candidate.frozen', candidate);
    });
  }
  updateCandidate(candidate: Candidate): void {
    this.db.prepare('UPDATE candidates SET body=? WHERE id=?').run(canonical(candidate), candidate.digest);
  }
  runs(candidate?: string): TaskRun[] {
    return this.db
      .prepare('SELECT body FROM runs ORDER BY rowid')
      .all()
      .map((row) => JSON.parse(row.body as string) as TaskRun)
      .filter((run) => candidate === undefined || run.candidate === candidate);
  }
  addRuns(runs: TaskRun[]): void {
    this.transaction(() => {
      for (const run of runs) this.db.prepare('INSERT INTO runs VALUES (?,?)').run(run.id, canonical(run));
    });
  }
  admit(candidate: Candidate, runs: TaskRun[]): void {
    this.transaction(() => {
      this.updateCandidate({ ...candidate, phase: 'running' });
      for (const run of runs) this.db.prepare('INSERT INTO runs VALUES (?,?)').run(run.id, canonical(run));
      this.event('candidate.admitted', { candidate: candidate.digest, runs: runs.map((r) => r.id) });
    });
  }
  transition(id: string, from: RunPhase, to: RunPhase, extra: Partial<TaskRun> = {}): TaskRun {
    return this.transaction(() => {
      const row = this.db.prepare('SELECT body FROM runs WHERE id=?').get(id);
      if (!row) throw new Error(`Unknown run ${id}`);
      const old = JSON.parse(row.body as string) as TaskRun;
      if (old.phase !== from || !edges[from].includes(to))
        throw new Error(`Invalid transition ${old.phase}: ${from} -> ${to}`);
      if (
        'id' in extra ||
        'candidate' in extra ||
        'task' in extra ||
        'phase' in extra ||
        'attempt' in extra ||
        'repetition' in extra
      )
        throw new Error('Run identity is immutable');
      const next = { ...old, ...extra, phase: to };
      if (to === 'scored') {
        const grade = Grade.parse(next.grade);
        if (grade.score < this.spec.metric.minimum || grade.score > this.spec.metric.maximum)
          throw new Error('Score outside experiment bounds');
      }
      this.db.prepare('UPDATE runs SET body=? WHERE id=?').run(canonical(next), id);
      this.event('run.transition', { id, from, to, extra });
      return next;
    });
  }
  decide(candidateId: string): { promoted: boolean; mean: number; failures: number } {
    return this.transaction(() => {
      const candidate = this.candidate(candidateId);
      if (candidate.phase !== 'running') throw new Error('Candidate is not awaiting a decision');
      const runs = this.runs(candidateId);
      const expected = new Set(
        this.spec.tasks.flatMap((t) =>
          Array.from({ length: this.spec.repetitions }, (_, i) => `${t.id}/${i}`),
        ),
      );
      const actual = runs.map((r) => `${r.task}/${r.repetition}`);
      if (
        runs.length !== expected.size ||
        new Set(actual).size !== expected.size ||
        actual.some((key) => !expected.has(key))
      )
        throw new Error('Incomplete or mixed task denominator');
      if (runs.some((r) => !['scored', 'execution_failed', 'cancelled'].includes(r.phase)))
        throw new Error('Experiment still has unscored tasks');
      const failures = runs.filter((r) => r.phase !== 'scored').length;
      const mean =
        runs.reduce((sum, r) => sum + (r.grade?.score ?? this.spec.metric.failure), 0) / runs.length;
      const championId = this.getMeta('champion');
      const champion = championId === undefined ? undefined : this.candidate(championId);
      const better =
        champion?.mean === undefined ||
        (this.spec.metric.direction === 'maximize' ? mean > champion.mean : mean < champion.mean);
      const promoted = failures <= this.spec.failureLimit && better;
      this.updateCandidate({ ...candidate, mean, phase: promoted ? 'champion' : 'rejected' });
      if (promoted) this.setMeta('champion', candidateId);
      this.event('candidate.decision', {
        candidate: candidateId,
        previousChampion: championId ?? null,
        promoted,
        mean,
        failures,
        denominator: runs.length,
      });
      return { promoted, mean, failures };
    });
  }
}
