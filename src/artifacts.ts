import { createHash, randomUUID } from 'node:crypto';
import { readdir, lstat, readFile, mkdir, writeFile, rename, rm, chmod, realpath } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { channel } from 'node:diagnostics_channel';
import path from 'node:path';

const publications = channel('harness-evolution:publication');

export function canonical(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index++)
      if (!Object.hasOwn(value, index)) throw new Error('Artifact identity rejects sparse JSON arrays');
    return `[${value.map(canonical).join(',')}]`;
  }
  if (typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(',')}}`;
  }
  throw new Error('Artifact identity accepts only finite JSON values');
}
export function digest(value: unknown): string {
  return createHash('sha256').update(canonical(value)).digest('hex');
}
export function confined(root: string, relative: string): string {
  if (
    !relative ||
    path.isAbsolute(relative) ||
    relative.includes('\\') ||
    relative.split('/').some((p) => !p || p === '.' || p === '..')
  )
    throw new Error(`Invalid relative path: ${relative}`);
  return path.join(root, relative);
}
export async function inventory(
  root: string,
): Promise<Array<{ path: string; hash: string; executable: boolean }>> {
  const result: Array<{ path: string; hash: string; executable: boolean }> = [];
  async function visit(relative: string): Promise<void> {
    const absolute = path.join(root, relative);
    const stat = await lstat(absolute);
    if (stat.isSymbolicLink()) throw new Error(`Symlinks are not candidate artifacts: ${relative}`);
    if (stat.isDirectory()) {
      for (const entry of (await readdir(absolute)).sort())
        await visit(relative ? `${relative}/${entry}` : entry);
    } else if (stat.isFile()) {
      result.push({
        path: relative,
        hash: createHash('sha256')
          .update(await readFile(absolute))
          .digest('hex'),
        executable: (stat.mode & 0o111) !== 0,
      });
    } else throw new Error(`Unsupported artifact: ${relative}`);
  }
  await visit('');
  return result;
}
export async function treeDigest(root: string): Promise<string> {
  return digest(await inventory(root));
}
export async function fileDigest(file: string): Promise<string> {
  return createHash('sha256')
    .update(await readFile(file))
    .digest('hex');
}
/** Publication state belongs to the trusted experiment, never inside a snapshot or candidate mount. */
export async function freeze(source: string, destination: string, publicationRoot: string): Promise<string> {
  const before = await inventory(source);
  const identity = digest(before);
  await mkdir(path.dirname(destination), { recursive: true });
  destination = path.join(await realpath(path.dirname(destination)), path.basename(destination));
  await mkdir(publicationRoot, { recursive: true });
  publicationRoot = await realpath(publicationRoot);
  for (const directory of [await realpath(source), destination]) {
    const relative = path.relative(directory, publicationRoot);
    if (
      !relative ||
      (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
    )
      throw new Error('Publication control state must be outside snapshot content');
  }
  const db = new DatabaseSync(path.join(publicationRoot, `${digest(destination)}.sqlite`), { timeout: 0 });
  try {
    db.exec(`PRAGMA synchronous=FULL;
      CREATE TABLE IF NOT EXISTS publication (
        id INTEGER PRIMARY KEY CHECK(id=1), destination TEXT NOT NULL,
        digest TEXT NOT NULL, staging TEXT NOT NULL, state TEXT NOT NULL CHECK(state IN ('pending','published'))
      ) STRICT;
      BEGIN IMMEDIATE;`);
    db.prepare('INSERT OR IGNORE INTO publication VALUES (1,?,?,?,?)').run(
      destination,
      identity,
      `${destination}.${randomUUID()}.staging`,
      'pending',
    );
    db.exec('COMMIT; BEGIN IMMEDIATE;');
    // Re-read after acquiring the writer lock: a competing publisher may have completed between transactions.
    const intent = db.prepare('SELECT * FROM publication WHERE id=1').get() as {
      destination: string;
      digest: string;
      staging: string;
      state: 'pending' | 'published';
    };
    if (intent.destination !== destination || intent.digest !== identity)
      throw new Error('Frozen publication identity changed');
    const observed = (phase: string) => publications.publish({ destination, identity, phase });
    observed('reserved');
    let present = false;
    try {
      await lstat(destination);
      present = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    if (present) {
      if ((await treeDigest(destination)) !== identity)
        throw new Error('Frozen publication content mismatch');
    } else {
      if (intent.state === 'published') throw new Error('Published snapshot is missing');
      const staging = intent.staging;
      // Only the exact persisted staging path is ours. The OS writer lock excludes a live publisher.
      try {
        const stat = await lstat(staging);
        if (!stat.isDirectory() || stat.isSymbolicLink())
          throw new Error('Invalid publication staging directory');
        await chmod(staging, 0o755);
        await rm(staging, { recursive: true });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      await mkdir(staging);
      for (const entry of before) {
        const bytes = await readFile(confined(source, entry.path));
        if (createHash('sha256').update(bytes).digest('hex') !== entry.hash)
          throw new Error('Source changed while freezing');
        const target = confined(staging, entry.path);
        await mkdir(path.dirname(target), { recursive: true });
        await writeFile(target, bytes, { flag: 'wx', mode: entry.executable ? 0o555 : 0o444 });
        observed('copying');
      }
      if ((await treeDigest(source)) !== identity) throw new Error('Source changed while freezing');
      await chmod(staging, 0o555);
      observed('ready');
      await rename(staging, destination);
      observed('published');
    }
    db.exec("UPDATE publication SET state='published' WHERE id=1; COMMIT;");
    observed('committed');
    return identity;
  } finally {
    if (db.isTransaction) db.exec('ROLLBACK');
    db.close();
  }
}
export async function atomicJSON(file: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const content = `${canonical(value)}\n`;
  try {
    if ((await readFile(file, 'utf8')) === content) return;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const temporary = `${file}.${randomUUID()}.tmp`;
  await writeFile(temporary, content, { flag: 'wx', mode: 0o600 });
  await rename(temporary, file);
}
