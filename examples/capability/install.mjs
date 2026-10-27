// Run inside the declared Harness runtime image. Installs through the native DSH launcher.
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parse, stringify } from 'yaml';
import { command } from '../../dist/docker.js';

const [bundle] = process.argv.slice(2);
if (!bundle || !process.env.DSH_HOME) throw new Error('Required: bundle.tgz argument and DSH_HOME');
await command('dsh', ['--profile', 'headless', '--dump-default-config'], { timeoutMs: 60000 });
const workspace = path.join(process.env.DSH_HOME, 'profiles/headless/pnpm-workspace.yaml');
const settings = parse(await readFile(workspace, 'utf8'));
const runtimePackage = JSON.parse(await readFile('/app/package.json', 'utf8'));
settings.allowBuilds = runtimePackage.allowScripts;
await writeFile(workspace, stringify(settings));
console.log(
  await command('dsh', ['plugin', '--profile', 'headless', 'add', path.resolve(bundle)], {
    timeoutMs: 300000,
  }),
);
