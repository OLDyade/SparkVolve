import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import { channel } from 'node:diagnostics_channel';
import path from 'node:path';
import { z } from 'zod';
import type { Controller } from './controller.js';
import { Digest, Id, RelativePath } from './contracts.js';
import { authorizeOptimizerEvidence } from './optimizer-access.js';
import { confined, digest, inventory, treeDigest } from './artifacts.js';
import { readAuthorizedFile } from './file-reader.js';

const publications = channel('sparkvolve:materialization');

export const TaskEvidenceReference = z.strictObject({
  kind: z.literal('task'),
  id: Id,
  area: z.literal('input'),
  file: RelativePath.optional(),
});
export const RunEvidenceReference = z.strictObject({
  kind: z.literal('run'),
  id: Digest,
  area: z.enum(['input', 'delivery', 'trace']),
  file: RelativePath.optional(),
});
export const CandidateEvidenceReference = z.strictObject({
  kind: z.literal('candidate'),
  id: Digest,
  area: z.enum(['source', 'build', 'artifact', 'qa']),
  file: RelativePath.optional(),
});
export const ProbeEvidenceReference = z.strictObject({
  kind: z.literal('probe'),
  id: Digest,
  area: z.enum(['source', 'suite', 'build', 'artifact', 'logs', 'observations']),
  file: RelativePath.optional(),
});
export const AssetEvidenceReference = z.strictObject({
  kind: z.literal('asset'),
  id: Digest,
  area: z.literal('source'),
  file: RelativePath.optional(),
});
export const EvidenceReference = z.discriminatedUnion('kind', [
  TaskEvidenceReference,
  RunEvidenceReference,
  CandidateEvidenceReference,
  ProbeEvidenceReference,
  AssetEvidenceReference,
]);
export type EvidenceReferenceSpec = z.infer<typeof EvidenceReference>;

/** All inventory, byte reads and materialization use the same experiment authorization. */
export async function readEvidence(controller: Controller, raw: unknown): Promise<unknown> {
  const reference = EvidenceReference.parse(raw);
  authorizeOptimizerEvidence(controller, reference);
  let root: string;
  switch (reference.kind) {
    case 'task': {
      const task = controller.spec.tasks.find((item) => item.id === reference.id);
      if (!task) throw new Error('Unknown task');
      root = confined(controller.dataset, task.input);
      break;
    }
    case 'asset':
      return await controller.asset(reference.id, reference.file);
    case 'run': {
      const run = controller.store.runs().find((item) => item.id === reference.id);
      if (!run) throw new Error('Unknown run');
      const task = controller.spec.tasks.find((item) => item.id === run.task);
      if (!task) throw new Error('Missing task identity');
      root =
        reference.area === 'input'
          ? confined(controller.dataset, task.input)
          : path.join(controller.root, 'runs', run.id, reference.area);
      break;
    }
    case 'candidate':
      controller.store.candidate(reference.id);
      root = path.join(
        controller.root,
        { source: 'candidates', build: 'builds', artifact: 'artifacts', qa: 'qa' }[reference.area],
        reference.id,
        ...(reference.area === 'build' ? ['logs'] : []),
      );
      break;
    case 'probe': {
      const probe = controller.store.probes().find((item) => item.id === reference.id);
      if (!probe) throw new Error('Unknown probe');
      const areas = {
        source: `candidates/${probe.sourceDigest}`,
        suite: 'suite',
        build: `builds/${probe.sourceDigest}/logs`,
        artifact: `artifacts/${probe.sourceDigest}`,
        logs: 'logs',
        observations: 'work',
      };
      root = path.join(controller.root, 'probes', probe.id, areas[reference.area]);
      break;
    }
  }
  if (reference.file === undefined) return await inventory(root);
  return {
    file: reference.file,
    encoding: 'base64',
    data: (await readAuthorizedFile(root, reference.file)).toString('base64'),
  };
}

const BinaryArtifact = z.looseObject({ encoding: z.literal('base64'), data: z.string() });
const publishing = new Map<string, Promise<void>>();

/** The optimizer receives a read-only path, never a host write into its mutable workspace. */
export async function materializeEvidence(controller: Controller, raw: unknown) {
  const reference = EvidenceReference.parse(raw);
  if (!reference.file) throw new Error('Materialization requires an explicit file');
  const artifact = BinaryArtifact.parse(await readEvidence(controller, reference));
  const bytes = Buffer.from(artifact.data, 'base64');
  return await publishEvidenceBytes(controller.root, reference.file, bytes, {
    experimentId: controller.store.getMeta('experimentId')!,
    reference,
  });
}

/** Trusted callers authorize the bytes first. Publication never accepts a caller-selected destination. */
export async function publishEvidenceBytes<T extends object>(
  root: string,
  sourceFile: string,
  bytes: Buffer,
  source: T,
) {
  RelativePath.parse(sourceFile);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const provenance = {
    ...source,
    sha256,
    bytes: bytes.length,
  };
  const identity = digest(provenance);
  const destination = path.join(root, 'materialized', identity);
  const file = `files/${path.basename(sourceFile)}`;
  let operation = publishing.get(destination);
  if (!operation) {
    operation = (async () => {
      const stagingRoot = path.join(root, 'materialization-staging');
      await mkdir(stagingRoot, { recursive: true });
      const staging = await mkdtemp(path.join(stagingRoot, 'snapshot-'));
      try {
        await mkdir(path.join(staging, 'files'));
        await writeFile(path.join(staging, file), bytes, { flag: 'wx', mode: 0o444 });
        await writeFile(path.join(staging, 'provenance.json'), `${JSON.stringify(provenance)}\n`, {
          flag: 'wx',
          mode: 0o444,
        });
        const contentDigest = await treeDigest(staging);
        await mkdir(path.dirname(destination), { recursive: true });
        publications.publish({ phase: 'prepared', staging, destination, identity });
        // The complete directory crosses into the read-only mount in one atomic rename.
        // A lost response or another process can reuse only byte-identical content and provenance.
        try {
          await rename(staging, destination);
        } catch (error) {
          if (!['EEXIST', 'ENOTEMPTY'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error;
          if ((await treeDigest(destination)) !== contentDigest)
            throw new Error('Materialized evidence publication content mismatch');
        }
        publications.publish({ phase: 'published', destination, identity });
      } finally {
        await rm(staging, { recursive: true, force: true });
      }
    })().finally(() => publishing.delete(destination));
    publishing.set(destination, operation);
  }
  await operation;
  return {
    path: `/evidence/${identity}/${file}`,
    provenance: `/evidence/${identity}/provenance.json`,
    ...provenance,
  };
}
