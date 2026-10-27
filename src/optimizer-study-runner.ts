import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { stringify } from 'yaml';
import { atomicJSON, confined, digest, fileDigest, treeDigest } from './artifacts.js';
import { verifyArtifact } from './build.js';
import { assertNotCancelled } from './cancellation-state.js';
import { closeControlServer, listenControlTransport } from './control-transport.js';
import { Digest } from './contracts.js';
import { readJSON, type ContainerSpec } from './docker.js';
import { createEgressSession, type EgressFactory } from './egress-session.js';
import { collectExecution, prepareExecution, ReclamationError, settleExecutionFailure } from './execution.js';
import { readAuthorizedFile } from './file-reader.js';
import { collectRequestMetrics } from './metrics.js';
import type { OptimizerStudyCoordinator, StudyTransport } from './optimizer-study.js';
import { developmentStudy, isFixedComparison } from './optimizer-study-contracts.js';
import { evolutionPreset, sdkPreset } from './preset.js';
import { serveStudy } from './study-api.js';
import { studyControlRoutes } from './study-control.js';
import { materializeStudyEvidence, readStudyEvidence, readStudySearch } from './study-evidence.js';

export interface OptimizerStudyRunnerOptions extends StudyTransport {
  childTransport: StudyTransport;
  signal?: AbortSignal;
}

/** Fixed comparisons need child transports only; no meta HTTP service or worker is opened. */
export async function runFixedOptimizerComparison(
  coordinator: OptimizerStudyCoordinator,
  options: Pick<OptimizerStudyRunnerOptions, 'childTransport' | 'signal'>,
): Promise<unknown> {
  if (!isFixedComparison(coordinator.spec)) throw Error('Fixed comparison registration required');
  options.signal?.throwIfAborted();
  assertNotCancelled(coordinator.root);
  await coordinator.start();
  try {
    if (coordinator.store.state().phase !== 'complete')
      await coordinator.runValidation(options.childTransport, options.signal);
    await coordinator.report();
    return coordinator.reportSnapshot();
  } finally {
    await coordinator.close();
  }
}
const Conclusion = z.strictObject({
  reason: z.string().min(1),
  at: z.iso.datetime(),
  registrationDigest: Digest,
});
const Intent = z.strictObject({
  identity: Digest,
  name: z.string().min(1),
  ordinal: z.number().int().nonnegative(),
  seconds: z.number().positive(),
});

async function optionalJSON(file: string): Promise<unknown | undefined> {
  try {
    return await readJSON(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    return undefined;
  }
}

/** Runs the frozen meta method through native DSH; sealed assessment stays entirely host-side. */
export async function evolveOptimizerStudy(
  coordinator: OptimizerStudyCoordinator,
  options: OptimizerStudyRunnerOptions,
  egress: EgressFactory = createEgressSession,
): Promise<unknown> {
  const { root, store, docker, owner } = coordinator;
  const observation = new AbortController();
  const signal = options.signal ? AbortSignal.any([options.signal, observation.signal]) : observation.signal;
  signal.throwIfAborted();
  assertNotCancelled(root);
  await coordinator.start();
  let server: Awaited<ReturnType<typeof listenControlTransport>>['server'] | undefined;
  let pumping: Promise<void> | undefined;
  let pumpFailure: unknown;
  let wake: (() => void) | undefined;
  let queued = false;
  let stopPump = false;
  const notify = () => {
    queued = true;
    wake?.();
  };
  try {
    const phase = store.state().phase;
    if (phase === 'complete') {
      await coordinator.report();
      return coordinator.reportSnapshot();
    }
    if (phase === 'validating') {
      await coordinator.runValidation(options.childTransport, signal);
      return coordinator.reportSnapshot();
    }
    if (phase !== 'developing') throw Error(`Study cannot evolve while ${phase}`);
    const spec = developmentStudy(coordinator.spec);
    const home = path.join(root, 'meta-optimizer');
    await mkdir(home, { recursive: true });
    await mkdir(path.join(root, 'drafts'), { recursive: true });
    await mkdir(path.join(root, 'materialized'), { recursive: true });
    const tokenFile = path.join(root, 'meta-controller-token');
    try {
      await writeFile(tokenFile, randomBytes(32).toString('hex'), { flag: 'wx', mode: 0o600 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
    const token = await readFile(tokenFile, 'utf8');
    if (!/^[a-f0-9]{64}$/.test(token)) throw Error('Invalid persisted study capability');
    const transport = await listenControlTransport(
      home,
      { host: options.host, port: options.port, endpoint: options.endpoint },
      (port) =>
        serveStudy(
          {
            status: () => coordinator.publicStatus(),
            search: (jobID) => readStudySearch(coordinator, jobID),
            evidence: (reference) => readStudyEvidence(coordinator, reference),
            materialize: (reference) => materializeStudyEvidence(coordinator, reference),
            branch: (parent, draft) => coordinator.branch(parent, draft),
            submit: async (proposal) => {
              const result = await coordinator.submitMethod(proposal, signal);
              notify();
              return result;
            },
            events: (request, observer) => coordinator.events(request, observer),
            finish: async (reason) => {
              await coordinator.finishDevelopment(reason);
              return { concluded: true, reason };
            },
          },
          token,
          port,
          options.host,
          signal,
        ),
      signal,
    );
    server = transport.server;
    // API submissions publish an intent immediately. The independent pump executes their native searches.
    pumping = (async () => {
      while (!stopPump) {
        if (!queued)
          await new Promise<void>((resolve) => {
            wake = () => resolve();
            signal.addEventListener('abort', wake, { once: true });
            if (signal.aborted) wake();
          });
        const listener = wake;
        wake = undefined;
        if (listener) signal.removeEventListener('abort', listener);
        signal.throwIfAborted();
        if (stopPump) break;
        queued = false;
        await coordinator.pump(options.childTransport, signal);
      }
    })().catch((error: unknown) => {
      pumpFailure = error;
      observation.abort(error);
    });
    // Restore the original HTTP capability before awaiting any in-flight development searches.
    notify();

    const method = spec.metaOptimizer;
    const source = confined(coordinator.inputs, method.source.directory);
    const artifact = confined(coordinator.inputs, method.artifact.directory);
    if (
      (await treeDigest(source)) !== method.source.digest ||
      (await fileDigest(path.join(source, 'package-lock.json'))) !== method.artifact.identity.lockDigest
    )
      throw Error('Meta optimizer source or lock mismatch');
    await verifyArtifact(artifact, method.source.digest, method.artifact.identity);
    const bundle = path.join(artifact, 'bundle');
    await readAuthorizedFile(bundle, method.composition);
    const environment = spec.metaRuntime.runtime.environment;
    const environmentPath = environment ? confined(coordinator.inputs, environment.directory) : null;
    if (environment && environmentPath && (await treeDigest(environmentPath)) !== environment.digest)
      throw Error('Meta runtime environment digest mismatch');
    const identity = digest({
      root: path.resolve(root),
      registrationDigest: store.registrationDigest,
      endpoint: transport.record.endpoint,
      method,
      runtime: spec.metaRuntime,
    });

    for (;;) {
      signal.throwIfAborted();
      assertNotCancelled(root);
      store.assertLease(owner);
      const episodes = store.metaEpisodes();
      for (const archived of episodes.filter(
        (item) => item.phase === 'complete' || item.phase === 'failed',
      )) {
        const receipt = await readJSON(path.join(home, String(archived.ordinal), 'receipt.json'));
        if (digest(receipt) !== archived.receiptDigest) throw Error('Meta episode receipt digest mismatch');
      }
      if (episodes.some((item) => item.phase === 'failed'))
        throw Error('Meta optimizer episode failed; original attempt retained, no automatic retry');
      let episode = episodes.find((item) => item.phase === 'reserved' || item.phase === 'running');
      if (!episode) {
        await coordinator.pump(options.childTransport, signal);
        const conclusion = await optionalJSON(path.join(root, 'development-conclusion.json'));
        if (conclusion !== undefined) {
          if (Conclusion.parse(conclusion).registrationDigest !== store.registrationDigest)
            throw Error('Development conclusion registration mismatch');
          break;
        }
        const consumed = episodes.reduce((sum, item) => sum + item.actualSeconds!, 0);
        const remaining = spec.budget.metaOptimizerSeconds - consumed;
        if (remaining <= 0 || store.methods().length >= spec.budget.methodCandidates) {
          await coordinator.finishDevelopment(
            remaining <= 0 ? 'meta_optimizer_budget_exhausted' : 'method_candidate_budget_exhausted',
          );
          break;
        }
        episode = store.reserveMetaEpisode(owner, episodes.length, remaining);
      }
      const episodeRoot = path.join(home, String(episode.ordinal));
      const intent = Intent.parse({
        identity,
        name: `he-meta-${identity.slice(0, 32)}-${episode.ordinal}`,
        ordinal: episode.ordinal,
        seconds: episode.seconds,
      });
      await mkdir(path.join(episodeRoot, 'trace'), { recursive: true });
      const saved = await optionalJSON(path.join(episodeRoot, 'intent.json'));
      if (saved !== undefined) {
        if (digest(Intent.parse(saved)) !== digest(intent))
          throw Error('Meta optimizer episode contract changed');
      } else {
        await writeFile(
          path.join(episodeRoot, 'cordis.patch.yml'),
          stringify([
            {
              insert: [
                ...sdkPreset('evolution', '/app/dist/sdk-preset.js'),
                evolutionPreset({
                  plugin: '/app/dist/study-plugin.js',
                  endpoint: 'http://evolution-egress:8080',
                  tokenEnv: 'EVOLUTION_TOKEN',
                  composition: `/method/${method.composition}`,
                }),
              ],
            },
          ]),
        );
        await atomicJSON(path.join(episodeRoot, 'launch.json'), {
          profile: 'sdk',
          model: spec.metaRuntime.model,
          patch: '/optimizer.patch.yml',
          environmentPatch: environment ? `/environment/${environment.patch}` : null,
          prompt: [
            `Researcher objective: ${spec.objective}`,
            `Evolve the optimizer's plugin implementation and composition from registered development evidence.`,
            `Read the actual study status. Branch an authorized method into /workspace, edit its native plugin source and submit the proposal with its composition.`,
            `Submitted methods execute independently; observe their development results through study events and status. Call study finish after the work has settled when the evidence is sufficient.`,
            `Episode ${episode.ordinal}; ${episode.seconds} allocated model-session seconds remain. All prior attempts and feedback are retained.`,
            episode.ordinal ? 'Previous native session trace is read-only under /previous.' : '',
            'Final validation is host-owned and unavailable to this session. Do not infer its data or scores.',
          ]
            .filter(Boolean)
            .join('\n'),
          timeoutSeconds: episode.seconds,
        });
        await writeFile(path.join(episodeRoot, 'intent.json'), JSON.stringify(intent), {
          flag: 'wx',
          mode: 0o600,
        });
      }
      const gateway = egress(
        {
          root: path.join(episodeRoot, 'egress'),
          execution: intent.name,
          image: spec.metaRuntime.runtime.image,
          isolation: spec.metaRuntime.isolation,
          timeoutSeconds: intent.seconds,
          routes: [
            ...studyControlRoutes(transport.record.endpoint, intent.seconds),
            ...spec.metaRuntime.egress,
          ],
        },
        docker,
      );
      let result: Awaited<ReturnType<typeof collectExecution>> | undefined;
      let metricsRead = false;
      let metricsError: unknown;
      const collectUsage = async () => {
        metricsRead = true;
        try {
          await collectRequestMetrics(path.join(episodeRoot, 'trace'));
        } catch (error) {
          metricsError = error;
          throw error;
        }
      };
      const recordFailure = async (error: unknown) => {
        const current = store.metaEpisodes().find((item) => item.ordinal === episode.ordinal);
        if (!current || !['reserved', 'running'].includes(current.phase)) return;
        if (!metricsRead) {
          try {
            await collectUsage();
          } catch {
            // Keep the malformed original records and their error in this failed attempt's receipt.
          }
        }
        const container =
          result ?? (await optionalJSON(path.join(episodeRoot, 'container-result.json'))) ?? null;
        let actualSeconds: number | null = null;
        if (
          container &&
          typeof container === 'object' &&
          'StartedAt' in container &&
          'FinishedAt' in container
        ) {
          const seconds =
            (Date.parse(String(container.FinishedAt)) - Date.parse(String(container.StartedAt))) / 1000;
          if (Number.isFinite(seconds) && seconds >= 0) actualSeconds = seconds;
        }
        const receipt = {
          intent,
          error: String(error),
          metricsError: metricsError ? String(metricsError) : null,
          container,
          actualSeconds,
        };
        await atomicJSON(path.join(episodeRoot, 'receipt.json'), receipt);
        store.finishMetaEpisode(owner, episode.ordinal, 'failed', actualSeconds, digest(receipt));
      };
      const failure = await settleExecutionFailure(episodeRoot, docker, gateway);
      if (failure !== null) {
        await recordFailure(failure);
        throw Error(`Meta episode ${episode.ordinal} failed: ${failure}; no automatic retry`);
      }
      store.startMetaEpisode(owner, episode.ordinal);
      try {
        const execution = await prepareExecution(
          episodeRoot,
          { identity, intent },
          docker,
          gateway,
          async (): Promise<ContainerSpec> => ({
            name: intent.name,
            image: spec.metaRuntime.runtime.image,
            command: ['node', '/app/dist/runtime/worker.js', '/launch.json'],
            isolation: spec.metaRuntime.isolation,
            network: await gateway.candidateNetwork(),
            timeoutSeconds: intent.seconds,
            env: Object.fromEntries(
              ['EVOLUTION_TOKEN', ...spec.metaRuntime.model.credentialEnv].map((key) => [
                key,
                'egress-client-placeholder',
              ]),
            ),
            mounts: [
              { source: bundle, target: '/method', writable: false },
              ...(environmentPath
                ? [{ source: environmentPath, target: '/environment', writable: false }]
                : []),
              ...(episode.ordinal
                ? [
                    {
                      source: path.join(home, String(episode.ordinal - 1), 'trace'),
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
          }),
          { ...process.env, EVOLUTION_TOKEN: token },
        );
        result = await collectExecution(episodeRoot, execution, episodeRoot, docker, gateway, signal);
        await atomicJSON(path.join(episodeRoot, 'container-result.json'), result);
        await collectUsage();
        const seconds = (Date.parse(result.FinishedAt) - Date.parse(result.StartedAt)) / 1000;
        if (!Number.isFinite(seconds) || seconds < 0) throw Error('Invalid meta container timestamps');
        const receipt = { intent, container: result, actualSeconds: seconds };
        await atomicJSON(path.join(episodeRoot, 'receipt.json'), receipt);
        store.finishMetaEpisode(
          owner,
          episode.ordinal,
          result.ExitCode === 0 ? 'complete' : 'failed',
          seconds,
          digest(receipt),
        );
        if (result.ExitCode !== 0) throw Error(`Meta episode exited ${result.ExitCode}; no automatic retry`);
      } catch (error) {
        // Losing this host observer must not terminate or replace a live native session.
        signal.throwIfAborted();
        if (error instanceof ReclamationError) throw error;
        await settleExecutionFailure(episodeRoot, docker, gateway, error);
        await recordFailure(error);
        throw error;
      }
    }
    stopPump = true;
    notify();
    await pumping;
    if (pumpFailure) throw pumpFailure;
    // The meta capability and native episode are fully settled before any sealed evaluation starts.
    await closeControlServer(server);
    server = undefined;
    signal.throwIfAborted();
    assertNotCancelled(root);
    coordinator.beginValidation();
    await coordinator.runValidation(options.childTransport, signal);
    return coordinator.reportSnapshot();
  } finally {
    stopPump = true;
    observation.abort(new Error('Study observer closed'));
    notify();
    try {
      if (pumping) await pumping;
      if (server) await closeControlServer(server);
    } finally {
      await coordinator.close();
    }
  }
}
