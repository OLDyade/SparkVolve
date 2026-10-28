import { lstat, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { atomicJSON, digest } from './artifacts.js';
import { cancelExecutionTree, cancelRegisteredChild, type ExecutionRegistration } from './cancellation.js';
import { Docker } from './docker.js';
import { RegisteredOptimizerStudy } from './optimizer-study-contracts.js';
import { OptimizerStudyStore } from './optimizer-study-store.js';

async function optional(file: string): Promise<unknown | undefined> {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}
async function present(file: string): Promise<boolean> {
  try {
    await lstat(file);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

/** Call only after the original observer has stopped and released its lease. Recover cleanup, never tasks. */
export async function cancelOptimizerStudy(root: string, docker = new Docker()) {
  root = await realpath(root);
  const spec = RegisteredOptimizerStudy.parse(await optional(path.join(root, 'registration.json')));
  if (!(await present(path.join(root, 'study.sqlite'))))
    throw Error('Optimizer study registration ledger is missing');
  const store = new OptimizerStudyStore(path.join(root, 'study.sqlite'), spec),
    owner = randomUUID();
  let renewal: ReturnType<typeof setInterval> | undefined;
  let leaseError: unknown;
  const assertOwner = () => {
    if (leaseError) throw leaseError;
    store.assertLease(owner);
  };
  try {
    store.acquire(owner, Date.now(), 30_000);
    if (store.state().phase === 'cancelled') {
      const completed = await optional(path.join(root, 'study-cancellation.json'));
      if (completed === undefined || digest(completed) !== store.state().cleanupDigest)
        throw Error('Completed study cancellation receipt is missing or changed');
    }
    renewal = setInterval(() => {
      try {
        assertOwner();
        store.acquire(owner, Date.now(), 30_000);
      } catch (error) {
        leaseError = error;
      }
    }, 5_000);
    store.cancel(owner, 'Explicit cancellation of the parent optimizer study');
    const jobs = store.jobs(),
      methods = store.methods(),
      episodes = store.metaEpisodes();
    const registrations: ExecutionRegistration[] = [];
    for (const method of methods) {
      registrations.push(
        { directory: `methods/${method.id}/optimizer-harness/builds/${method.source.digest}`, role: 'build' },
        { directory: `methods/${method.id}/optimizer-harness/qa`, role: 'qa' },
        { directory: `methods/${method.id}/method-qa`, role: 'qa' },
      );
    }
    for (const episode of episodes)
      registrations.push({ directory: `meta-optimizer/${episode.ordinal}`, role: 'optimizer' });
    const plan = {
      registrationDigest: store.registrationDigest,
      jobs: jobs.map((job) => ({ id: job.id, childRoot: job.childRoot, assessmentRoot: job.assessmentRoot })),
      registrations,
    };
    const file = path.join(root, 'study-cancellation-plan.json'),
      saved = await optional(file);
    if (saved !== undefined && digest(saved) !== digest(plan)) throw Error('Study cancellation plan changed');
    if (saved === undefined) await atomicJSON(file, plan);
    const children = [];
    for (const job of jobs) {
      assertOwner();
      const search = await cancelRegisteredChild(root, job.childRoot, job.childSpecDigest, docker);
      assertOwner();
      store.recordCleanup(owner, { kind: 'job-search', id: job.id, digest: digest(search) });
      const assessment = await cancelRegisteredChild(
        root,
        job.assessmentRoot,
        job.assessmentSpecDigest,
        docker,
      );
      assertOwner();
      store.recordCleanup(owner, { kind: 'job-assessment', id: job.id, digest: digest(assessment) });
      const record = { id: job.id, search, assessment };
      children.push(record);
      const phase = store.job(job.id).phase;
      if (phase === 'cancelling' || phase === 'cancelled') store.cancelJob(owner, job.id, digest(record));
    }
    // Include terminal methods and episodes: their successful completion does not itself reclaim containers.
    const resources = await cancelExecutionTree(root, registrations, docker);
    assertOwner();
    for (const method of methods) {
      const entries = resources.executions.filter((entry) =>
        entry.directory.startsWith(`methods/${method.id}/`),
      );
      const receipt = digest({ id: method.id, executions: entries });
      store.recordCleanup(owner, { kind: 'method', id: method.id, digest: receipt });
      const phase = store.method(method.id).phase;
      if (phase === 'preparing' || phase === 'cancelled') store.cancelMethod(owner, method.id, receipt);
    }
    for (const episode of episodes) {
      const entries = resources.executions.filter(
        (entry) => entry.directory === `meta-optimizer/${episode.ordinal}`,
      );
      const receipt = digest({ ordinal: episode.ordinal, executions: entries });
      store.recordCleanup(owner, { kind: 'meta', id: String(episode.ordinal), digest: receipt });
      const phase = store.metaEpisodes().find((item) => item.ordinal === episode.ordinal)!.phase;
      if (phase === 'reserved' || phase === 'running' || phase === 'cancelled')
        store.cancelMetaEpisode(owner, episode.ordinal, receipt);
    }
    const receipt = {
      registrationDigest: store.registrationDigest,
      planDigest: digest(plan),
      children,
      resources,
    };
    const receiptFile = path.join(root, 'study-cancellation.json'),
      savedReceipt = await optional(receiptFile);
    if (savedReceipt !== undefined && digest(savedReceipt) !== digest(receipt))
      throw Error('Study cancellation receipt changed');
    if (savedReceipt === undefined) await atomicJSON(receiptFile, receipt);
    assertOwner();
    store.recordCleanup(owner, { kind: 'study', id: 'all', digest: digest(receipt) });
    store.finishCancellation(owner, digest(receipt));
    return receipt;
  } finally {
    if (renewal) clearInterval(renewal);
    store.release(owner);
    store.close();
  }
}
