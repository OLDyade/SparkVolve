import { cp, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { atomicJSON, fileDigest, treeDigest } from '../src/artifacts.js';
import type { ExperimentSpec } from '../src/contracts.js';

/** Deliberately synthetic artifact for host state-machine tests; native builds have separate container QA. */
export async function optimizerArtifactFixture(root: string, spec: ExperimentSpec): Promise<void> {
  const source = path.join(root, 'dataset', 'optimizer-bundle');
  await mkdir(source, { recursive: true });
  await writeFile(path.join(source, 'plugins.yml'), '[]');
  await writeFile(path.join(source, 'cordis.patch.yml'), '[]');
  await atomicJSON(path.join(source, 'package.json'), {
    name: 'synthetic-optimizer',
    dsh: { bundle: { patch: './cordis.patch.yml' } },
  });
  await atomicJSON(path.join(source, 'package-lock.json'), { lockfileVersion: 3 });
  const artifact = path.join(root, 'dataset', 'optimizer-artifact');
  await mkdir(artifact);
  await cp(source, path.join(artifact, 'bundle'), { recursive: true });
  await writeFile(path.join(artifact, 'bundle.tgz'), 'synthetic archive, not an npm acceptance');
  const sourceDigest = await treeDigest(source);
  const receipt = {
    sourceDigest,
    lockDigest: await fileDigest(path.join(source, 'package-lock.json')),
    bundleDigest: await treeDigest(path.join(artifact, 'bundle')),
    tarballDigest: await fileDigest(path.join(artifact, 'bundle.tgz')),
  };
  await atomicJSON(path.join(artifact, 'receipt.json'), receipt);
  const { sourceDigest: _, ...hashes } = receipt;
  spec.optimizerHarness = {
    kind: 'artifact',
    source: { directory: 'optimizer-bundle', digest: sourceDigest },
    composition: 'plugins.yml',
    artifact: {
      directory: 'optimizer-artifact',
      identity: { ...hashes, artifactDigest: await treeDigest(artifact), image: spec.runtime.image },
    },
  };
}
