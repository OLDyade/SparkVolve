import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { stringify } from 'yaml';
import { z } from 'zod';
import { PreparedOptimizer as PreparedSchema, RelativePath, type ExperimentSpec } from './contracts.js';
import { atomicJSON, confined, digest, fileDigest, freeze, treeDigest } from './artifacts.js';
import { readAuthorizedFile } from './file-reader.js';
import { buildBundle, verifyArtifact } from './build.js';
import { Docker, readJSON } from './docker.js';
import { prepareExecution, collectExecution, settleExecutionFailure } from './execution.js';
import { sdkPreset, evolutionPreset } from './preset.js';

export type PreparedOptimizer = z.infer<typeof PreparedSchema>;
export type OptimizerPreparationSpec = Pick<
  ExperimentSpec,
  'optimizerHarness' | 'runtime' | 'optimizer' | 'isolation' | 'timeoutSeconds'
>;

export function optimizerBundlePath(root: string, prepared: PreparedOptimizer): string {
  return path.join(root, 'optimizer-harness', 'artifacts', prepared.sourceDigest, 'bundle');
}

async function entrypoints(bundle: string, composition: string): Promise<void> {
  await readAuthorizedFile(bundle, composition);
  const manifest = JSON.parse((await readAuthorizedFile(bundle, 'package.json')).toString('utf8'));
  const patch = RelativePath.parse(manifest.dsh?.bundle?.patch?.replace(/^\.\//, ''));
  await readAuthorizedFile(bundle, patch);
}

/** Freeze, build and load G through the same native DSH runtime used by an optimizer episode. */
export async function prepareOptimizer(
  root: string,
  dataset: string,
  spec: OptimizerPreparationSpec,
  docker = new Docker(),
  signal?: AbortSignal,
): Promise<PreparedOptimizer> {
  signal?.throwIfAborted();
  const method = spec.optimizerHarness;
  const source = confined(dataset, method.source.directory);
  if ((await treeDigest(source)) !== method.source.digest) throw Error('Optimizer source digest mismatch');
  const environment = spec.runtime.environment;
  const environmentPath = environment ? confined(dataset, environment.directory) : null;
  if (environment && environmentPath && (await treeDigest(environmentPath)) !== environment.digest)
    throw Error('Optimizer runtime environment digest mismatch');
  const home = path.join(root, 'optimizer-harness');
  await mkdir(home, { recursive: true });
  const intent = {
    method,
    runtime: spec.runtime,
    model: spec.optimizer,
    isolation: spec.isolation,
    timeoutSeconds: spec.timeoutSeconds,
  };
  const intentFile = path.join(home, 'intent.json');
  try {
    await writeFile(intentFile, `${JSON.stringify(intent)}\n`, { flag: 'wx', mode: 0o600 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    if (digest(await readJSON(intentFile)) !== digest(intent))
      throw Error('Optimizer preparation contract changed');
  }
  const preparedFile = path.join(home, 'prepared.json');
  let prepared: PreparedOptimizer | undefined;
  try {
    prepared = PreparedSchema.parse(await readJSON(preparedFile));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const wasPrepared = prepared !== undefined;
  const frozenSource = path.join(home, 'candidates', method.source.digest);
  if (!prepared) {
    if ((await freeze(source, frozenSource, path.join(home, 'publications'))) !== method.source.digest)
      throw Error('Optimizer source changed during publication');
    let build;
    if (method.kind === 'source') {
      build = await buildBundle(
        home,
        path.resolve(root),
        method.source.digest,
        method.build,
        spec.isolation,
        docker,
        signal,
      );
    } else {
      const artifact = confined(dataset, method.artifact.directory);
      await verifyArtifact(artifact, method.source.digest, method.artifact.identity);
      if (
        (await fileDigest(path.join(frozenSource, 'package-lock.json'))) !==
        method.artifact.identity.lockDigest
      )
        throw Error('Optimizer artifact lock does not match source');
      await freeze(
        artifact,
        path.join(home, 'artifacts', method.source.digest),
        path.join(home, 'publications'),
      );
      build = method.artifact.identity;
    }
    prepared = PreparedSchema.parse({
      sourceDigest: method.source.digest,
      build,
      composition: method.composition,
    });
  }
  if (prepared.sourceDigest !== method.source.digest || prepared.composition !== method.composition)
    throw Error('Prepared optimizer does not match requested source and composition');
  if (method.kind === 'artifact' && digest(prepared.build) !== digest(method.artifact.identity))
    throw Error('Prepared optimizer artifact does not match requested build');
  if (method.kind === 'source' && prepared.build.image !== method.build.image)
    throw Error('Prepared optimizer build image changed');
  if (
    (await treeDigest(frozenSource)) !== prepared.sourceDigest ||
    (await fileDigest(path.join(frozenSource, 'package-lock.json'))) !== prepared.build.lockDigest
  )
    throw Error('Frozen optimizer source or lock mismatch');
  await verifyArtifact(
    path.join(home, 'artifacts', prepared.sourceDigest),
    prepared.sourceDigest,
    prepared.build,
  );
  const bundle = optimizerBundlePath(root, prepared);
  await entrypoints(bundle, prepared.composition);
  const qa = path.join(home, 'qa');
  const identity = digest({
    prepared,
    runtime: spec.runtime,
    model: spec.optimizer,
    isolation: spec.isolation,
    timeoutSeconds: spec.timeoutSeconds,
  });
  let accepted = false;
  try {
    const receipt = (await readJSON(path.join(qa, 'accepted.json'))) as {
      identity: string;
      exitCode: number;
    };
    if (receipt.identity !== identity || receipt.exitCode !== 0)
      throw Error('Optimizer native QA receipt mismatch');
    accepted = true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  if (!accepted) {
    if (wasPrepared) throw Error('Prepared optimizer is missing its original native QA acceptance');
    // These files are host-owned inputs. The container gets only its scratch directory writable.
    await mkdir(path.join(qa, 'work'), { recursive: true });
    await writeFile(
      path.join(qa, 'cordis.patch.yml'),
      stringify([
        {
          insert: [
            ...sdkPreset('evolution', '/app/dist/sdk-preset.js', 'sdk'),
            evolutionPreset({
              plugin: '/app/dist/plugin.js',
              endpoint: 'http://evolution-egress:8080',
              tokenEnv: 'EVOLUTION_TOKEN',
              composition: `/method/${prepared.composition}`,
            }),
          ],
        },
      ]),
    );
    await atomicJSON(path.join(qa, 'launch.json'), {
      profile: 'sdk',
      model: spec.optimizer,
      patches: [...(environment ? [`/environment/${environment.patch}`] : []), '/optimizer.patch.yml'],
      command: null,
      behaviorModule: null,
      timeoutSeconds: spec.timeoutSeconds,
    });
    const failure = await settleExecutionFailure(qa, docker, null);
    if (failure !== null) throw Error(`Optimizer native QA failed; ${failure}; no automatic retry`);
    try {
      signal?.throwIfAborted();
      const execution = await prepareExecution(
        qa,
        identity,
        docker,
        null,
        async () => ({
          name: `he-gqa-${digest([path.resolve(root), identity]).slice(0, 32)}`,
          image: spec.runtime.image,
          command: ['node', '/app/dist/runtime/qa.js', '/launch.json'],
          isolation: spec.isolation,
          network: 'none',
          timeoutSeconds: spec.timeoutSeconds,
          env: Object.fromEntries(
            ['EVOLUTION_TOKEN', ...spec.optimizer.credentialEnv].map((key) => [
              key,
              'native-load-only-placeholder',
            ]),
          ),
          mounts: [
            { source: bundle, target: '/method', writable: false },
            { source: path.join(qa, 'work'), target: '/workspace', writable: true },
            { source: path.join(qa, 'launch.json'), target: '/launch.json', writable: false },
            { source: path.join(qa, 'cordis.patch.yml'), target: '/optimizer.patch.yml', writable: false },
            ...(environmentPath
              ? [{ source: environmentPath, target: '/environment', writable: false }]
              : []),
          ],
        }),
        {},
      );
      const result = await collectExecution(qa, execution, path.join(qa, 'logs'), docker, null, signal);
      await atomicJSON(path.join(qa, 'result.json'), result);
      if (result.ExitCode !== 0) throw Error(`Optimizer native QA container exited ${result.ExitCode}`);
      await atomicJSON(path.join(qa, 'accepted.json'), { identity, exitCode: result.ExitCode });
    } catch (error) {
      signal?.throwIfAborted();
      await settleExecutionFailure(qa, docker, null, error);
      throw error;
    }
  }
  await atomicJSON(preparedFile, prepared);
  return prepared;
}
