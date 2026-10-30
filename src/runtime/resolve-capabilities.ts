import { cp, mkdir, readFile, writeFile, chmod, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import {
  initProfile,
  bundlePatchFiles,
  evaluatePluginCompatibility,
  getDshRuntimeVersion,
} from '@deepseek-ai/dsh-app-boot';
import { initializeRuntimeEnvironment } from '../runtime-environment.js';
import { Capability } from '../capabilities.js';
import { atomicJSON, digest, treeDigest, fileDigest, inventory, confined } from '../artifacts.js';
import { command } from '../command.js';

await initializeRuntimeEnvironment();
const request = JSON.parse(await readFile('/request.json', 'utf8'));
const entries = request.entries.map((entry: unknown) => Capability.parse(entry));
const work = '/workspace/draft';
await cp('/parent', work, { recursive: true });
async function writable(directory: string) {
  await chmod(directory, 0o755);
  for (const entry of await readdir(directory, { withFileTypes: true }))
    if (entry.isDirectory()) await writable(path.join(directory, entry.name));
}
await writable(work);
for (const entry of await inventory(work))
  await chmod(confined(work, entry.path), entry.executable ? 0o755 : 0o644);
const pkg = JSON.parse(await readFile(path.join(work, 'package.json'), 'utf8'));
const layers = bundlePatchFiles(pkg.dsh.bundle);
const selectedLayers: string[] = [];
const deadline = Date.now() + request.timeoutSeconds * 1000;
const run = async (program: string, args: string[]) => {
  const result = await command(program, args, { timeoutMs: deadline - Date.now() });
  if (program !== 'npm' || !args.includes('--json')) process.stdout.write(result + '\n');
  return result;
};
const records = [];
const require = createRequire(import.meta.url);
const cli = path.join(path.dirname(require.resolve('@deepseek-ai/dsh/package.json')), 'lib/bin.js');
const profile = '/workspace/resolution-home/profiles/candidate';
process.env.DSH_HOME = '/workspace/resolution-home';
initProfile(profile, []);
await mkdir(path.join(work, 'vendor'), { recursive: true });
for (const entry of entries) {
  if (entry.compatibility) throw Error('Catalog declares an incompatible capability: ' + entry.name);
  let target: string;
  if (entry.source.kind === 'source') {
    const local = '/workspace/local-' + entry.id;
    if ((await treeDigest(confined('/catalog', entry.source.directory))) !== entry.source.digest)
      throw Error('Source identity mismatch');
    await cp(confined('/catalog', entry.source.directory), local, { recursive: true });
    await writable(local);
    for (const file of await inventory(local))
      await chmod(confined(local, file.path), file.executable ? 0o755 : 0o644);
    process.chdir(local);
    await run('npm', ['ci', '--omit=peer', '--no-audit', '--no-fund']);
    await run('npm', ['run', 'build']);
    const packed = JSON.parse(await run('npm', ['pack', '--ignore-scripts', '--json']))[entry.name];
    target = path.join(local, packed.filename);
  } else target = entry.source.spec;
  process.chdir('/workspace');
  await run(process.execPath, [
    cli,
    'plugin',
    '--profile',
    'candidate',
    'add',
    target,
    '--save-exact',
    '--ignore-scripts',
    ...(entry.source.kind === 'package' ? ['--registry', entry.source.registry] : []),
  ]);
  const packageRoot = await realpath(path.join(profile, 'node_modules', entry.name));
  const manifest = JSON.parse(await readFile(path.join(packageRoot, 'package.json'), 'utf8'));
  if (manifest.name !== entry.name || manifest.version !== entry.version)
    throw Error('Resolved package identity differs from catalog');
  const compatibility = evaluatePluginCompatibility(manifest, {}, getDshRuntimeVersion());
  if (compatibility) throw Error('Resolved package is incompatible: ' + JSON.stringify(compatibility));
  const patches = bundlePatchFiles(manifest.dsh?.bundle);
  process.chdir(packageRoot);
  const packed = JSON.parse(
    await run('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', '/workspace']),
  )[manifest.name];
  const tarball = '/workspace/' + packed.filename;
  const hash = await fileDigest(tarball);
  const relative = 'vendor/' + hash + '.tgz';
  await cp(tarball, confined(work, relative));
  pkg.dependencies ??= {};
  pkg.dependencies[entry.name] = 'file:./' + relative;
  // Explicit native layer ordering; caller edits the draft to tune, disable or replace layers.
  const prefix = './node_modules/' + entry.name + '/';
  for (let i = layers.length - 1; i >= 0; i--) if (layers[i]!.startsWith(prefix)) layers.splice(i, 1);
  selectedLayers.push(...patches.map((file) => prefix + file.replace(/^\.\//, '')));
  records.push({
    capability: entry,
    manifest,
    manifestDigest: digest(manifest),
    tarball: relative,
    tarballDigest: hash,
    patches,
    installation: 'native dsh plugin add; isolated profile; scripts deferred to build',
    resolutionLockDigest: await fileDigest(path.join(profile, 'pnpm-lock.yaml')),
  });
}
layers.unshift(...selectedLayers);
pkg.dsh.bundle.patch = layers;
pkg.files = [...new Set([...(pkg.files ?? ['**']), 'vendor', 'capability-resolution.json'])];
process.chdir(work);
await writeFile('package.json', JSON.stringify(pkg, null, 2) + '\n');
await run('npm', [
  'install',
  '--package-lock-only',
  '--ignore-scripts',
  '--omit=peer',
  '--no-audit',
  '--no-fund',
]);
await atomicJSON(path.join(work, 'capability-resolution.json'), {
  format: 'sparkvolve-capability-resolution',
  catalogDigest: request.catalogDigest,
  parent: request.parent,
  records,
  patches: layers,
  evidence: 'Resolved dependencies and declared layers. Native QA and task evaluation are separate.',
});
await atomicJSON('/workspace/result.json', { draftDigest: await treeDigest(work), records });
