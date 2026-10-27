import { cp, mkdir, readFile, writeFile, rename, chmod, readdir } from 'node:fs/promises';
import path from 'node:path';
import { command } from '../docker.js';
import { atomicJSON, fileDigest, treeDigest, inventory } from '../artifacts.js';

// One process in the contracted builder image. It receives no task, grading or model credentials.
const work = '/workspace/source';
const output = '/workspace/output';
await cp('/source', work, { recursive: true, errorOnExist: true, force: false });
const writable = async (directory: string): Promise<void> => {
  await chmod(directory, 0o755);
  for (const entry of await readdir(directory, { withFileTypes: true }))
    if (entry.isDirectory()) await writable(path.join(directory, entry.name));
};
await writable(work);
for (const entry of await inventory(work))
  await chmod(path.join(work, entry.path), entry.executable ? 0o755 : 0o644);
await mkdir(output);
process.chdir(work);
const originalPackage = await readFile('package.json', 'utf8');
const lockDigest = await fileDigest('package-lock.json');
const pkg = JSON.parse(originalPackage);
if (!pkg.scripts?.build) throw new Error('Candidate package must declare scripts.build');
const lock = JSON.parse(await readFile('package-lock.json', 'utf8'));
if (lock.lockfileVersion !== 3) throw new Error('Candidate needs a version 3 npm lockfile');

const execute = async (args: string[]) => {
  const result = await command('npm', args, { timeoutMs: Number(process.env.BUILD_TIMEOUT_SECONDS) * 1000 });
  process.stdout.write(`${result}\n`);
  return result;
};
await execute(['ci', '--omit=peer', '--no-audit', '--no-fund']);
await execute(['run', 'build']);
if (
  originalPackage !== (await readFile('package.json', 'utf8')) ||
  lockDigest !== (await fileDigest('package-lock.json'))
)
  throw new Error('Build modified the source package manifest or dependency lock');

// Ship runtime dependencies inside the artifact. Native host peers remain host-owned.
pkg.bundleDependencies = [
  ...new Set([...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.optionalDependencies ?? {})]),
].sort();
delete pkg.bundledDependencies;
await writeFile('package.json', JSON.stringify(pkg, null, 2));
await cp('package-lock.json', 'npm-shrinkwrap.json');
const pack = JSON.parse(await execute(['pack', '--ignore-scripts', '--json', '--pack-destination', output]))[
  pkg.name
];
if (typeof pack.filename !== 'string' || path.basename(pack.filename) !== pack.filename)
  throw new Error('Invalid npm pack result');
await rename(path.join(output, pack.filename), path.join(output, 'bundle.tgz'));
await mkdir(path.join(output, 'bundle'));
await command('tar', [
  '-xzf',
  path.join(output, 'bundle.tgz'),
  '-C',
  path.join(output, 'bundle'),
  '--strip-components=1',
]);
await atomicJSON(path.join(output, 'receipt.json'), {
  sourceDigest: await treeDigest('/source'),
  lockDigest,
  bundleDigest: await treeDigest(path.join(output, 'bundle')),
  tarballDigest: await fileDigest(path.join(output, 'bundle.tgz')),
  node: process.version,
  npm: await command('npm', ['--version']),
  commands: ['npm ci --omit=peer --no-audit --no-fund', 'npm run build', 'npm pack --ignore-scripts'],
});
