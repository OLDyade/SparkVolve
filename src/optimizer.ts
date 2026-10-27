import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { stringify } from 'yaml';
import { z } from 'zod';
import { atomicJSON, digest, confined } from './artifacts.js';
import { Docker } from './docker.js';
import type { ExperimentSpec } from './contracts.js';
import { collectRequestMetrics } from './metrics.js';

/** Launch the optimizer in DSH; search decisions live in its plugins and model, never in a canned mutation script. */
export async function optimize(
  root: string,
  spec: ExperimentSpec,
  endpoint: string,
  docker = new Docker(),
): Promise<void> {
  if (spec.purpose !== 'search') throw new Error('Validation experiments cannot launch an optimizer');
  const runRoot = path.join(root, 'optimizer');
  await mkdir(path.join(runRoot, 'trace'), { recursive: true });
  const identity = digest({ root: path.resolve(root), spec, endpoint });
  const name = `he-optimizer-${identity.slice(0, 40)}`;
  const intentPath = path.join(runRoot, 'intent.json');
  let resumed = false;
  try {
    const intent = z
      .strictObject({ identity: z.string(), name: z.string() })
      .parse(JSON.parse(await readFile(intentPath, 'utf8')));
    if (intent.identity !== identity || intent.name !== name)
      throw new Error('Optimizer launch contract changed');
    resumed = true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const token = await readFile(path.join(root, 'controller-token'), 'utf8');
  const env: Record<string, string> = resumed ? {} : { EVOLUTION_TOKEN: token };
  for (const key of resumed ? [] : spec.optimizer.credentialEnv) {
    const value = process.env[key];
    if (!value) throw new Error(`Missing optimizer credential ${key}`);
    env[key] = value;
  }
  if (!resumed)
    await writeFile(
      path.join(runRoot, 'cordis.patch.yml'),
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
  const prompt = [
    'Evolve the Harness, Not the Model.',
    `Researcher objective: ${spec.objective}`,
    'You are the optimizer of a plugin-based harness evolution experiment. Read evolution_status first.',
    'Choose mechanisms and parent candidates from original task evidence, native traces, actual deliveries and independent scores.',
    'Use evolution_branch to create an editable bundle under /workspace. Inspect its code and the installed DSH implementation.',
    'You may enable, disable, tune, replace, compose and author plugin implementations, configurations and composition structures; coordinate cross-plugin changes when justified.',
    'Research uncertain APIs. Use ordinary DSH tools to implement, build and test your draft. Submit only genuine changed candidates with evidence and a falsifiable mechanism hypothesis.',
    'The controller evaluates the complete fixed manifest. It owns the model contract, isolation, grader, budget and champion. Do not modify or circumvent these boundaries.',
    'Distinguish runtime failures from wrong business outcomes. A single improvement does not establish causality or transfer.',
    'Wait for pending experiments using normal tools; inspect new results and continue evidence-driven search until the contracted budget is exhausted or you can justify stopping.',
    'The runtime exposes elapsed wall-clock budget. Plan implementation and tests within it. Submitted experiments continue under the controller after your session ends; do not spend the entire budget without submitting a tested candidate.',
    'Never embed task answers, access evaluator-private data, change model weights, silently substitute dependencies, or run identical candidates to resample scores.',
  ].join('\n');
  const environment = spec.runtime.environment;
  if (!resumed)
    await atomicJSON(path.join(runRoot, 'launch.json'), {
      profile: 'sdk',
      model: spec.optimizer,
      patch: '/optimizer.patch.yml',
      environmentPatch: environment ? `/environment/${environment.patch}` : null,
      prompt,
      timeoutSeconds: spec.budget.optimizerSeconds,
    });
  const launch = {
    name,
    image: spec.runtime.image,
    command: ['node', '/app/dist/runtime/worker.js', '/launch.json'],
    network: 'bridge',
    env,
    timeoutSeconds: spec.budget.optimizerSeconds,
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
      { source: path.join(root, 'drafts'), target: '/workspace', writable: true },
      { source: path.join(runRoot, 'trace'), target: '/trace', writable: true },
      { source: path.join(runRoot, 'launch.json'), target: '/launch.json', writable: false },
      { source: path.join(runRoot, 'cordis.patch.yml'), target: '/optimizer.patch.yml', writable: false },
    ],
  } satisfies import('./docker.js').ContainerSpec;
  if (!resumed) {
    await writeFile(intentPath, JSON.stringify({ identity, name }), { flag: 'wx', mode: 0o600 });
    await docker.create(launch);
  }
  // Recovery attaches to the recorded container. An absent container is an exposed infrastructure failure.
  const result = await docker.collect(launch, runRoot);
  await atomicJSON(path.join(runRoot, 'container-result.json'), result);
  await collectRequestMetrics(path.join(runRoot, 'trace'));
  if (result.ExitCode !== 0)
    throw new Error(`Optimizer failed with container exit ${result.ExitCode}; artifacts retained`);
}
