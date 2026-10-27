import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { stringify } from 'yaml';
import { atomicJSON, digest, confined, treeDigest } from './artifacts.js';
import { Docker } from './docker.js';
import type { ExperimentSpec } from './contracts.js';
import { collectRequestMetrics } from './metrics.js';
import { Store } from './store.js';

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
  endpoint: string,
  docker = new Docker(),
  signal = new AbortController().signal,
): Promise<void> {
  if (spec.purpose !== 'search') throw new Error('Validation experiments cannot launch an optimizer');
  const bundle = confined(path.join(root, 'dataset'), spec.optimizerHarness.directory);
  if ((await treeDigest(bundle)) !== spec.optimizerHarness.digest)
    throw new Error('Optimizer bundle digest mismatch');
  const runRoot = path.join(root, 'optimizer');
  await mkdir(runRoot, { recursive: true });
  const identity = digest({ root: path.resolve(root), spec, endpoint });
  const store = new Store(path.join(root, 'experiment.sqlite'), spec);
  const token = await readFile(path.join(root, 'controller-token'), 'utf8');
  try {
    let consumed = 0;
    let ordinal = 0;
    for (;;) {
      signal.throwIfAborted();
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
        while (store.candidates().some((c) => c.phase === 'frozen' || c.phase === 'running')) {
          if (store.runs().some((r) => r.phase === 'scoring_failed'))
            throw new Error('Scoring failed; resolve original deliveries before continuing search');
          await delay(500, undefined, { signal });
        }
        const reason = store.getMeta('searchConclusion')
          ? 'optimizer_concluded'
          : store.candidates().length >= spec.budget.candidates
            ? 'candidate_budget_exhausted'
            : consumed >= spec.budget.optimizerSeconds
              ? 'optimizer_budget_exhausted'
              : null;
        if (reason) {
          await atomicJSON(path.join(runRoot, 'summary.json'), {
            reason,
            episodes: ordinal,
            consumedSeconds: consumed,
            optimizerHarness: spec.optimizerHarness.digest,
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
                {
                  id: 'harness-evolution',
                  name: '/app/dist/plugin.js',
                  config: { endpoint, tokenEnv: 'EVOLUTION_TOKEN' },
                },
              ],
            },
          ]),
        );
        await atomicJSON(path.join(episodeRoot, 'launch.json'), {
          profile: 'sdk',
          model: spec.optimizer,
          patch: '/optimizer.patch.yml',
          methodPatch: `/method/${spec.optimizerHarness.patch}`,
          environmentPatch: environment ? `/environment/${environment.patch}` : null,
          prompt: [
            `Researcher objective: ${spec.objective}`,
            `Episode ${ordinal}; ${episode.seconds.toFixed(3)} total optimizer seconds remain. Read the actual experiment state.`,
            ordinal
              ? 'Previous native session results and traces are read-only under /previous; editable drafts persist under /workspace. Continue from actual feedback, without resubmitting identical candidates.'
              : 'Begin with the completed baseline evidence.',
          ].join('\n'),
          timeoutSeconds: episode.seconds,
        });
        await writeFile(path.join(episodeRoot, 'intent.json'), JSON.stringify(episode), {
          flag: 'wx',
          mode: 0o600,
        });
        await docker.create(await launch(episode, episodeRoot, true));
      }
      const result = await docker.collect(await launch(episode, episodeRoot, false), episodeRoot, signal);
      await atomicJSON(path.join(episodeRoot, 'container-result.json'), result);
      await collectRequestMetrics(path.join(episodeRoot, 'trace'));
      if (result.ExitCode !== 0)
        throw new Error(
          `Optimizer episode ${ordinal} failed with exit ${result.ExitCode}; no automatic retry`,
        );
      const duration = (Date.parse(result.FinishedAt) - Date.parse(result.StartedAt)) / 1000;
      if (!Number.isFinite(duration) || duration < 0)
        throw new Error('Optimizer container has invalid timestamps');
      consumed += duration;
      ordinal++;
    }
  } finally {
    store.close();
  }

  async function launch(
    episode: Episode,
    episodeRoot: string,
    fresh: boolean,
  ): Promise<import('./docker.js').ContainerSpec> {
    const env: Record<string, string> = fresh ? { EVOLUTION_TOKEN: token } : {};
    if (fresh)
      for (const key of spec.optimizer.credentialEnv) {
        const value = process.env[key];
        if (!value) throw new Error(`Missing optimizer credential ${key}`);
        env[key] = value;
      }
    const environment = spec.runtime.environment;
    return {
      name: episode.name,
      image: spec.runtime.image,
      command: ['node', '/app/dist/runtime/worker.js', '/launch.json'],
      network: 'bridge',
      env,
      timeoutSeconds: episode.seconds,
      mounts: [
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
