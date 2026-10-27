import { createHash, randomUUID } from 'node:crypto';
import { readdir, lstat, readFile, mkdir, writeFile, rename, rm, chmod } from 'node:fs/promises';
import path from 'node:path';

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
export async function freeze(source: string, destination: string): Promise<string> {
  const before = await inventory(source);
  const staging = `${destination}.${randomUUID()}.staging`;
  await mkdir(path.dirname(destination), { recursive: true });
  const reservation = `${destination}.freeze-lock`;
  await mkdir(reservation);
  await mkdir(staging, { recursive: true });
  try {
    try {
      await lstat(destination);
      throw new Error('Frozen destination already exists');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    for (const entry of before) {
      const bytes = await readFile(confined(source, entry.path));
      if (createHash('sha256').update(bytes).digest('hex') !== entry.hash)
        throw new Error('Source changed while freezing');
      const target = confined(staging, entry.path);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, bytes, { flag: 'wx', mode: entry.executable ? 0o555 : 0o444 });
    }
    if (digest(await inventory(source)) !== digest(before)) throw new Error('Source changed while freezing');
    await mkdir(path.dirname(destination), { recursive: true });
    await rename(staging, destination);
    await chmod(destination, 0o555);
    return digest(before);
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  } finally {
    await rm(reservation, { recursive: true });
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
