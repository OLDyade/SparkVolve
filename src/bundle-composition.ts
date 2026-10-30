import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  bundlePatchFiles,
  evaluatePluginCompatibility,
  getDshRuntimeVersion,
} from '@deepseek-ai/dsh-app-boot';
import { confined } from './artifacts.js';

/** Native Bundle patch order is shared by QA, execution and original-package installation. */
export async function bundleLayers(directory: string, mount = directory): Promise<string[]> {
  const pkg = JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8'));
  const incompatible = evaluatePluginCompatibility(pkg, {}, getDshRuntimeVersion());
  if (incompatible) throw Error('Incompatible Bundle: ' + JSON.stringify(incompatible));
  return bundlePatchFiles(pkg.dsh?.bundle).map((file) => confined(mount, file.replace(/^\.\//, '')));
}
