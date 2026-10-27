import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { atomicJSON, confined, digest, freeze, treeDigest } from './artifacts.js';
import { buildCandidate, bundlePath, verifyBuild } from './build.js';
import { ProbeRequest, type Probe, type Candidate, type ExperimentSpec } from './contracts.js';
import type { Store } from './store.js';
import type { Docker } from './docker.js';

/** A probe is an optimizer-authored experiment, isolated from scores and candidate admission. */
export async function queueProbe(root: string, store: Store, raw: unknown): Promise<Probe> {
  if (store.spec.purpose !== 'search' || !store.spec.probes || store.getMeta('searchConclusion'))
    throw new Error('Probes are not authorized for this experiment');
  if (store.probes().length >= store.spec.probes.limit) throw new Error('Probe budget exhausted');
  const request = ProbeRequest.parse(raw);
  const source = confined(path.join(root, 'drafts'), request.draft);
  const suite = confined(path.join(root, 'drafts'), request.suite);
  if (source === suite) throw new Error('Probe suite must be separate from the candidate draft');
  const sourceDigest = await treeDigest(source),
    suiteDigest = await treeDigest(suite);
  const id = digest({ sourceDigest, suiteDigest, entry: request.entry });
  if (store.probes().some((probe) => probe.id === id))
    throw new Error('Identical probe already recorded; inspect its evidence');
  const directory = path.join(root, 'probes', id);
  let probe: Probe = {
    id,
    request,
    sourceDigest,
    suiteDigest,
    phase: 'queued',
    queuedAt: new Date().toISOString(),
  };
  await mkdir(directory, { recursive: true });
  const intent = path.join(directory, 'intent.json');
  try {
    await writeFile(intent, JSON.stringify(probe), { flag: 'wx', mode: 0o600 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    probe = JSON.parse(await readFile(intent, 'utf8')) as Probe;
    if (
      probe.id !== id ||
      probe.sourceDigest !== sourceDigest ||
      probe.suiteDigest !== suiteDigest ||
      probe.request.entry !== request.entry ||
      probe.phase !== 'queued'
    )
      throw new Error('Probe preparation identity mismatch');
  }
  // Recover completed snapshots after interruption before database registration; never replace them.
  async function snapshot(input: string, destination: string, expected: string) {
    try {
      await stat(destination);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      if ((await freeze(input, destination)) !== expected)
        throw new Error('Probe input changed before freezing');
      return;
    }
    if ((await treeDigest(destination)) !== expected) throw new Error('Interrupted probe snapshot mismatch');
  }
  await snapshot(source, path.join(directory, 'candidates', sourceDigest), sourceDigest);
  await snapshot(suite, path.join(directory, 'suite'), suiteDigest);
  store.addProbe(probe);
  return probe;
}

/** Reconciles the original named build/execution containers after interruption. No task is rerun. */
export async function executeProbe(options: {
  root: string;
  dataset: string;
  spec: ExperimentSpec;
  store: Store;
  docker: Docker;
  probe: Probe;
  assertOwner: () => void;
  signal?: AbortSignal;
}): Promise<void> {
  const { root, dataset, spec, store, docker, assertOwner, signal } = options;
  let probe = options.probe;
  const directory = path.join(root, 'probes', probe.id);
  const candidate: Candidate = {
    digest: probe.sourceDigest,
    ordinal: 0,
    phase: 'frozen',
    proposal: {
      draft: probe.request.draft,
      parents: [],
      actions: ['compose'],
      evidence: [probe.id],
      hypothesis: probe.request.hypothesis,
      expectedChange: 'Observe the authored behavioral probe; no score claim',
    },
    ...(probe.build ? { build: probe.build } : {}),
  };
  try {
    if ((await treeDigest(path.join(directory, 'suite'))) !== probe.suiteDigest)
      throw new Error('Frozen probe suite changed');
    if (!candidate.build) {
      candidate.build = await buildCandidate(
        directory,
        `${store.getMeta('experimentId')}:${probe.id}`,
        spec,
        candidate,
        docker,
        signal,
      );
      assertOwner();
      probe = { ...probe, build: candidate.build };
      store.updateProbe(probe);
    }
    await verifyBuild(directory, candidate);
    const work = path.join(directory, 'work');
    await mkdir(work, { recursive: true });
    const environment = spec.runtime.environment;
    const launch = path.join(directory, 'launch.json');
    await atomicJSON(launch, {
      profile: spec.runtime.profile,
      model: spec.executor,
      patches: [
        ...(environment ? [`/environment/${environment.patch}`] : []),
        `/candidate/${spec.candidate.patch}`,
      ],
      command: null,
      behaviorModule: `/suite/${probe.request.entry}`,
      timeoutSeconds: spec.probes!.timeoutSeconds,
    });
    const result = await docker.run(
      {
        name: `he-probe-${digest([store.getMeta('experimentId'), probe.id]).slice(0, 32)}`,
        image: spec.runtime.image,
        command: ['node', '/app/dist/runtime/qa.js', '/probe-launch.json'],
        mounts: [
          ...(environment
            ? [{ source: confined(dataset, environment.directory), target: '/environment', writable: false }]
            : []),
          { source: bundlePath(directory, candidate), target: '/candidate', writable: false },
          { source: path.join(directory, 'suite'), target: '/suite', writable: false },
          { source: work, target: '/workspace', writable: true },
          { source: launch, target: '/probe-launch.json', writable: false },
        ],
        env: {},
        network: 'none',
        isolation: spec.isolation,
        timeoutSeconds: spec.probes!.timeoutSeconds,
      },
      path.join(directory, 'logs'),
      signal,
    );
    assertOwner();
    store.updateProbe({
      ...probe,
      phase: result.ExitCode === 0 ? 'passed' : 'failed',
      exitCode: result.ExitCode,
      executionMilliseconds: Date.parse(result.FinishedAt) - Date.parse(result.StartedAt),
      completedAt: new Date().toISOString(),
      ...(result.ExitCode
        ? { error: `Probe container exited ${result.ExitCode}; inspect original logs` }
        : {}),
    });
  } catch (error) {
    signal?.throwIfAborted();
    assertOwner();
    store.updateProbe({
      ...probe,
      phase: 'failed',
      error: String(error),
      completedAt: new Date().toISOString(),
    });
  }
}
