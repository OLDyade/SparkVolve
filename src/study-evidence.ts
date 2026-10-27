import path from 'node:path';
import { access, lstat, readdir } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { Digest, Experiment, PreparedOptimizer, RelativePath } from './contracts.js';
import { confined, digest, inventory } from './artifacts.js';
import { Controller } from './controller.js';
import { Store } from './store.js';
import {
  TaskEvidenceReference,
  RunEvidenceReference,
  CandidateEvidenceReference,
  ProbeEvidenceReference,
  publishEvidenceBytes,
  readEvidence,
} from './evidence.js';
import { readAuthorizedFile } from './file-reader.js';
import { controlRoutes } from './control-routes.js';
import type { OptimizerStudyCoordinator } from './optimizer-study.js';
import { developmentStudy } from './optimizer-study-contracts.js';

export const StudySearchRequest = z.strictObject({ jobID: Digest });
// A search reference delegates to the same experiment-level capability as its own optimizer.
// Library assets are intentionally excluded; these routes address observed development evidence.
export const StudyEvidenceReference = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('method'),
    id: Digest,
    area: z.enum(['source', 'artifact', 'build', 'qa', 'behavior-qa']),
    file: RelativePath.optional(),
  }),
  z.strictObject({
    kind: z.literal('optimizer'),
    jobID: Digest,
    episode: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    file: RelativePath.optional(),
  }),
  z.strictObject({
    kind: z.literal('search'),
    jobID: Digest,
    reference: z.discriminatedUnion('kind', [
      TaskEvidenceReference,
      RunEvidenceReference,
      CandidateEvidenceReference,
      ProbeEvidenceReference,
    ]),
  }),
]);

async function assertDevelopment(coordinator: OptimizerStudyCoordinator): Promise<void> {
  if (coordinator.store.state().phase !== 'developing') throw Error('Development evidence access is closed');
  try {
    await access(path.join(coordinator.root, 'development-conclusion.json'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    if (coordinator.store.state().phase !== 'developing')
      throw Error('Development evidence access is closed');
    return;
  }
  throw Error('Development evidence access is closed: development concluded');
}

/** Only the registered development search contract is reconstructed; assessment files are never opened. */
function openSearch(coordinator: OptimizerStudyCoordinator, jobID: string): Controller {
  const job = coordinator.store.job(Digest.parse(jobID));
  if (job.stage !== 'development') throw Error('Validation job evidence is sealed');
  const item = developmentStudy(coordinator.spec).developmentCases.find((item) => item.id === job.caseId);
  if (!item) throw Error('Unknown development case');
  const method = coordinator.store.methods().find((entry) => entry.methodIdentity === job.method)?.method;
  if (!method) throw Error('Unknown frozen optimizer method');
  const spec = Experiment.parse({
    ...item.search.specification,
    optimizerHarness: {
      kind: 'artifact',
      source: { directory: '.optimizer-study/source', digest: method.source.digest },
      artifact: { directory: '.optimizer-study/artifact', identity: method.artifact.identity },
      composition: method.composition,
    },
  });
  if (job.childSpecDigest !== digest(spec))
    throw Error('Development search specification is not prepared or changed');
  const root = confined(coordinator.root, job.childRoot);
  const store = new Store(path.join(root, 'experiment.sqlite'), spec, 'read');
  return new Controller(root, path.join(root, 'dataset'), spec, store, coordinator.docker);
}

const EpisodeIntent = z.strictObject({
  identity: Digest,
  name: z.string().min(1),
  ordinal: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  seconds: z.number().positive().finite(),
});

async function presentDirectory(file: string): Promise<boolean> {
  try {
    const info = await lstat(file);
    if (!info.isDirectory() || info.isSymbolicLink())
      throw Error('Optimizer evidence requires a real directory');
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

async function optionalBytes(root: string, file: string): Promise<Buffer | undefined> {
  try {
    return await readAuthorizedFile(root, file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

/** Bind the original launch identity to its registered method, child contract and committed transport. */
async function optimizerIdentity(child: Controller): Promise<string> {
  const prepared = PreparedOptimizer.parse(
    JSON.parse((await readAuthorizedFile(child.root, 'optimizer-harness/prepared.json')).toString('utf8')),
  );
  const method = child.spec.optimizerHarness;
  if (
    method.kind !== 'artifact' ||
    prepared.sourceDigest !== method.source.digest ||
    prepared.composition !== method.composition ||
    digest(prepared.build) !== digest(method.artifact.identity)
  )
    throw Error('Optimizer episode method differs from registered development method');
  const db = new DatabaseSync(path.join(child.root, 'control-transport.sqlite'), {
    readOnly: true,
    timeout: 5000,
  });
  try {
    const saved = db.prepare('SELECT identity,record FROM transport WHERE id=1').get() as
      { identity: string; record: string } | undefined;
    if (!saved) throw Error('Optimizer episode has no committed controller transport');
    const record: unknown = JSON.parse(saved.record);
    if (digest(record) !== saved.identity) throw Error('Optimizer controller transport identity changed');
    const { endpoint } = z.looseObject({ endpoint: z.string().min(1) }).parse(record);
    controlRoutes(endpoint, 1);
    return digest({ root: path.resolve(child.root), spec: child.spec, endpoint, optimizer: prepared });
  } finally {
    db.close();
  }
}

/** Directory enumeration discovers candidates only; persisted, identity-checked intents grant access. */
async function optimizerEpisodes(child: Controller, requested?: number) {
  const directory = path.join(child.root, 'optimizer');
  if (!(await presentDirectory(directory))) {
    if (requested !== undefined) throw Error('Unknown registered optimizer episode');
    return [];
  }
  const ordinals =
    requested === undefined
      ? (await readdir(directory))
          .filter((name) => /^(0|[1-9]\d*)$/.test(name))
          .map(Number)
          .filter(Number.isSafeInteger)
          .sort((a, b) => a - b)
      : [requested];
  let identity: string | undefined;
  const episodes = [];
  for (const ordinal of ordinals) {
    const relative = `optimizer/${ordinal}`;
    const raw = await optionalBytes(child.root, `${relative}/intent.json`);
    if (!raw) {
      if (requested !== undefined) throw Error('Unknown registered optimizer episode');
      continue;
    }
    const intent = EpisodeIntent.parse(JSON.parse(raw.toString('utf8')));
    identity ??= await optimizerIdentity(child);
    if (
      intent.identity !== identity ||
      intent.ordinal !== ordinal ||
      intent.name !== `he-opt-${identity.slice(0, 32)}-${ordinal}` ||
      intent.seconds > child.spec.budget.optimizerSeconds
    )
      throw Error('Optimizer episode launch identity differs from registered development search');
    const traceAvailable = await presentDirectory(path.join(child.root, relative, 'trace'));
    episodes.push({
      episode: ordinal,
      identity: intent.identity,
      seconds: intent.seconds,
      traceAvailable,
      receiptAvailable:
        traceAvailable && (await optionalBytes(child.root, `${relative}/trace/receipt.json`)) !== undefined,
      metricsAvailable:
        traceAvailable && (await optionalBytes(child.root, `${relative}/trace/metrics.json`)) !== undefined,
    });
  }
  return episodes;
}

/** Public child ledger, never the study's private assessment result or grading locations. */
export async function readStudySearch(coordinator: OptimizerStudyCoordinator, jobID: string) {
  await assertDevelopment(coordinator);
  const child = openSearch(coordinator, jobID);
  try {
    const result = {
      jobID,
      experimentId: child.store.getMeta('experimentId'),
      objective: child.spec.objective,
      optimizerEpisodes: await optimizerEpisodes(child),
      tasks: child.spec.tasks.map(({ id, prompt, inputDigest }) => ({ id, prompt, inputDigest })),
      candidates: child.store.candidates().map(({ digest, proposal, phase, ordinal, build, mean }) => ({
        digest,
        proposal,
        phase,
        ordinal,
        build,
        mean,
      })),
      runs: child.store
        .runs()
        .map(
          ({
            id,
            candidate,
            task,
            repetition,
            attempt,
            phase,
            startedAt,
            completedAt,
            grade,
            deliveryDigest,
          }) => ({
            id,
            candidate,
            task,
            repetition,
            attempt,
            phase,
            startedAt,
            completedAt,
            grade,
            deliveryDigest,
          }),
        ),
      probes: child.store
        .probes()
        .map(
          ({
            id,
            request,
            sourceDigest,
            suiteDigest,
            phase,
            queuedAt,
            completedAt,
            build,
            exitCode,
            executionMilliseconds,
          }) => ({
            id,
            request,
            sourceDigest,
            suiteDigest,
            phase,
            queuedAt,
            completedAt,
            build,
            exitCode,
            executionMilliseconds,
          }),
        ),
    };
    await assertDevelopment(coordinator);
    return result;
  } finally {
    child.store.close();
  }
}

/** Method IDs are registered candidate identities, not caller-supplied filesystem locations. */
async function methodEvidence(
  coordinator: OptimizerStudyCoordinator,
  reference: Extract<z.infer<typeof StudyEvidenceReference>, { kind: 'method' }>,
): Promise<unknown> {
  const candidate = coordinator.store.method(reference.id);
  let root: string;
  if (reference.area === 'source') {
    root = confined(
      candidate.ordinal === 0 ? coordinator.inputs : coordinator.root,
      candidate.source.directory,
    );
  } else if (reference.area === 'artifact') {
    if (!candidate.method) throw Error('Method artifact is not prepared');
    root = confined(
      candidate.ordinal === 0 ? coordinator.inputs : coordinator.root,
      candidate.method.artifact.directory,
    );
  } else {
    // G0 arrives as a frozen artifact. No build/QA records are invented for that imported artifact.
    if (candidate.ordinal === 0)
      throw Error('Imported baseline has no study-local method build or QA evidence');
    const home = path.join(coordinator.root, 'methods', candidate.id);
    root =
      reference.area === 'build'
        ? path.join(home, 'optimizer-harness/builds', candidate.source.digest, 'logs')
        : path.join(home, reference.area === 'qa' ? 'optimizer-harness/qa' : 'method-qa');
  }
  if (reference.file === undefined) return await inventory(root);
  return {
    file: reference.file,
    encoding: 'base64',
    data: (await readAuthorizedFile(root, reference.file)).toString('base64'),
  };
}

export async function readStudyEvidence(
  coordinator: OptimizerStudyCoordinator,
  raw: unknown,
): Promise<unknown> {
  await assertDevelopment(coordinator);
  const reference = StudyEvidenceReference.parse(raw);
  let result: unknown;
  if (reference.kind === 'method') result = await methodEvidence(coordinator, reference);
  else {
    const child = openSearch(coordinator, reference.jobID);
    try {
      if (reference.kind === 'optimizer') {
        const [episode] = await optimizerEpisodes(child, reference.episode);
        if (!episode?.traceAvailable) throw Error('Registered optimizer episode trace is not available');
        const relative = `optimizer/${reference.episode}/trace`;
        result =
          reference.file === undefined
            ? await inventory(path.join(child.root, relative))
            : {
                file: reference.file,
                encoding: 'base64',
                data: (await readAuthorizedFile(child.root, `${relative}/${reference.file}`)).toString(
                  'base64',
                ),
              };
      } else result = await readEvidence(child, reference.reference);
    } finally {
      child.store.close();
    }
  }
  await assertDevelopment(coordinator);
  return result;
}

/** Exact bytes cross into the meta optimizer's read-only evidence mount; no model transcription. */
export async function materializeStudyEvidence(coordinator: OptimizerStudyCoordinator, raw: unknown) {
  const reference = StudyEvidenceReference.parse(raw);
  const file = reference.kind === 'search' ? reference.reference.file : reference.file;
  if (!file) throw Error('Materialization requires an explicit file');
  const artifact = z
    .looseObject({ encoding: z.literal('base64'), data: z.string() })
    .parse(await readStudyEvidence(coordinator, reference));
  await assertDevelopment(coordinator);
  const result = await publishEvidenceBytes(coordinator.root, file, Buffer.from(artifact.data, 'base64'), {
    studyId: coordinator.store.cursor().experimentId,
    reference,
  });
  await assertDevelopment(coordinator);
  return result;
}
