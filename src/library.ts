import { readdir, readFile, mkdir, chmod, lstat, mkdtemp, rename } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { Digest, Id, BuildIdentity, RelativePath } from './contracts.js';
import { confined, inventory, treeDigest, digest, freeze } from './artifacts.js';
import type { Store } from './store.js';
import { verifyArtifact } from './build.js';
import { readAuthorizedFile } from './file-reader.js';

const Archive = z.looseObject({
  format: z.literal('sparkvolve-research-archive'),
  archiveId: Digest,
  experimentId: z.uuid(),
  candidate: z.looseObject({
    digest: Digest,
    phase: z.enum(['build_failed', 'qa_failed', 'rejected', 'champion']),
    mean: z.number().finite().optional(),
    build: BuildIdentity.optional(),
    proposal: z.looseObject({ hypothesis: z.string(), actions: z.array(z.string()) }),
  }),
  specification: z.looseObject({ name: z.string(), objective: z.string() }),
});

export async function readArchive(directory: string) {
  const raw: unknown = JSON.parse(await readFile(path.join(directory, 'research-record.json'), 'utf8'));
  const record = Archive.parse(raw);
  const expected = digest({
    experiment: record.experimentId,
    specification: digest(record.specification),
    candidate: record.candidate.digest,
  });
  if (record.archiveId !== expected) throw new Error('Research archive identity mismatch');
  if ((await treeDigest(path.join(directory, 'source'))) !== record.candidate.digest)
    throw new Error('Imported source digest mismatch');
  if (record.candidate.build)
    await verifyArtifact(path.join(directory, 'artifact'), record.candidate.digest, record.candidate.build);
  return { record, recordDigest: digest(raw) };
}

/** Literal retrieval over an explicitly authorized snapshot; no score-based selection or hidden ranking. */
export async function catalog(directory: string, query = '') {
  const entries = await readdir(directory, { withFileTypes: true });
  const records = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory() || !/^[a-f0-9]{64}$/.test(entry.name))
      throw new Error(`Library entries must be archive identity directories: ${entry.name}`);
    const { record, recordDigest } = await readArchive(path.join(directory, entry.name));
    if (record.archiveId !== entry.name) throw new Error('Library identity mismatch');
    const result = {
      archiveId: record.archiveId,
      recordDigest,
      experimentId: record.experimentId,
      experiment: record.specification.name,
      objective: record.specification.objective,
      sourceCandidate: record.candidate.digest,
      phase: record.candidate.phase,
      historicalMean: record.candidate.mean ?? null,
      hypothesis: record.candidate.proposal.hypothesis,
      actions: record.candidate.proposal.actions,
    };
    if (JSON.stringify(result).toLowerCase().includes(query.toLowerCase())) records.push(result);
  }
  return records;
}

export async function inspectAsset(directory: string, archiveId: string, file?: string) {
  Digest.parse(archiveId);
  const archive = confined(directory, archiveId);
  const verified = await readArchive(archive);
  if (verified.record.archiveId !== archiveId) throw new Error('Library identity mismatch');
  const source = path.join(archive, 'source');
  const files = await inventory(source);
  if (file === undefined) return { ...verified, sourceFiles: files };
  RelativePath.parse(file);
  const entry = files.find((item) => item.path === file);
  if (!entry) throw new Error('Unknown source artifact');
  return {
    archiveId,
    recordDigest: verified.recordDigest,
    ...entry,
    encoding: 'base64',
    data: (await readAuthorizedFile(source, file)).toString('base64'),
  };
}

type Origin = { archiveId: string; recordDigest: string; sourceCandidate: string };
type ImportIntent = { state: 'pending' | 'ready'; origin: Origin };
const importing = new WeakMap<Store, Map<string, { identity: string; operation: Promise<void> }>>();

export function draftOrigin(store: Store, draft: string): Origin | undefined {
  const raw = store.getMeta(`draft-import:${draft}`);
  if (!raw) return undefined;
  const intent = JSON.parse(raw) as ImportIntent;
  if (intent.state !== 'ready')
    throw new Error('Research asset import is pending; resume the same import first');
  return intent.origin;
}

/** One durable import intent; transport retries never reset an already edited draft. */
export async function importArchive(
  root: string,
  store: Store,
  archive: string,
  draft: string,
): Promise<void> {
  Id.parse(draft);
  const { record, recordDigest } = await readArchive(archive);
  const origin = { archiveId: record.archiveId, recordDigest, sourceCandidate: record.candidate.digest };
  let active = importing.get(store);
  if (!active) {
    active = new Map();
    importing.set(store, active);
  }
  const previous = active.get(draft);
  if (previous) {
    if (previous.identity !== recordDigest) throw new Error('Draft import identity changed');
    return await previous.operation;
  }
  const operation = copyImport(root, store, archive, draft, origin, record).finally(() =>
    active.delete(draft),
  );
  active.set(draft, { identity: recordDigest, operation });
  return await operation;
}

async function copyImport(
  root: string,
  store: Store,
  archive: string,
  draft: string,
  origin: Origin,
  record: z.infer<typeof Archive>,
): Promise<void> {
  const source = path.join(archive, 'source');
  const target = confined(path.join(root, 'drafts'), draft);
  const key = `draft-import:${draft}`;
  const saved = store.getMeta(key);
  if (saved) {
    const intent = JSON.parse(saved) as ImportIntent;
    if (digest(intent.origin) !== digest(origin)) throw new Error('Draft import identity changed');
    if (intent.state === 'ready') {
      if (!(await lstat(target)).isDirectory()) throw new Error('Imported draft is missing');
      return;
    }
  } else {
    try {
      await lstat(target);
      throw new Error('Draft already exists');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    store.transaction(() => {
      store.setMeta(key, JSON.stringify({ state: 'pending', origin } satisfies ImportIntent));
      store.event('draft.import_started', { draft, ...origin });
    });
  }
  await mkdir(path.dirname(target), { recursive: true });
  let published = false;
  try {
    await lstat(target);
    published = true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  if (!published) {
    const directory = path.join(root, 'imports', draft);
    await mkdir(directory, { recursive: true });
    // Private staging is never mounted into the optimizer; interrupted copies remain inspectable.
    const staging = await mkdtemp(path.join(directory, 'copy-'));
    await freeze(source, path.join(staging, 'source'), path.join(root, 'publications'));
    await chmod(path.join(staging, 'source'), 0o755);
    await rename(path.join(staging, 'source'), target);
  }
  if ((await treeDigest(target)) !== origin.sourceCandidate)
    throw new Error('Pending imported draft differs from its recorded source');
  const writable = async (dir: string): Promise<void> => {
    await chmod(dir, 0o755);
    for (const entry of await readdir(dir, { withFileTypes: true }))
      if (entry.isDirectory()) await writable(path.join(dir, entry.name));
  };
  await writable(target);
  for (const file of await inventory(target))
    await chmod(confined(target, file.path), file.executable ? 0o755 : 0o644);
  store.transaction(() => {
    store.setMeta(key, JSON.stringify({ state: 'ready', origin } satisfies ImportIntent));
    store.event('draft.imported', {
      draft,
      ...origin,
      sourceExperiment: record.specification.name,
      sourcePhase: record.candidate.phase,
    });
  });
}
