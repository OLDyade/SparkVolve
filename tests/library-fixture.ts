import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { atomicJSON, digest, treeDigest } from '../src/artifacts.js';

/** Explicit synthetic negative research record for protocol tests; never a benchmark outcome. */
export async function libraryFixture(
  library: string,
  hypothesis = 'A prior mechanism needs adaptation; negative results remain discoverable',
) {
  const sourceFiles: Record<string, string> = {
    'index.mjs':
      'export const name = "reuse-example"; export const inject = ["systemPrompt"]; export function apply(ctx) { ctx.systemPrompt.section({name:"reuse-example",order:500,text:"Inspect original evidence before proposing plugin changes."}); }',
    'package.json': JSON.stringify({
      name: '@fixture/reuse-example',
      version: '1.0.0',
      type: 'module',
      scripts: { build: 'node --check index.mjs' },
      dsh: { bundle: { patch: './cordis.patch.yml' } },
    }),
    'package-lock.json': JSON.stringify({
      name: '@fixture/reuse-example',
      version: '1.0.0',
      lockfileVersion: 3,
      requires: true,
      packages: { '': { name: '@fixture/reuse-example', version: '1.0.0' } },
    }),
    'cordis.patch.yml': '- insert:\n    - id: reuse-example\n      name: ./index.mjs\n',
  };
  const { mkdtemp, rename } = await import('node:fs/promises');
  await mkdir(library, { recursive: true });
  const staging = await mkdtemp(path.join(library, 'fixture-'));
  await mkdir(path.join(staging, 'source'));
  for (const [file, data] of Object.entries(sourceFiles))
    await writeFile(path.join(staging, 'source', file), data);
  const sourceCandidate = await treeDigest(path.join(staging, 'source'));
  const experimentId = randomUUID();
  const specification = {
    name: 'synthetic-negative-research',
    objective: 'Protocol fixture only; no quality claim',
  };
  const archiveId = digest({
    experiment: experimentId,
    specification: digest(specification),
    candidate: sourceCandidate,
  });
  const record = {
    format: 'sparkvolve-research-archive',
    archiveId,
    experimentId,
    candidate: {
      digest: sourceCandidate,
      phase: 'qa_failed',
      qaError: 'Synthetic negative example',
      proposal: {
        hypothesis,
        actions: ['author'],
      },
    },
    specification,
  };
  await atomicJSON(path.join(staging, 'research-record.json'), record);
  await rename(staging, path.join(library, archiveId));
  return { archiveId, sourceCandidate, record, recordDigest: digest(record) };
}
