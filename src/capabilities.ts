import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { z } from 'zod';
import { parseMarketIndex, marketInstallTarget } from '@deepseek-ai/dsh-plugin-market-index';
import {
  OPTIONAL_BUNDLES,
  PROFILE_TEMPLATES,
  OFFICIAL_ON_DEMAND_CATALOG,
  getDshRuntimeVersion,
  evaluatePluginCompatibility,
  bundlePatchFiles,
} from '@deepseek-ai/dsh-app-boot';
import { atomicJSON, digest, freeze, treeDigest, confined } from './artifacts.js';
import { readArchive } from './library.js';

const Source = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('package'), spec: z.string().min(1), registry: z.url() }),
  z.strictObject({
    kind: z.literal('source'),
    directory: z.string().min(1),
    digest: z.string().regex(/^[a-f0-9]{64}$/),
  }),
]);
export const Capability = z.strictObject({
  id: z.string().regex(/^[a-f0-9]{64}$/),
  name: z.string().min(1),
  version: z.string().min(1),
  description: z.string(),
  origin: z.enum(['official', 'market', 'local', 'research']),
  source: Source,
  provenance: z.record(z.string(), z.unknown()),
  compatibility: z
    .strictObject({
      name: z.string(),
      version: z.string(),
      runtimeVersion: z.string(),
      requirements: z.record(z.string(), z.string()),
      exempted: z.boolean(),
    })
    .nullable(),
});
export type CapabilityRecord = z.infer<typeof Capability>;
export const CapabilitySnapshot = z.strictObject({
  format: z.literal('sparkvolve-capability-catalog'),
  dshVersion: z.string(),
  entries: z.array(Capability),
  sources: z.array(z.record(z.string(), z.unknown())),
});
export const CatalogConfig = z.strictObject({
  indexes: z.array(z.url()),
  official: z.boolean(),
  local: z.array(z.string()),
  archives: z.array(z.string()),
  registry: z.url(),
  timeoutSeconds: z.number().positive(),
});
const require = createRequire(import.meta.url);
const text = (value: unknown): string => (typeof value === 'string' ? value : JSON.stringify(value ?? {}));

/** Snapshot configured sources once. Discovery never fetches a changing index during search. */
export async function prepareCapabilities(raw: unknown, base: string, output: string) {
  const config = CatalogConfig.parse(raw);
  await mkdir(output); // An existing catalog is never overwritten.
  const entries: CapabilityRecord[] = [];
  const sources: Record<string, unknown>[] = [];
  const add = (entry: Omit<CapabilityRecord, 'id'>) => {
    const record = Capability.parse({ ...entry, id: digest(entry) });
    if (entries.some((item) => item.id === record.id)) throw Error('Duplicate capability identity');
    entries.push(record);
  };
  const dshVersion = getDshRuntimeVersion();
  if (config.official) {
    const names = new Set([
      ...OPTIONAL_BUNDLES,
      ...Object.values(PROFILE_TEMPLATES).flatMap((p) => p.bundles),
    ]);
    for (const name of [...names].sort()) {
      const pkg = JSON.parse(await readFile(require.resolve(name + '/package.json'), 'utf8'));
      add({
        name,
        version: pkg.version,
        description: pkg.description ?? '',
        origin: 'official',
        source: { kind: 'package', spec: name + '@' + pkg.version, registry: config.registry },
        provenance: { manifest: pkg, manifestDigest: digest(pkg), installedInCatalogHost: true },
        compatibility: evaluatePluginCompatibility(pkg, {}, dshVersion) ?? null,
      });
    }
    for (const item of OFFICIAL_ON_DEMAND_CATALOG)
      if (!names.has(item.packageName)) {
        add({
          name: item.packageName,
          version: dshVersion,
          description: text(item.meta.description),
          origin: 'official',
          source: { kind: 'package', spec: item.packageName + '@' + dshVersion, registry: config.registry },
          provenance: { metadata: item.meta, installedInCatalogHost: false },
          compatibility: null,
        });
      }
  }
  for (const url of config.indexes) {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(config.timeoutSeconds * 1000),
      redirect: 'error',
    });
    if (!response.ok) throw Error('Market fetch failed: ' + response.status + ' ' + url);
    const bytes = await response.text();
    const parsed = parseMarketIndex(JSON.parse(bytes), url);
    const file = 'indexes/' + digest(url) + '.json';
    await mkdir(path.join(output, 'indexes'), { recursive: true });
    await writeFile(confined(output, file), bytes, { flag: 'wx' });
    sources.push({ kind: 'market', url, file, fetchedAt: new Date().toISOString() });
    for (const plugin of parsed.plugins)
      for (const version of plugin.versions) {
        const target = marketInstallTarget(plugin.name, version);
        add({
          name: plugin.name,
          version: version.version,
          description: text(plugin.description),
          origin: 'market',
          source: { kind: 'package', spec: target.spec, registry: target.registry ?? config.registry },
          provenance: { index: url, plugin, selectedVersion: version },
          compatibility:
            evaluatePluginCompatibility(
              { name: plugin.name, version: version.version, engines: version.engines },
              {},
              dshVersion,
            ) ?? null,
        });
      }
  }
  for (const [kind, paths] of [
    ['local', config.local],
    ['research', config.archives],
  ] as const) {
    for (const value of paths) {
      const directory = path.resolve(base, value);
      const archive = kind === 'research' ? await readArchive(directory) : null;
      const source = archive ? path.join(directory, 'source') : directory;
      const pkg = JSON.parse(await readFile(path.join(source, 'package.json'), 'utf8'));
      bundlePatchFiles(pkg.dsh?.bundle);
      const hash = await treeDigest(source);
      const relative = 'sources/' + hash;
      await freeze(source, confined(output, relative), output + '.publications');
      add({
        name: pkg.name,
        version: pkg.version,
        description: pkg.description ?? '',
        origin: kind,
        source: { kind: 'source', directory: relative, digest: hash },
        provenance: {
          manifest: pkg,
          ...(archive ? { archive: archive.record, recordDigest: archive.recordDigest } : {}),
        },
        compatibility: evaluatePluginCompatibility(pkg, {}, dshVersion) ?? null,
      });
    }
  }
  const snapshot = CapabilitySnapshot.parse({
    format: 'sparkvolve-capability-catalog',
    dshVersion,
    entries,
    sources,
  });
  await atomicJSON(path.join(output, 'catalog.json'), snapshot);
  return { directory: output, digest: await treeDigest(output), entries: entries.length, dshVersion };
}

export async function readCapabilities(directory: string, expected: string) {
  if ((await treeDigest(directory)) !== expected) throw Error('Capability catalog snapshot changed');
  const snapshot = CapabilitySnapshot.parse(
    JSON.parse(await readFile(path.join(directory, 'catalog.json'), 'utf8')),
  );
  for (const { id, ...entry } of snapshot.entries)
    if (digest(entry) !== id) throw Error('Capability identity mismatch');
  if (new Set(snapshot.entries.map((entry) => entry.id)).size !== snapshot.entries.length)
    throw Error('Duplicate capability identity');
  return snapshot;
}

export function searchCapabilities(
  snapshot: z.infer<typeof CapabilitySnapshot>,
  query: string,
  offset: number,
  limit: number,
) {
  // Literal retrieval only; semantic fit remains the optimizer's research decision.
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const entries = snapshot.entries.filter((entry) =>
    words.every((word) => JSON.stringify(entry).toLowerCase().includes(word)),
  );
  return {
    total: entries.length,
    entries: entries
      .slice(offset, offset + limit)
      .map(({ provenance, ...entry }) => ({ ...entry, provenanceDigest: digest(provenance) })),
    nextOffset: offset + limit < entries.length ? offset + limit : null,
    evidence:
      'Declared capabilities only. Compatibility and actual task behavior require candidate resolution and native evaluation.',
  };
}
