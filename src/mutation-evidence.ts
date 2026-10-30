import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { inventory, treeDigest } from './artifacts.js';
import type { Store } from './store.js';

/** Record source and assembly facts separately from the optimizer's action claims. */
export async function mutationEvidence(root: string, store: Store, id: string) {
  const candidate = store.candidate(id);
  const source = path.join(root, 'candidates', id);
  if ((await treeDigest(source)) !== id) throw Error('Mutation evidence candidate identity mismatch');
  const files = await inventory(source);
  const manifest = JSON.parse(await readFile(path.join(source, 'package.json'), 'utf8'));
  const parents = [];
  for (const parentId of candidate.proposal.parents) {
    const parent = path.join(root, 'candidates', parentId);
    if ((await treeDigest(parent)) !== parentId) throw Error('Mutation evidence parent identity mismatch');
    const original = new Map((await inventory(parent)).map((file) => [file.path, file]));
    const current = new Map(files.map((file) => [file.path, file]));
    const paths = [...new Set([...original.keys(), ...current.keys()])].sort();
    const changes = paths.flatMap((file) => {
      const before = original.get(file),
        after = current.get(file);
      if (before?.hash === after?.hash && before?.executable === after?.executable) return [];
      return [{ path: file, before: before ?? null, after: after ?? null }];
    });
    const previous = JSON.parse(await readFile(path.join(parent, 'package.json'), 'utf8'));
    parents.push({
      parent: parentId,
      changes,
      before: { dependencies: previous.dependencies ?? {}, bundle: previous.dsh.bundle },
      after: { dependencies: manifest.dependencies ?? {}, bundle: manifest.dsh.bundle },
    });
  }
  let native = null;
  try {
    native = JSON.parse(
      await readFile(path.join(root, 'qa', id, 'work/native/harness-inventory.json'), 'utf8'),
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  return {
    format: 'sparkvolve-mutation-evidence',
    candidate: id,
    declaredActions: candidate.proposal.actions,
    parents,
    native,
    evidence:
      'File/package/Bundle differences and observed native service/tool composition. Action labels remain optimizer claims; no heuristic action classification or quality inference.',
  };
}
