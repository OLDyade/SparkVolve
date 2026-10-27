import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { atomicJSON, treeDigest } from './artifacts.js';
import { Docker } from './docker.js';
import type { Store } from './store.js';

export async function exportCandidate(
  root: string,
  store: Store,
  id: string,
  destination: string,
  docker = new Docker(),
): Promise<void> {
  const candidate = store.candidate(id);
  const source = path.join(root, 'candidates', id);
  if ((await treeDigest(source)) !== id) throw new Error('Candidate integrity mismatch');
  await mkdir(destination);
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
  await atomicJSON(path.join(destination, 'research-record.json'), {
    candidate,
    specification: store.spec,
    runs: store.runs(id),
    claim:
      'Search outcome only. Independent replication, leakage review and transfer evaluation are required before a generalization claim.',
  });
}
