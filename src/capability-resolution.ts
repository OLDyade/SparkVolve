import path from 'node:path';
import { mkdir, lstat, cp, chmod, rename, readdir } from 'node:fs/promises';
import { z } from 'zod';
import { Digest, Id, type ExperimentSpec } from './contracts.js';
import { atomicJSON, digest, confined, freeze, treeDigest, inventory } from './artifacts.js';
import { readCapabilities, type CapabilityRecord } from './capabilities.js';
import { Docker, readJSON } from './docker.js';
import type { Store } from './store.js';
import { collectExecution, prepareExecution, settleExecutionFailure } from './execution.js';

export const ResolveRequest = z.strictObject({
  parent: Digest,
  draft: Id,
  capabilities: z.array(Digest).min(1),
  rationale: z.string().min(1),
});
type Request = z.infer<typeof ResolveRequest>;
export interface Resolution {
  id: string;
  request: Request;
  phase: 'queued' | 'resolved' | 'failed';
  catalogDigest: string;
  entries: CapabilityRecord[];
  error?: string;
  draftDigest?: string;
}
export function resolutions(store: Store): Resolution[] {
  return store
    .events()
    .filter((event) => event.type === 'capability.resolution_requested')
    .map(
      (event) => JSON.parse(store.getMeta('resolution:' + (event.body as { id: string }).id)!) as Resolution,
    );
}
export async function catalogRoot(dataset: string, spec: ExperimentSpec) {
  if (!spec.capabilities) throw Error('No capability catalog authorized by the experiment contract');
  const directory = confined(dataset, spec.capabilities.directory);
  const snapshot = await readCapabilities(directory, spec.capabilities.digest);
  if (snapshot.dshVersion !== spec.runtime.dshVersion)
    throw Error('Catalog and experiment DSH versions differ');
  if (
    spec.hostSearchProtocol.ancestry === 'seed-only' &&
    snapshot.entries.some((entry) => entry.origin === 'research')
  )
    throw Error('Seed-only protocol forbids capability catalogs containing research archives');
  return { directory, snapshot };
}

async function editableDirectories(directory: string): Promise<void> {
  await chmod(directory, 0o755);
  for (const entry of await readdir(directory, { withFileTypes: true }))
    if (entry.isDirectory()) await editableDirectories(path.join(directory, entry.name));
}
export async function queueResolution(
  root: string,
  dataset: string,
  spec: ExperimentSpec,
  store: Store,
  raw: unknown,
) {
  if (spec.purpose !== 'search' || store.getMeta('searchConclusion'))
    throw Error('Capability resolution requires an open search');
  const request = ResolveRequest.parse(raw);
  const parent = store.candidate(request.parent);
  if (spec.hostSearchProtocol.ancestry === 'seed-only' && parent.ordinal !== 0)
    throw Error('Seed-only ancestry violation');
  const { snapshot } = await catalogRoot(dataset, spec);
  if (new Set(request.capabilities).size !== request.capabilities.length)
    throw Error('Duplicate selected capability');
  const entries = request.capabilities.map((id) => {
    const entry = snapshot.entries.find((item) => item.id === id);
    if (!entry) throw Error('Unknown frozen capability: ' + id);
    if (entry.compatibility) throw Error('Incompatible capability: ' + entry.name);
    return entry;
  });
  if (new Set(entries.map((entry) => entry.name)).size !== entries.length)
    throw Error('Multiple versions of one package selected');
  const identity = digest({
    parent: request.parent,
    capabilities: request.capabilities,
    catalog: spec.capabilities!.digest,
  });
  const existing = resolutions(store).find((item) => item.id === identity);
  if (existing) {
    if (digest(existing.request) !== digest(request))
      throw Error('Resolution already requested with another draft or rationale');
    return existing;
  }
  try {
    await lstat(confined(path.join(root, 'drafts'), request.draft));
    throw Error('Draft already exists');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const record: Resolution = {
    id: identity,
    request,
    entries,
    phase: 'queued',
    catalogDigest: spec.capabilities!.digest,
  };
  return store.transaction(() => {
    if (store.getMeta('searchConclusion')) throw Error('Capability resolution requires an open search');
    const current = resolutions(store);
    const concurrent = current.find((item) => item.id === identity);
    if (concurrent) {
      if (digest(concurrent.request) !== digest(request))
        throw Error('Resolution already requested with another draft or rationale');
      return concurrent;
    }
    if (current.length >= spec.capabilities!.resolutionLimit)
      throw Error('Capability resolution budget exhausted');
    if (current.some((item) => item.request.draft === request.draft))
      throw Error('Resolution draft name already reserved');
    store.setMeta('resolution:' + identity, JSON.stringify(record));
    store.event('capability.resolution_requested', record);
    return record;
  });
}
export async function executeResolution(
  root: string,
  dataset: string,
  spec: ExperimentSpec,
  store: Store,
  record: Resolution,
  docker: Docker,
  signal?: AbortSignal,
) {
  const directory = path.join(root, 'resolutions', record.id);
  const work = path.join(directory, 'work');
  await mkdir(work, { recursive: true });
  const { directory: catalog } = await catalogRoot(dataset, spec);
  const parent = path.join(root, 'candidates', record.request.parent);
  try {
    if ((await treeDigest(parent)) !== record.request.parent) throw Error('Resolution parent changed');
    const launch = path.join(directory, 'request.json');
    await atomicJSON(launch, {
      ...record,
      parent: record.request.parent,
      timeoutSeconds: spec.candidate.build.timeoutSeconds,
    });
    const failure = await settleExecutionFailure(directory, docker, null);
    if (failure !== null) throw Error('Resolution failed; ' + failure + '; no automatic retry');
    const execution = await prepareExecution(
      directory,
      record,
      docker,
      null,
      async () => ({
        name: 'he-resolve-' + digest([store.getMeta('experimentId'), record.id]).slice(0, 32),
        image: spec.candidate.build.image,
        command: ['node', '/app/dist/runtime/resolve-capabilities.js'],
        mounts: [
          { source: parent, target: '/parent', writable: false },
          { source: catalog, target: '/catalog', writable: false },
          { source: launch, target: '/request.json', writable: false },
          { source: work, target: '/workspace', writable: true },
        ],
        env: { npm_config_cache: '/tmp/npm-cache' },
        isolation: spec.isolation,
        network: spec.isolation.network.build,
        timeoutSeconds: spec.candidate.build.timeoutSeconds,
      }),
      {},
    );
    const result = await collectExecution(
      directory,
      execution,
      path.join(directory, 'logs'),
      docker,
      null,
      signal,
    );
    if (result.ExitCode !== 0) throw Error('Capability resolver exited ' + result.ExitCode);
    const output = path.join(work, 'draft');
    const receipt = z.object({ draftDigest: Digest }).parse(await readJSON(path.join(work, 'result.json')));
    if ((await treeDigest(output)) !== receipt.draftDigest)
      throw Error('Resolution output identity mismatch');
    const frozen = path.join(directory, 'source');
    await freeze(output, frozen, path.join(root, 'publications'));
    const target = confined(path.join(root, 'drafts'), record.request.draft);
    try {
      await lstat(target);
      if ((await treeDigest(target)) !== receipt.draftDigest)
        throw Error('Interrupted resolution draft changed before publication');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      const staging = path.join(directory, 'editable');
      await cp(frozen, staging, { recursive: true, force: true });
      await editableDirectories(staging);
      for (const file of await inventory(staging))
        await chmod(confined(staging, file.path), file.executable ? 0o755 : 0o644);
      await rename(staging, target);
    }
    await editableDirectories(target);
    for (const file of await inventory(target))
      await chmod(confined(target, file.path), file.executable ? 0o755 : 0o644);
    record = { ...record, phase: 'resolved', draftDigest: receipt.draftDigest };
  } catch (error) {
    signal?.throwIfAborted();
    await settleExecutionFailure(directory, docker, null, error);
    record = { ...record, phase: 'failed', error: String(error) };
  }
  store.transaction(() => {
    store.setMeta('resolution:' + record.id, JSON.stringify(record));
    store.event('capability.resolution_completed', record);
  });
  return record;
}
