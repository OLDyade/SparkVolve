import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { stringify } from 'yaml';
import { atomicJSON, digest, confined, treeDigest } from './artifacts.js';
import { Docker, type ContainerSpec } from './docker.js';
import type { ExperimentSpec } from './contracts.js';
import { collectRequestMetrics } from './metrics.js';
import { Store } from './store.js';
import { evolutionPreset, sdkPreset } from './preset.js';
import { createEgressSession, type EgressFactory, type EgressLifecycle } from './egress-session.js';
import { controlRoutes } from './control-routes.js';
import { prepareExecution, collectExecution, ReclamationError, settleExecutionFailure } from './execution.js';
import { prepareOptimizer, optimizerBundlePath } from './optimizer-harness.js';
import { assertNotCancelled } from './cancellation-state.js';

interface Episode {
  identity: string;
  name: string;
  ordinal: number;
  seconds: number;
}

/** Each episode is a native DSH session. The experiment owns progression, never model tool execution. */
export async function optimize(
  root: string,
  spec: ExperimentSpec,
  endpoints: { endpoint: string },
  docker = new Docker(),
  signal = new AbortController().signal,
  egress: EgressFactory = createEgressSession,
): Promise<void> {
  signal.throwIfAborted();
  assertNotCancelled(root);
  if (spec.purpose !== 'search') throw new Error('Validation experiments cannot launch an optimizer');
  const store = new Store(path.join(root, 'experiment.sqlite'), spec, 'read');
  try {
    await runOptimizer(root, spec, endpoints, docker, signal, egress, store);
  } finally {
    store.close();
  }
}

async function runOptimizer(
  root: string,
  spec: ExperimentSpec,
  endpoints: { endpoint: string },
  docker: Docker,
  signal: AbortSignal,
  egress: EgressFactory,
  store: Store,
): Promise<void> {
  signal.throwIfAborted();
  assertNotCancelled(root);
  if (spec.purpose !== 'search') throw new Error('Validation experiments cannot launch an optimizer');
  const { endpoint } = endpoints;
  const prepared = await prepareOptimizer(root, path.join(root, 'dataset'), spec, docker, signal);
  const bundle = optimizerBundlePath(root, prepared);
  const qa = spec.candidate.qa;
  const verification = qa ? confined(path.join(root, 'dataset'), qa.directory) : null;
  if (qa && verification && (await treeDigest(verification)) !== qa.digest)
    throw new Error('Domain QA digest mismatch');
  const runRoot = path.join(root, 'optimizer');
  await mkdir(runRoot, { recursive: true });
  await mkdir(path.join(root, 'materialized'), { recursive: true });
  const identity = digest({ root: path.resolve(root), spec, endpoint, optimizer: prepared });
  const token = await readFile(path.join(root, 'controller-token'), 'utf8');
  function schedulingState() {
    return {
      cursor: store.cursor(),
      candidates: store.candidates(),
      probes: store.probes(),
      runs: store.runs(),
      conclusion: store.getMeta('searchConclusion'),
    };
  }
  let consumed = 0;
  let ordinal = 0;
  for (;;) {
    signal.throwIfAborted();
    assertNotCancelled(root);
    const episodeRoot = path.join(runRoot, String(ordinal));
    let episode: Episode | undefined;
    try {
      episode = JSON.parse(await readFile(path.join(episodeRoot, 'intent.json'), 'utf8')) as Episode;
      if (episode.identity !== identity || episode.ordinal !== ordinal)
        throw new Error('Optimizer launch contract changed');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    if (!episode) {
      let state = schedulingState();
      while (
        state.candidates.some((c) => c.phase === 'frozen' || c.phase === 'running') ||
        state.probes.some((probe) => probe.phase === 'queued')
      ) {
        if (state.runs.some((r) => r.phase === 'scoring_failed'))
          throw new Error('Scoring failed; resolve original deliveries before continuing search');
        // This read-only host connection never crosses the optimizer capability boundary.
        // Poll the committed ledger because its notifications belong to the writer connection.
        await store.wait(state.cursor, { timeoutMs: 100, signal });
        state = schedulingState();
      }
      const reason = state.conclusion
        ? 'optimizer_concluded'
        : state.candidates.length >= spec.budget.candidates
          ? 'candidate_budget_exhausted'
          : consumed >= spec.budget.optimizerSeconds
            ? 'optimizer_budget_exhausted'
            : null;
      if (reason) {
        await atomicJSON(path.join(runRoot, 'summary.json'), {
          reason,
          episodes: ordinal,
          consumedSeconds: consumed,
          optimizerHarness: prepared,
        });
        return;
      }
      episode = {
        identity,
        name: `he-opt-${identity.slice(0, 32)}-${ordinal}`,
        ordinal,
        seconds: spec.budget.optimizerSeconds - consumed,
      };
      await mkdir(path.join(episodeRoot, 'trace'), { recursive: true });
      const environment = spec.runtime.environment;
      await writeFile(
        path.join(episodeRoot, 'cordis.patch.yml'),
        stringify([
          {
            insert: [
              ...sdkPreset('evolution', '/app/dist/sdk-preset.js', 'sdk'),
              evolutionPreset({
                plugin: '/app/dist/plugin.js',
                endpoint: 'http://evolution-egress:8080',
                tokenEnv: 'SPARKVOLVE_TOKEN',
                composition: `/method/${spec.optimizerHarness.composition}`,
              }),
            ],
          },
        ]),
      );
      await atomicJSON(path.join(episodeRoot, 'launch.json'), {
        profile: 'sdk',
        model: spec.optimizer,
        patch: '/optimizer.patch.yml',
        environmentPatch: environment ? `/environment/${environment.patch}` : null,
        prompt: [
          `Researcher objective: ${spec.objective}`,
          `Episode ${ordinal}; ${episode.seconds.toFixed(3)} total optimizer seconds remain. Read the actual experiment state.`,
          ordinal
            ? 'Previous native session results and traces are read-only under /previous; editable drafts persist under /workspace. Continue from actual feedback, without resubmitting identical candidates.'
            : 'Begin with the actual experiment state and available baseline evidence.',
        ].join('\n'),
        timeoutSeconds: episode.seconds,
      });
      await writeFile(path.join(episodeRoot, 'intent.json'), JSON.stringify(episode), {
        flag: 'wx',
        mode: 0o600,
      });
    }
    const gateway = egress(
      {
        root: path.join(episodeRoot, 'egress'),
        execution: episode.name,
        image: spec.runtime.image,
        isolation: spec.isolation,
        timeoutSeconds: episode.seconds,
        routes: [...controlRoutes(endpoint, episode.seconds), ...spec.egress.optimizer],
      },
      docker,
    );
    let execution: ContainerSpec | undefined;
    let result;
    const pendingFailure = await settleExecutionFailure(episodeRoot, docker, gateway);
    if (pendingFailure !== null)
      throw Error(`Optimizer episode ${ordinal} failed; ${pendingFailure}; no automatic retry`);
    try {
      execution = await prepareExecution(
        episodeRoot,
        { identity, episode },
        docker,
        gateway,
        () => launch(episode!, episodeRoot, gateway),
        { ...process.env, SPARKVOLVE_TOKEN: token },
      );
      result = await collectExecution(episodeRoot, execution, episodeRoot, docker, gateway, signal);
    } catch (error) {
      signal.throwIfAborted();
      if (error instanceof ReclamationError) throw error;
      await settleExecutionFailure(episodeRoot, docker, gateway, error);
      throw new Error(`Optimizer episode ${ordinal} failed; no automatic retry`, { cause: error });
    }
    await atomicJSON(path.join(episodeRoot, 'container-result.json'), result);
    await collectRequestMetrics(path.join(episodeRoot, 'trace'));
    if (result.ExitCode !== 0)
      throw new Error(`Optimizer episode ${ordinal} failed with exit ${result.ExitCode}; no automatic retry`);
    const duration = (Date.parse(result.FinishedAt) - Date.parse(result.StartedAt)) / 1000;
    if (!Number.isFinite(duration) || duration < 0)
      throw new Error('Optimizer container has invalid timestamps');
    consumed += duration;
    ordinal++;
  }

  async function launch(
    episode: Episode,
    episodeRoot: string,
    gateway: EgressLifecycle,
  ): Promise<import('./docker.js').ContainerSpec> {
    const env: Record<string, string> = Object.fromEntries(
      ['SPARKVOLVE_TOKEN', ...spec.optimizer.credentialEnv].map((key) => [key, 'egress-client-placeholder']),
    );
    const environment = spec.runtime.environment;
    return {
      name: episode.name,
      image: spec.runtime.image,
      command: ['node', '/app/dist/runtime/worker.js', '/launch.json'],
      isolation: spec.isolation,
      network: await gateway.candidateNetwork(),
      env,
      timeoutSeconds: episode.seconds,
      mounts: [
        ...(verification ? [{ source: verification, target: '/verification', writable: false }] : []),
        ...(environment
          ? [
              {
                source: confined(path.join(root, 'dataset'), environment.directory),
                target: '/environment',
                writable: false,
              },
            ]
          : []),
        { source: bundle, target: '/method', writable: false },
        ...(episode.ordinal
          ? [
              {
                source: path.join(runRoot, String(episode.ordinal - 1), 'trace'),
                target: '/previous',
                writable: false,
              },
            ]
          : []),
        { source: path.join(root, 'drafts'), target: '/workspace', writable: true },
        { source: path.join(root, 'materialized'), target: '/evidence', writable: false },
        { source: path.join(episodeRoot, 'trace'), target: '/trace', writable: true },
        { source: path.join(episodeRoot, 'launch.json'), target: '/launch.json', writable: false },
        {
          source: path.join(episodeRoot, 'cordis.patch.yml'),
          target: '/optimizer.patch.yml',
          writable: false,
        },
      ],
    };
  }
}

export async function optimizerLedger(root: string): Promise<unknown[]> {
  const directory = path.join(root, 'optimizer');
  let names: string[];
  try {
    names = await readdir(directory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  return await Promise.all(
    names
      .filter((name) => /^\d+$/.test(name))
      .sort((a, b) => +a - +b)
      .map(async (name) => {
        const result: Record<string, unknown> = { episode: Number(name) };
        for (const [key, file] of [
          ['intent', 'intent.json'],
          ['container', 'container-result.json'],
          ['receipt', 'trace/receipt.json'],
          ['usage', 'trace/metrics.json'],
        ]) {
          try {
            result[key!] = JSON.parse(await readFile(path.join(directory, name, file!), 'utf8'));
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
            result[key!] = null;
          }
        }
        return result;
      }),
  );
}
