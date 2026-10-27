import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { atomicJSON, treeDigest, inventory, freeze, digest } from './artifacts.js';
import { Docker } from './docker.js';
import type { Store } from './store.js';
import { optimizerLedger } from './optimizer.js';

export function archiveIdentity(store: Store, candidate: string): string {
  return digest({ experiment: store.getMeta('experimentId'), specification: digest(store.spec), candidate });
}

export async function exportCandidate(
  root: string,
  store: Store,
  id: string,
  destination: string,
  docker = new Docker(),
): Promise<void> {
  const candidate = store.candidate(id);
  if (candidate.phase === 'frozen' || candidate.phase === 'running')
    throw new Error('Export a terminal candidate so its research record is complete');
  const source = path.join(root, 'candidates', id);
  if ((await treeDigest(source)) !== id) throw new Error('Candidate integrity mismatch');
  await mkdir(destination);
  await freeze(source, path.join(destination, 'bundle'));
  const result = await docker.run(
    {
      name: `he-pack-${id.slice(0, 24)}-${Date.now()}`,
      image: store.spec.runtime.image,
      command: [
        'npm',
        'pack',
        '/candidate',
        '--ignore-scripts',
        '--pack-destination',
        '/workspace',
        '--json',
      ],
      mounts: [
        { source, target: '/candidate', writable: false },
        { source: destination, target: '/workspace', writable: true },
      ],
      env: { npm_config_cache: '/tmp/npm-cache' },
      network: 'none',
      timeoutSeconds: 120,
    },
    path.join(destination, 'pack-log'),
  );
  if (result.ExitCode !== 0) throw new Error('Native npm bundle packing failed');
  const ancestors = new Set<string>();
  const visit = (hash: string) => {
    if (ancestors.has(hash)) return;
    ancestors.add(hash);
    for (const parent of store.candidate(hash).proposal.parents) visit(parent);
  };
  visit(id);
  const lineage = await Promise.all(
    [...ancestors].map(async (hash) => {
      const record = store.candidate(hash);
      let report: unknown = null;
      try {
        report = JSON.parse(await readFile(path.join(root, 'reports', `${hash}.json`), 'utf8'));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      const evidence = await Promise.all(
        store.runs(hash).map(async (run) => {
          const areas: Record<string, unknown> = {};
          for (const area of ['delivery', 'trace']) {
            try {
              areas[area] = await inventory(path.join(root, 'runs', run.id, area));
            } catch (error) {
              if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
              areas[area] = null;
            }
          }
          return { run: run.id, areas };
        }),
      );
      return { candidate: record, report, evidence };
    }),
  );
  await atomicJSON(path.join(destination, 'research-record.json'), {
    format: 'harness-evolution-research-archive',
    archiveId: archiveIdentity(store, id),
    experimentId: store.getMeta('experimentId'),
    candidate,
    specification: store.spec,
    runs: store.runs(id),
    lineage,
    events: store.events(),
    optimizer: await optimizerLedger(root),
    bundleFiles: await inventory(source),
    evidencePolicy:
      'Evidence manifests contain paths and hashes, not raw inputs, model traces, credentials or evaluation-private data. Review model-authored hypotheses before public distribution.',
    claim:
      'Search outcome only. Independent replication, leakage review and transfer evaluation are required before a generalization claim.',
  });
}
