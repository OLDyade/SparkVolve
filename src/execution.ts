import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { atomicJSON, digest, fileDigest } from './artifacts.js';
import type { ContainerSpec, Docker, ContainerState, ContainerReference } from './docker.js';
import type { EgressLifecycle } from './egress-session.js';
import { containerIdentity } from './isolation.js';
import { z } from 'zod';
import { Digest } from './contracts.js';

export const ExecutionIntent = z
  .object({
    identity: Digest,
    phase: z.enum(['preparing', 'creating', 'created']),
  })
  .strict();
export const ExecutionRecord = z
  .object({
    preparation: Digest,
    specification: Digest,
    reference: z.object({ name: z.string().min(1), id: z.string().min(1), intent: Digest }).strict(),
  })
  .strict();

/** The host retains the specification digest; secret environment values never enter execution artifacts. */
function persistedSpec(spec: ContainerSpec): ContainerSpec {
  return {
    ...spec,
    env: Object.fromEntries(Object.keys(spec.env).map((key) => [key, '[private-environment]'])),
  };
}

const logFiles = ['isolation.json', 'isolation-final.json', 'stdout.log', 'stderr.log'] as const;
interface Completion {
  identity: string;
  reference: ContainerReference;
  result: ContainerState;
  logs: Record<string, string>;
}
export class ReclamationError extends Error {
  constructor(cause: unknown) {
    super('Resource reclamation must resume from persisted evidence without rerunning the task', {
      cause,
    });
  }
}
/** A failed task remains resumable only for cleanup, never for another execution. */
export async function settleExecutionFailure(
  root: string,
  docker: Docker,
  gateway: EgressLifecycle | null,
  error?: unknown,
): Promise<string | null> {
  const file = path.join(root, 'execution-failure.json');
  let failure: { error: string; phase: 'reclaiming' | 'reclaimed' };
  try {
    failure = JSON.parse(await readFile(file, 'utf8'));
  } catch (readError) {
    if ((readError as NodeJS.ErrnoException).code !== 'ENOENT') throw readError;
    if (error === undefined) return null;
    failure = { error: String(error), phase: 'reclaiming' };
    await atomicJSON(file, failure);
  }
  if (failure.phase === 'reclaimed') return failure.error;
  if (failure.phase !== 'reclaiming') throw Error('Unknown execution failure phase');
  try {
    let spec: ContainerSpec | undefined;
    try {
      spec = JSON.parse(await readFile(path.join(root, 'execution-spec.json'), 'utf8'));
    } catch (readError) {
      if ((readError as NodeJS.ErrnoException).code !== 'ENOENT') throw readError;
    }
    if (gateway) await gateway.abort(spec);
    else if (spec) await docker.halt(spec);
    await atomicJSON(file, { ...failure, phase: 'reclaimed' });
  } catch (cleanupError) {
    throw new ReclamationError(cleanupError);
  }
  return failure.error;
}
async function completion(root: string, spec: ContainerSpec): Promise<Completion | null> {
  try {
    const record = JSON.parse(
      await readFile(path.join(root, 'execution-completion.json'), 'utf8'),
    ) as Completion;
    if (
      record.identity !== containerIdentity(spec) ||
      record.reference.intent !== record.identity ||
      record.reference.name !== spec.name ||
      record.result.Running ||
      record.result.Status !== 'exited'
    )
      throw Error('Archived execution completion does not match its contract');
    return record;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}
/** Persist the terminal evidence before reclaiming any original container or network. */
export async function collectExecution(
  root: string,
  spec: ContainerSpec,
  logDir: string,
  docker: Docker,
  gateway: EgressLifecycle | null,
  signal?: AbortSignal,
): Promise<ContainerState> {
  if (!gateway) return docker.collect(spec, logDir, signal);
  let record = await completion(root, spec);
  if (!record) {
    const result = await docker.collect(spec, logDir, signal);
    await gateway.stop();
    const attestation = JSON.parse(await readFile(path.join(logDir, 'isolation-final.json'), 'utf8'));
    if (attestation.intent !== containerIdentity(spec) || typeof attestation.containerId !== 'string')
      throw Error('Terminal isolation attestation does not match the execution');
    const logs: Record<string, string> = {};
    for (const file of logFiles) logs[file] = await fileDigest(path.join(logDir, file));
    record = {
      identity: containerIdentity(spec),
      reference: { name: spec.name, id: attestation.containerId, intent: attestation.intent },
      result,
      logs,
    };
    await atomicJSON(path.join(root, 'execution-completion.json'), record);
  }
  if (Object.keys(record.logs).sort().join() !== [...logFiles].sort().join())
    throw Error('Archived execution log manifest is incomplete');
  for (const file of logFiles)
    if (record.logs[file] !== (await fileDigest(path.join(logDir, file))))
      throw Error('Archived execution log changed');
  try {
    await gateway.release(record.reference);
  } catch (error) {
    throw new ReclamationError(error);
  }
  return record.result;
}

/** Resume preparation, but never repeat an ambiguous container creation. */
export async function prepareExecution(
  root: string,
  identity: unknown,
  docker: Docker,
  gateway: EgressLifecycle | null,
  specification: () => Promise<ContainerSpec>,
  credentials: NodeJS.ProcessEnv,
): Promise<ContainerSpec> {
  const file = path.join(root, 'execution-intent.json'),
    hash = digest(identity);
  try {
    await readFile(path.join(root, 'cancellation-intent.json'));
    throw Error('Execution was explicitly cancelled; no task retry');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  let intent: z.infer<typeof ExecutionIntent>;
  try {
    intent = ExecutionIntent.parse(JSON.parse(await readFile(file, 'utf8')));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    for (const existing of [
      'execution-spec.json',
      'execution-record.json',
      'execution-completion.json',
      'isolation.json',
      'isolation-final.json',
      'stdout.log',
      'stderr.log',
    ]) {
      try {
        await readFile(path.join(root, existing));
        throw Error('Execution evidence exists without its original intent; no automatic task retry');
      } catch (existingError) {
        if ((existingError as NodeJS.ErrnoException).code !== 'ENOENT') throw existingError;
      }
    }
    intent = { identity: hash, phase: 'preparing' };
    await atomicJSON(file, intent);
  }
  if (intent.identity !== hash) throw Error('Execution preparation contract changed');
  if (intent.phase === 'preparing') await gateway?.prepare(credentials);
  const spec = await specification();
  if (intent.phase !== 'preparing') {
    const persisted = JSON.parse(await readFile(path.join(root, 'execution-spec.json'), 'utf8'));
    if (digest(persisted) !== digest(persistedSpec(spec)))
      throw Error('Persisted execution specification changed');
  }
  let record: z.infer<typeof ExecutionRecord> | undefined;
  try {
    record = ExecutionRecord.parse(
      JSON.parse(await readFile(path.join(root, 'execution-record.json'), 'utf8')),
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    if (intent.phase === 'created') throw Error('Original execution record missing');
  }
  if (
    record &&
    (record.preparation !== hash ||
      record.specification !== digest(spec) ||
      record.reference.name !== spec.name ||
      record.reference.intent !== containerIdentity(spec))
  )
    throw Error('Original execution record does not match its contract');
  if (gateway && (await completion(root, spec))) return spec;
  if (intent.phase === 'preparing') {
    // Persist the worker contract before creation, including when later recovery verification fails.
    await atomicJSON(path.join(root, 'execution-spec.json'), persistedSpec(spec));
    intent.phase = 'creating';
    await atomicJSON(file, intent);
    try {
      await docker.create(spec);
    } catch (error) {
      if (!(await docker.inspect(spec.name))) throw error;
    }
  }
  const state = await docker.inspect(spec.name);
  if (!state) throw Error('Original execution container missing after create intent; no automatic retry');
  const reference = await docker.executionReference(spec);
  if (record && digest(record.reference) !== digest(reference))
    throw Error('Original execution container identity changed');
  if (!record) {
    record = { preparation: hash, specification: digest(spec), reference };
    await atomicJSON(path.join(root, 'execution-record.json'), record);
  }
  await gateway?.verify(state.Running || state.Status === 'created');
  intent.phase = 'created';
  await atomicJSON(file, intent);
  return spec;
}
