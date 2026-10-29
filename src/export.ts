import { mkdir, readFile, copyFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { atomicJSON, treeDigest, inventory, freeze, digest, fileDigest } from './artifacts.js';
import { bundlePath, verifyBuild } from './build.js';
import type { Store } from './store.js';
import { optimizerLedger } from './optimizer.js';
import { experimentReport } from './report.js';
import { capabilityCard } from './capability-card.js';

export function archiveIdentity(store: Store, candidate: string): string {
  return digest({ experiment: store.getMeta('experimentId'), specification: digest(store.spec), candidate });
}

export async function exportCandidate(
  root: string,
  store: Store,
  id: string,
  destination: string,
): Promise<void> {
  const candidate = store.candidate(id);
  if (candidate.phase === 'frozen' || candidate.phase === 'running')
    throw new Error('Export a terminal candidate so its research record is complete');
  const source = path.join(root, 'candidates', id);
  if ((await treeDigest(source)) !== id) throw new Error('Candidate integrity mismatch');
  await mkdir(destination);
  await freeze(source, path.join(destination, 'source'), path.join(root, 'publications'));
  if (candidate.build) {
    await verifyBuild(root, candidate);
    await freeze(
      path.join(root, 'artifacts', id),
      path.join(destination, 'artifact'),
      path.join(root, 'publications'),
    );
    await copyFile(path.join(root, 'artifacts', id, 'bundle.tgz'), path.join(destination, 'bundle.tgz'));
  }
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
    format: 'sparkvolve-research-archive',
    archiveId: archiveIdentity(store, id),
    experimentId: store.getMeta('experimentId'),
    candidate,
    specification: store.spec,
    runs: store.runs(id),
    lineage,
    events: store.events(),
    optimizer: await optimizerLedger(root),
    sourceFiles: await inventory(source),
    bundleFiles: candidate.build ? await inventory(bundlePath(root, candidate)) : null,
    evidencePolicy:
      'Evidence manifests contain paths and hashes, not raw inputs, model traces, credentials or evaluation-private data. Review model-authored hypotheses before public distribution.',
    claim:
      'Search outcome only. Independent replication, leakage review and transfer evaluation are required before a generalization claim.',
  });
  const report = await experimentReport(root, store);
  await atomicJSON(path.join(destination, 'experiment-report.json'), report);
  await writeFile(
    path.join(destination, 'CAPABILITY.md'),
    capabilityCard({
      archiveId: archiveIdentity(store, id),
      specification: store.spec,
      candidate,
      report,
      researchRecordSha256: await fileDigest(path.join(destination, 'research-record.json')),
      experimentReportSha256: await fileDigest(path.join(destination, 'experiment-report.json')),
    }),
    { flag: 'wx' },
  );
}
