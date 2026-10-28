import type { Context } from '@deepseek-ai/cordis';
import * as CordisTools from '@deepseek-ai/dsh-tool-cordis';
import * as SkillFilesystem from '@deepseek-ai/dsh-skill-filesystem';
import * as SkillTool from '@deepseek-ai/dsh-tool-skill';
import '@deepseek-ai/dsh-system-prompt';
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';

export const name = 'evolution-native-authoring';
export const inject = ['tools', 'cordisInspect', 'skills', 'systemPrompt'];
const require = createRequire(import.meta.url);
const sha256 = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');

async function sourceTree(directory: string) {
  const files: Array<{ file: string; sha256: string }> = [];
  async function visit(relative: string): Promise<void> {
    const entries = await readdir(path.join(directory, relative), { withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
      const file = path.posix.join(relative, entry.name);
      if (entry.isDirectory()) await visit(file);
      else if (entry.isFile())
        files.push({ file, sha256: sha256(await readFile(path.join(directory, file))) });
      else throw Error(`Unsupported authoring resource type: ${file}`);
    }
  }
  await visit('');
  if (files.length === 0) throw Error(`Installed native authoring sources are empty: ${directory}`);
  return { directory, files, sha256: sha256(JSON.stringify(files)) };
}

/** Source identities describe the installed authoring support, never a candidate's separate runtime. */
export async function authoringSources() {
  const packages = await Promise.all(
    [
      '@deepseek-ai/dsh-tool-cordis',
      '@deepseek-ai/dsh-cordis-host-runner',
      '@deepseek-ai/dsh-skill-filesystem',
      '@deepseek-ai/dsh-skill',
      '@deepseek-ai/dsh-tool-skill',
      '@deepseek-ai/dsh-agent-preset',
      '@deepseek-ai/dsh-tools',
      '@deepseek-ai/cordis',
    ].map(async (name) => {
      const manifest = require.resolve(`${name}/package.json`);
      const bytes = await readFile(manifest);
      const metadata = JSON.parse(bytes.toString()) as { name: string; version: string };
      if (metadata.name !== name) throw Error(`Unexpected authoring package identity: ${manifest}`);
      const entry = require.resolve(name);
      return {
        name,
        version: metadata.version,
        directory: path.dirname(manifest),
        manifestSha256: sha256(bytes),
        entry,
        entrySha256: sha256(await readFile(entry)),
        sources: await sourceTree(path.join(path.dirname(manifest), 'lib')),
      };
    }),
  );
  const preset = packages.find((entry) => entry.name === '@deepseek-ai/dsh-agent-preset')!;
  return {
    packages,
    skills: await sourceTree(path.join(preset.directory, 'skills')),
  };
}

/** Compose the official read-only inspection tools and package-owned skills in the Agent scope. */
export async function apply(ctx: Context): Promise<void> {
  const sources = await authoringSources();
  ctx.plugin(CordisTools);
  ctx.plugin(SkillTool);
  ctx.plugin(SkillFilesystem, {
    providerName: name,
    customSkillDirs: [sources.skills.directory],
    includeDefaultRoots: false,
    watch: false,
  });
  ctx.systemPrompt.section({
    name: 'native-authoring-contract',
    order: 490,
    text: [
      'Native DSH authoring support is available through cordis_inspect_list, cordis_inspect_query and the skill tool. Discover the relevant exact Service, Event, Config or Tool contract before using an uncertain API. Official plugin-development and composition skills are loaded on demand; their original reference files remain in the installed package.',
      'Inspection describes this optimizer G: Service/Event are the shipped author API catalog, Config is the Host Loader schema directory (not current configuration values or a detached Preset tree), and Tool is the requesting Agent tool surface. Inspect the separately frozen candidate H through its native QA and authorized probes. G package identities do not certify H dependencies.',
      'Use the experiment controller tools in your actual tool schema to branch a separate draft, submit changes and run authorized probes. Skill examples about plugin_manager or changing the active profile do not authorize modifying the frozen optimizer environment. No plugin_manager is added by this support.',
      `Native authoring sources: ${JSON.stringify({
        packages: sources.packages.map(({ sources: tree, ...identity }) => ({
          ...identity,
          sources: { directory: tree.directory, files: tree.files.length, sha256: tree.sha256 },
        })),
        skills: {
          directory: sources.skills.directory,
          files: sources.skills.files.length,
          sha256: sources.skills.sha256,
        },
      })}`,
    ].join('\n'),
  });
}
