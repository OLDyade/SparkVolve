import { mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import type { Candidate, ExperimentSpec, IsolationSpec } from './contracts.js';
import { atomicJSON, digest, fileDigest, freeze, treeDigest } from './artifacts.js';
import { Docker, readJSON } from './docker.js';
import { z } from 'zod';
import { Digest, BuildContract } from './contracts.js';
import { prepareExecution, collectExecution, settleExecutionFailure } from './execution.js';

const Receipt = z.object({
  sourceDigest: Digest,
  lockDigest: Digest,
  bundleDigest: Digest,
  tarballDigest: Digest,
});

export function bundlePath(root: string, candidate: Candidate): string {
  if (!candidate.build) throw new Error('Candidate has no built artifact');
  return path.join(root, 'artifacts', candidate.digest, 'bundle');
}

export async function verifyBuild(root: string, candidate: Candidate): Promise<void> {
  if (!candidate.build) throw new Error('Candidate has no built artifact');
  await verifyArtifact(path.join(root, 'artifacts', candidate.digest), candidate.digest, candidate.build);
  if (
    (await fileDigest(path.join(root, 'candidates', candidate.digest, 'package-lock.json'))) !==
    candidate.build.lockDigest
  )
    throw new Error('Frozen source lock does not match build');
}

export async function verifyArtifact(
  directory: string,
  sourceDigest: string,
  build: NonNullable<Candidate['build']>,
): Promise<void> {
  const receipt = Receipt.parse(await readJSON(path.join(directory, 'receipt.json')));
  if (
    (await treeDigest(directory)) !== build.artifactDigest ||
    receipt.sourceDigest !== sourceDigest ||
    receipt.lockDigest !== build.lockDigest ||
    receipt.bundleDigest !== build.bundleDigest ||
    receipt.tarballDigest !== build.tarballDigest ||
    (await treeDigest(path.join(directory, 'bundle'))) !== build.bundleDigest ||
    (await fileDigest(path.join(directory, 'bundle.tgz'))) !== build.tarballDigest
  )
    throw new Error('Frozen build artifact integrity mismatch');
}

/** Collect the original build container after interruption; never rebuild the same candidate. */
export async function buildCandidate(
  root: string,
  experiment: string,
  spec: ExperimentSpec,
  candidate: Candidate,
  docker: Docker,
  signal?: AbortSignal,
): Promise<NonNullable<Candidate['build']>> {
  return buildBundle(
    root,
    experiment,
    candidate.digest,
    spec.candidate.build,
    spec.isolation,
    docker,
    signal,
  );
}

/** H and G use the same locked source build, original execution intent, and immutable publication. */
export async function buildBundle(
  root: string,
  experiment: string,
  sourceDigest: string,
  contract: z.infer<typeof BuildContract>,
  isolation: IsolationSpec,
  docker: Docker,
  signal?: AbortSignal,
): Promise<NonNullable<Candidate['build']>> {
  signal?.throwIfAborted();
  const source = path.join(root, 'candidates', sourceDigest);
  if ((await treeDigest(source)) !== sourceDigest) throw new Error('Frozen source integrity mismatch');
  const build = path.join(root, 'builds', sourceDigest);
  await mkdir(path.join(build, 'work'), { recursive: true });
  const failure = await settleExecutionFailure(build, docker, null);
  if (failure !== null) throw Error(`Build failed; ${failure}; no automatic retry`);
  let result;
  try {
    const execution = await prepareExecution(
      build,
      { experiment, sourceDigest, contract, isolation },
      docker,
      null,
      async () => ({
        name: `he-build-${digest([experiment, sourceDigest]).slice(0, 32)}`,
        image: contract.image,
        command: ['node', '/app/dist/runtime/build.js'],
        mounts: [
          { source, target: '/source', writable: false },
          { source: path.join(build, 'work'), target: '/workspace', writable: true },
        ],
        env: {
          npm_config_cache: '/tmp/npm-cache',
          BUILD_TIMEOUT_SECONDS: String(contract.timeoutSeconds),
        },
        isolation,
        network: isolation.network.build,
        timeoutSeconds: contract.timeoutSeconds,
      }),
      {},
    );
    result = await collectExecution(build, execution, path.join(build, 'logs'), docker, null, signal);
  } catch (error) {
    signal?.throwIfAborted();
    await settleExecutionFailure(build, docker, null, error);
    throw error;
  }
  if (result.ExitCode !== 0) throw new Error(`Build container exited ${result.ExitCode}`);
  const output = path.join(build, 'work', 'output');
  const receipt = Receipt.parse(await readJSON(path.join(output, 'receipt.json')));
  if (
    receipt.sourceDigest !== sourceDigest ||
    receipt.lockDigest !== (await fileDigest(path.join(source, 'package-lock.json'))) ||
    receipt.bundleDigest !== (await treeDigest(path.join(output, 'bundle'))) ||
    receipt.tarballDigest !== (await fileDigest(path.join(output, 'bundle.tgz')))
  )
    throw new Error('Build receipt does not match actual inputs and outputs');
  const artifactDigest = await treeDigest(output);
  const destination = path.join(root, 'artifacts', sourceDigest);
  try {
    await stat(destination);
    if ((await treeDigest(destination)) !== artifactDigest)
      throw new Error('Interrupted build snapshot mismatch');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    await freeze(output, destination, path.join(root, 'publications'));
  }
  const identity = {
    artifactDigest,
    bundleDigest: receipt.bundleDigest,
    tarballDigest: receipt.tarballDigest,
    lockDigest: receipt.lockDigest,
    image: contract.image,
  };
  await atomicJSON(path.join(build, 'logs', 'identity.json'), identity);
  return identity;
}
