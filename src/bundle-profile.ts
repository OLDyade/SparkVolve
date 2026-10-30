import { mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { initProfile, PROFILE_TEMPLATES } from '@deepseek-ai/dsh-app-boot';
import { bundleLayers } from './bundle-composition.js';
import { atomicJSON, confined, fileDigest } from './artifacts.js';

/** Register an immutable built artifact in the native Profile resolution graph.
 * The binding Bundle contributes no plugins; caller-owned patch ordering is preserved.
 * DSH traverses dependencies and owns ESM/CJS resolution and Cordis loading.
 */
export async function prepareBundleProfile(profile: 'sdk' | 'sdk-minimal', home: string, bundle: string) {
  await bundleLayers(bundle);
  const manifest = JSON.parse(await readFile(path.join(bundle, 'package.json'), 'utf8'));
  if (typeof manifest.name !== 'string' || !manifest.name)
    throw Error('Native Bundle requires a package name');
  const bases = [...PROFILE_TEMPLATES[profile]!.bundles];
  const bindingName = '@sparkvolve/runtime-binding';
  if ([...bases, bindingName].includes(manifest.name))
    throw Error('Candidate package shadows a runtime-owned Bundle');
  const directory = path.join(home, 'profiles', profile);
  await mkdir(directory, { recursive: true });
  initProfile(directory, [...bases, bindingName]);
  const modules = path.join(directory, 'node_modules');
  await mkdir(modules, { recursive: true });
  const target = confined(modules, manifest.name);
  await mkdir(path.dirname(target), { recursive: true });
  await symlink(path.resolve(bundle), target, 'dir');
  const binding = path.join(modules, bindingName);
  await mkdir(binding, { recursive: true });
  await atomicJSON(path.join(binding, 'package.json'), {
    name: bindingName,
    version: '0.0.0',
    private: true,
    dependencies: { [manifest.name]: manifest.version },
    dsh: { bundle: { patch: './cordis.patch.yml' } },
  });
  await writeFile(path.join(binding, 'cordis.patch.yml'), '[]\n', { flag: 'wx' });
  await atomicJSON(path.join(directory, 'sparkvolve-binding.json'), {
    bundle: path.resolve(bundle),
    name: manifest.name,
    version: manifest.version,
    manifestDigest: await fileDigest(path.join(bundle, 'package.json')),
    bundles: [...bases, bindingName],
    mechanism: 'Explicit Profile dependency on immutable artifact; native DSH runtime resolution',
  });
}
