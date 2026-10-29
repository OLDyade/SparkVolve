import { digest, inventory } from './artifacts.js';

/** Compare content and executable mode, including additions/deletions, against frozen H0. */
export async function assertMutationScope(
  seed: string,
  source: string,
  expectedDigest: string,
  files: readonly string[],
): Promise<void> {
  const [before, after] = await Promise.all([inventory(seed), inventory(source)]);
  if (digest(after) !== expectedDigest) throw new Error('Candidate changed during mutation scope inspection');
  const old = new Map(before.map((entry) => [entry.path, digest(entry)]));
  const next = new Map(after.map((entry) => [entry.path, digest(entry)]));
  const allowed = new Set(files);
  const forbidden = [...new Set([...old.keys(), ...next.keys()])].filter(
    (file) => old.get(file) !== next.get(file) && !allowed.has(file),
  );
  if (forbidden.length) throw new Error(`Mutation scope violation: ${forbidden.join(', ')}`);
}
