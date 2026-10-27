import { readdir, readFile, mkdir, cp, chmod } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { Digest, Id } from './contracts.js';
import { confined, inventory, treeDigest } from './artifacts.js';
import type { Store } from './store.js';

const Archive = z.object({
  format: z.literal('harness-evolution-research-archive'),
  archiveId: Digest,
  candidate: z.object({
    digest: Digest,
    phase: z.string(),
    mean: z.number().optional(),
    proposal: z.object({ hypothesis: z.string(), actions: z.array(z.string()) }),
  }),
  specification: z.object({ name: z.string(), objective: z.string() }),
});

export async function catalog(directory: string, query = ''): Promise<unknown[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const records = [];
  for (const entry of entries
    .filter((e) => e.isDirectory() && /^[a-f0-9]{64}$/.test(e.name))
    .sort((a, b) => a.name.localeCompare(b.name))) {
    const location = path.join(directory, entry.name);
    const record = Archive.parse(
      JSON.parse(await readFile(path.join(location, 'research-record.json'), 'utf8')),
    );
    if (record.archiveId !== entry.name) throw new Error('Library identity mismatch');
    if (JSON.stringify(record).toLowerCase().includes(query.toLowerCase()))
      records.push({ archive: location, ...record });
  }
  return records;
}

/** Explicitly import an immutable research asset, then edit a separate draft. Scores are never imported. */
export async function importArchive(
  root: string,
  store: Store,
  archive: string,
  draft: string,
): Promise<void> {
  Id.parse(draft);
  const record = Archive.parse(
    JSON.parse(await readFile(path.join(archive, 'research-record.json'), 'utf8')),
  );
  const source = path.join(archive, 'bundle');
  if ((await treeDigest(source)) !== record.candidate.digest)
    throw new Error('Imported bundle digest mismatch');
  const target = confined(path.join(root, 'drafts'), draft);
  await mkdir(path.dirname(target), { recursive: true });
  await cp(source, target, { recursive: true, force: false, errorOnExist: true });
  const writable = async (dir: string): Promise<void> => {
    await chmod(dir, 0o755);
    for (const entry of await readdir(dir, { withFileTypes: true }))
      if (entry.isDirectory()) await writable(path.join(dir, entry.name));
  };
  await writable(target);
  for (const file of await inventory(target))
    await chmod(confined(target, file.path), file.executable ? 0o755 : 0o644);
  store.event('draft.imported', {
    draft,
    sourceCandidate: record.candidate.digest,
    sourceArchive: record.archiveId,
    sourceExperiment: record.specification.name,
    sourcePhase: record.candidate.phase,
  });
}
