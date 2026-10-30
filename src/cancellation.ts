import { mkdir, readFile, realpath, readdir, stat, lstat } from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { atomicJSON, confined, digest, fileDigest, treeDigest } from './artifacts.js';
import { Docker, type ContainerSpec, type ContainerReference } from './docker.js';
import { ExecutionIntent, ExecutionRecord } from './execution.js';
import { EgressSession, type EgressSessionSpec } from './egress-session.js';
import { containerIdentity } from './isolation.js';
import { Experiment } from './contracts.js';
import { Store } from './store.js';
import { resolutions } from './capability-resolution.js';

export interface ExecutionRegistration {
  directory: string;
  role: 'build' | 'qa' | 'optimizer' | 'executor' | 'scorer' | 'probe' | 'resolution';
}
interface Entry extends ExecutionRegistration {
  documents: Record<string, string>;
  spec: ContainerSpec | null;
  reference: ContainerReference | null;
  egress: EgressSessionSpec | null;
  phase: 'pending' | 'stopping' | 'removing' | 'removed' | 'unstarted';
  evidence: string | null;
}
export interface CleanupReceipt {
  identity: string;
  outcome: 'cancelled';
  executions: Array<
    ExecutionRegistration & { reference: ContainerReference | null; evidence: string | null }
  >;
}

async function json(file: string): Promise<unknown | null> {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

async function directory(root: string, relative: string): Promise<string> {
  const target = path.resolve(root, relative);
  if (!relative || path.isAbsolute(relative) || !target.startsWith(root + path.sep))
    throw Error('Cancellation registration must be inside the trusted root');
  try {
    if ((await realpath(target)) !== target) throw Error('Cancellation registration follows a symbolic link');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    // Existing parents also belong to the trusted host, never an optimizer-writable link.
    let parent = path.dirname(target);
    for (;;) {
      try {
        if ((await realpath(parent)) !== parent)
          throw Error('Cancellation registration follows a symbolic link');
        break;
      } catch (parentError) {
        if ((parentError as NodeJS.ErrnoException).code !== 'ENOENT') throw parentError;
        parent = path.dirname(parent);
      }
    }
  }
  return target;
}

async function inspectEntry(root: string, target: ExecutionRegistration, docker: Docker): Promise<Entry> {
  const home = await directory(root, target.directory);
  const documents: Record<string, string> = {};
  async function document(name: string) {
    const value = await json(path.join(home, name));
    if (value !== null) documents[name] = digest(value);
    return value;
  }
  const rawIntent = await document('execution-intent.json');
  const spec = (await document('execution-spec.json')) as ContainerSpec | null;
  const rawRecord = await document('execution-record.json');
  const egress = (await document('egress/contract.json')) as EgressSessionSpec | null;
  if (!rawIntent) {
    if (spec || rawRecord || egress)
      throw Error(`Execution records have no registered intent: ${target.directory}`);
    for (const name of [
      'execution-completion.json',
      'isolation.json',
      'isolation-final.json',
      'stdout.log',
      'stderr.log',
      'egress/intent.json',
      'egress/release.json',
    ]) {
      try {
        await readFile(path.join(home, name));
        throw Error('Execution evidence exists without its original cancellation authority');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    }
    return {
      ...target,
      documents,
      spec: null,
      reference: null,
      egress: null,
      phase: 'unstarted',
      evidence: null,
    };
  }
  const intent = ExecutionIntent.parse(rawIntent);
  if (intent.phase !== 'preparing' && !spec) throw Error('Registered execution specification is missing');
  const record = rawRecord ? ExecutionRecord.parse(rawRecord) : null;
  if (intent.phase === 'created' && !record) throw Error('Registered original execution record is missing');
  let reference = record?.reference ?? null;
  if (
    record &&
    (!spec ||
      record.preparation !== intent.identity ||
      reference!.name !== spec.name ||
      reference!.intent !== containerIdentity(spec))
  )
    throw Error('Cancellation execution identity mismatch');
  const release = (await json(path.join(home, 'egress/release.json'))) as {
    identity: string;
    phase: string;
    containers: ContainerReference[];
  } | null;
  if (egress) {
    if (
      (await realpath(egress.root)) !== path.join(home, 'egress') ||
      (spec && egress.execution !== spec.name)
    )
      throw Error('Cancellation egress contract does not belong to the execution');
    const gateway = new EgressSession(egress, docker);
    const egressIntent = (await json(path.join(egress.root, 'intent.json'))) as {
      identity: string;
      broker: string;
      brokerId: string | null;
    } | null;
    if (!egressIntent && (spec || intent.phase !== 'preparing'))
      throw Error('Original egress lifecycle intent is missing');
    if (egressIntent && egressIntent.identity !== gateway.identity)
      throw Error('Cancellation egress intent changed');
    if (release && release.identity !== gateway.identity) throw Error('Cancellation egress release changed');
    if (egressIntent?.brokerId) {
      const state = await docker.inspect(egressIntent.broker);
      if (state && (await docker.configuration(egressIntent.broker)).Id !== egressIntent.brokerId)
        throw Error('Cancellation found a replacement egress broker');
      if (!state && !release) throw Error('Original egress broker missing without a reclamation record');
    }
  } else if (await json(path.join(home, 'egress/intent.json'))) {
    throw Error('Registered egress intent has no persisted contract');
  } else if (spec && typeof spec.network !== 'string') {
    throw Error('Controlled execution has no persisted egress contract');
  }
  if (spec) {
    const state = await docker.inspect(spec.name);
    if (state) {
      const actual = await docker.executionReference(spec);
      if (reference && digest(actual) !== digest(reference))
        throw Error('Cancellation found a replacement execution container');
      if (intent.phase === 'preparing') throw Error('Execution container exists before its create intent');
      reference = actual;
    } else if (intent.phase !== 'preparing') {
      if (!reference || !release?.containers.some((item) => digest(item) === digest(reference)))
        throw Error('Original execution container missing without a reclamation record');
    }
  }
  return { ...target, documents, spec, reference, egress, phase: 'pending', evidence: null };
}

/** Trusted host API: registrations must come from the experiment ledger, never candidate files. */
export async function cancelExecutionTree(
  root: string,
  registrations: readonly ExecutionRegistration[],
  docker = new Docker(),
): Promise<CleanupReceipt> {
  root = await realpath(root);
  const targets = [...registrations].sort((a, b) => a.directory.localeCompare(b.directory));
  if (new Set(targets.map((item) => item.directory)).size !== targets.length)
    throw Error('Duplicate cancellation execution registration');
  const identity = digest({ root, targets });
  const db = new DatabaseSync(path.join(root, 'cancellation.sqlite'), { timeout: 0 });
  try {
    db.exec(`PRAGMA synchronous=FULL;
      CREATE TABLE IF NOT EXISTS cancellation(id INTEGER PRIMARY KEY CHECK(id=1), identity TEXT NOT NULL, body TEXT NOT NULL, receipt TEXT) STRICT;
      BEGIN IMMEDIATE;`);
    let row = db.prepare('SELECT * FROM cancellation WHERE id=1').get() as
      { identity: string; body: string; receipt: string | null } | undefined;
    if (!row) {
      // Validate every original identity before stopping any resource.
      const entries: Entry[] = [];
      for (const target of targets) entries.push(await inspectEntry(root, target, docker));
      db.prepare('INSERT INTO cancellation VALUES(1,?,?,NULL)').run(identity, JSON.stringify(entries));
      db.exec('COMMIT; BEGIN IMMEDIATE;');
      row = { identity, body: JSON.stringify(entries), receipt: null };
    }
    if (row.identity !== identity) throw Error('Cancellation registration changed');
    const entries = JSON.parse(row.body) as Entry[];
    if (row.receipt) {
      const receipt = JSON.parse(row.receipt) as CleanupReceipt;
      if (digest(await json(path.join(root, 'cancellation.json'))) !== digest(receipt))
        throw Error('Completed cancellation receipt is missing or changed');
      for (const entry of entries)
        if (
          entry.evidence &&
          entry.evidence !==
            (await treeDigest(
              path.join(root, entry.directory, entry.egress ? 'egress' : 'cancellation-evidence'),
            ))
        )
          throw Error('Completed cancellation evidence changed');
      return receipt;
    }
    await atomicJSON(path.join(root, 'cancellation.json'), { identity, outcome: 'cancelling' });
    const save = () => {
      db.prepare('UPDATE cancellation SET body=? WHERE id=1').run(JSON.stringify(entries));
      db.exec('COMMIT; BEGIN IMMEDIATE;');
    };
    for (const entry of entries) {
      const home = await directory(root, entry.directory);
      for (const [name, hash] of Object.entries(entry.documents))
        if (digest(await json(path.join(home, name))) !== hash)
          throw Error('Registered execution evidence changed during cancellation');
      await mkdir(home, { recursive: true });
      await atomicJSON(path.join(home, 'cancellation-intent.json'), { identity, execution: entry.reference });
      if (
        entry.phase === 'removed' &&
        entry.evidence &&
        entry.evidence !==
          (await treeDigest(path.join(home, entry.egress ? 'egress' : 'cancellation-evidence')))
      )
        throw Error('Removed execution cancellation evidence changed');
      if (entry.phase === 'unstarted' || entry.phase === 'removed') continue;
      if (entry.phase === 'pending') {
        entry.phase = 'stopping';
        save();
      }
      if (entry.egress) {
        if (entry.reference && (await docker.inspect(entry.reference.name))) {
          if (digest(await docker.executionReference(entry.spec!)) !== digest(entry.reference))
            throw Error('Cancellation found a replacement execution container');
        } else if (entry.reference && !(await json(path.join(home, 'egress/release.json')))) {
          throw Error('Original execution disappeared before reclamation');
        }
        await new EgressSession(entry.egress, docker).abort(
          entry.spec ?? undefined,
          entry.reference ?? undefined,
        );
        entry.evidence = await treeDigest(path.join(home, 'egress'));
      } else if (entry.spec && entry.reference) {
        const state = await docker.inspect(entry.reference.name);
        if (state && digest(await docker.executionReference(entry.spec)) !== digest(entry.reference))
          throw Error('Cancellation found a replacement execution container');
        if (entry.phase === 'stopping') {
          if (!state) throw Error('Original execution disappeared before cancellation evidence');
          const evidence = await docker.failureEvidence(
            entry.spec,
            path.join(home, 'cancellation-evidence'),
            entry.reference,
          );
          if (digest(evidence) !== digest(entry.reference))
            throw Error('Cancellation evidence reference changed');
          entry.evidence = await treeDigest(path.join(home, 'cancellation-evidence'));
          entry.phase = 'removing';
          save();
        }
        if (entry.evidence !== (await treeDigest(path.join(home, 'cancellation-evidence'))))
          throw Error('Cancellation evidence changed');
        await docker.remove(entry.reference);
      }
      entry.phase = 'removed';
      save();
    }
    const receipt: CleanupReceipt = {
      identity,
      outcome: 'cancelled',
      executions: entries.map(({ directory, role, reference, evidence }) => ({
        directory,
        role,
        reference,
        evidence,
      })),
    };
    // A crash before the final commit resumes the already-removed entries and publishes the same receipt.
    await atomicJSON(path.join(root, 'cancellation.json'), receipt);
    db.prepare('UPDATE cancellation SET receipt=? WHERE id=1').run(JSON.stringify(receipt));
    db.exec('COMMIT;');
    return receipt;
  } finally {
    if (db.isTransaction) db.exec('ROLLBACK');
    db.close();
  }
}

/** Enumerate only host-owned role locations registered by the original experiment. */
export async function cancelExperiment(root: string, docker = new Docker()): Promise<CleanupReceipt> {
  root = await realpath(root);
  const spec = Experiment.parse(await json(path.join(root, 'experiment.json')));
  await stat(path.join(root, 'experiment.sqlite'));
  const store = new Store(path.join(root, 'experiment.sqlite'), spec);
  const owner = randomUUID();
  store.acquire(owner, Date.now(), 30_000);
  const renew = setInterval(() => store.acquire(owner, Date.now(), 30_000), 10_000);
  try {
    const registrations: ExecutionRegistration[] = [];
    const add = (directory: string, role: ExecutionRegistration['role']) =>
      registrations.push({ directory, role });
    for (const candidate of store.candidates()) {
      add(`builds/${candidate.digest}`, 'build');
      add(`qa/${candidate.digest}`, 'qa');
    }
    for (const run of store.runs()) {
      add(`runs/${run.id}`, 'executor');
      for (let attempt = 0; attempt <= run.gradeAttempt; attempt++)
        add(`runs/${run.id}/grading-${attempt}`, 'scorer');
    }
    for (const resolution of resolutions(store)) add(`resolutions/${resolution.id}`, 'resolution');
    for (const probe of store.probes()) {
      add(`probes/${probe.id}/builds/${probe.sourceDigest}`, 'build');
      add(`probes/${probe.id}/logs`, 'probe');
    }
    add(`optimizer-harness/builds/${spec.optimizerHarness.source.digest}`, 'build');
    add('optimizer-harness/qa', 'qa');
    let episodes: string[] = [];
    try {
      episodes = await readdir(path.join(root, 'optimizer'));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    for (const name of episodes.filter((name) => /^\d+$/.test(name))) {
      const episode = (await json(path.join(root, 'optimizer', name, 'intent.json'))) as {
        ordinal: number;
      } | null;
      if (!episode || episode.ordinal !== Number(name))
        throw Error('Optimizer episode has no matching registration');
      add(`optimizer/${name}`, 'optimizer');
    }
    return await cancelExecutionTree(root, registrations, docker);
  } finally {
    clearInterval(renew);
    store.release(owner);
    store.close();
  }
}

/** Cancel only a parent's registered child; absence never creates a child experiment ledger. */
export async function cancelRegisteredChild(
  root: string,
  relative: string,
  specificationDigest: string | undefined,
  docker: Docker,
) {
  const child = confined(root, relative);
  async function present(file: string) {
    try {
      await lstat(file);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw error;
    }
  }
  if ((await present(child)) && (await realpath(child)) !== child)
    throw Error('Parent cancellation child follows a symbolic link');
  const spec = await json(path.join(child, 'experiment.json'));
  if (await present(path.join(child, 'experiment.sqlite'))) {
    if (spec === null) throw Error('Registered child experiment has lost its specification');
    if (specificationDigest === undefined || digest(spec) !== specificationDigest)
      throw Error('Child cancellation specification differs from the parent registration');
    return { state: 'cancelled' as const, root: relative, receipt: await cancelExperiment(child, docker) };
  }
  for (const name of [
    'candidates',
    'drafts',
    'builds',
    'qa',
    'runs',
    'probes',
    'resolutions',
    'optimizer',
    'optimizer-harness',
    'artifacts',
  ])
    if (await present(path.join(child, name)))
      throw Error('Child execution evidence exists without its original experiment ledger');
  let initializationDigest: string | null = null;
  const initialization = path.join(child, 'initialization.sqlite');
  if (await present(initialization)) {
    const db = new DatabaseSync(initialization, { readOnly: true });
    try {
      const row = db.prepare('SELECT phase FROM initialization WHERE id=1').get();
      if (row?.phase === 'prepared') throw Error('Prepared child experiment database is missing');
    } finally {
      db.close();
    }
    initializationDigest = await fileDigest(initialization);
  }
  if (spec !== null && (specificationDigest === undefined || digest(spec) !== specificationDigest))
    throw Error('Partial child specification changed');
  return {
    state: 'unstarted' as const,
    root: relative,
    observations: { specificationDigest: spec === null ? null : digest(spec), initializationDigest },
    receipt: null,
  };
}
