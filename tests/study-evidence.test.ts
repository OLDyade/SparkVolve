import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { digest } from '../src/artifacts.js';
import { Experiment } from '../src/contracts.js';
import {
  OptimizerStudy,
  studyMethodIdentity,
  type FrozenStudyMethodRef,
} from '../src/optimizer-study-contracts.js';
import { OptimizerStudyStore } from '../src/optimizer-study-store.js';
import { OptimizerStudyCoordinator } from '../src/optimizer-study.js';
import { Store } from '../src/store.js';
import { readStudyEvidence, materializeStudyEvidence, readStudySearch } from '../src/study-evidence.js';
import { specification, candidate, runs } from './fixtures.js';

const owner = 'evidence-fixture';
function method(name: string): FrozenStudyMethodRef {
  return {
    source: { directory: `sources/${name}`, digest: digest(`${name}-source`) },
    artifact: {
      directory: `bundles/${name}`,
      identity: {
        artifactDigest: digest(`${name}-artifact`),
        bundleDigest: digest(`${name}-bundle`),
        tarballDigest: digest(`${name}-tarball`),
        lockDigest: digest(`${name}-lock`),
        image: specification().runtime.image,
      },
    },
    composition: 'plugins.yml',
  };
}
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'he-study-evidence-'));
  const base = specification();
  base.probes = { limit: 2, timeoutSeconds: 10 };
  const seed = method('h0');
  const searchCase = (id: string) => ({
    id,
    seed: { source: seed.source, artifact: seed.artifact },
    search: { specification: base, dataset: { directory: `${id}/search`, digest: digest(`${id}-search`) } },
    assessment: {
      specification: {
        ...base,
        purpose: 'validation',
        budget: { ...base.budget, candidates: 1 },
        probes: null,
      },
      dataset: { directory: `${id}/private-assessment`, digest: digest(`${id}-private`) },
    },
  });
  const cases = [searchCase('development'), searchCase('sealed')];
  const spec = OptimizerStudy.parse({
    name: 'study-evidence',
    objective: 'Read actual public child evidence',
    baseline: method('g0'),
    metaOptimizer: method('meta'),
    metaRuntime: { runtime: base.runtime, model: base.optimizer, isolation: base.isolation, egress: [] },
    methodBuild: base.candidate.build,
    methodQA: null,
    developmentCases: [cases[0]],
    validationCases: [cases[1]],
    repetitions: 1,
    budget: { methodCandidates: 3, metaOptimizerSeconds: 60, concurrentSearches: 1 },
    selection: { failureLimit: 0 },
  });
  const ledger = new OptimizerStudyStore(path.join(root, 'study.sqlite'), spec);
  ledger.acquire(owner, Date.now(), 60_000);
  const coordinator = new OptimizerStudyCoordinator(root, ledger);
  const job = ledger.reserveJob(owner, {
    stage: 'development',
    method: studyMethodIdentity(spec.baseline),
    caseId: 'development',
    repetition: 0,
  });
  const childSpec = Experiment.parse({
    ...base,
    optimizerHarness: {
      kind: 'artifact',
      source: { directory: '.optimizer-study/source', digest: spec.baseline.source.digest },
      artifact: { directory: '.optimizer-study/artifact', identity: spec.baseline.artifact.identity },
      composition: spec.baseline.composition,
    },
  });
  ledger.startJob(owner, job.id, digest(childSpec));
  const childRoot = path.join(root, job.childRoot);
  await mkdir(childRoot, { recursive: true });
  const child = new Store(path.join(childRoot, 'experiment.sqlite'), childSpec);
  const c = candidate(),
    run = {
      ...runs()[0]!,
      id: digest('run'),
      gradeContainer: '/private-grade-container',
      error: '/private-grade-error',
    };
  child.addCandidate(c);
  child.addRuns([run]);
  const probe = digest('probe');
  child.addProbe({
    id: probe,
    sourceDigest: c.digest,
    suiteDigest: digest('suite'),
    phase: 'queued',
    queuedAt: new Date().toISOString(),
    request: { draft: 'draft', suite: 'suite', entry: 'check.mjs', hypothesis: 'Observe tool semantics' },
  });
  const g1 = method('g1');
  const reserved = ledger.reserveMethod(owner, {
    source: g1.source,
    composition: g1.composition,
    proposal: {
      draft: 'g1',
      parents: [spec.baseline.source.digest],
      actions: ['author'],
      evidence: ['child trace'],
      hypothesis: 'Expose evidence',
      expectedChange: 'Use actual delivery',
    },
  });
  ledger.publishMethod(owner, reserved.id, g1);
  const bytes = Buffer.from(Array.from({ length: 6643 }, (_, i) => i % 256));
  const file = 'nested/data.bin';
  const put = async (base: string, value: Buffer | string = bytes) => {
    await mkdir(path.join(base, 'nested'), { recursive: true });
    await writeFile(path.join(base, file), value);
  };
  const references: Array<{ reference: unknown; directory: string }> = [
    ...['source', 'artifact'].map((area) => ({
      reference: { kind: 'method', id: ledger.methods()[0]!.id, area, file },
      directory: path.join(
        root,
        'inputs',
        area === 'source' ? spec.baseline.source.directory : spec.baseline.artifact.directory,
      ),
    })),
    ...Object.entries({
      source: g1.source.directory,
      artifact: g1.artifact.directory,
      build: `methods/${reserved.id}/optimizer-harness/builds/${g1.source.digest}/logs`,
      qa: `methods/${reserved.id}/optimizer-harness/qa`,
      'behavior-qa': `methods/${reserved.id}/method-qa`,
    }).map(([area, directory]) => ({
      reference: { kind: 'method', id: reserved.id, area, file },
      directory: path.join(root, directory),
    })),
    ...['input', 'delivery', 'trace'].map((area) => ({
      reference: { kind: 'search', jobID: job.id, reference: { kind: 'run', id: run.id, area, file } },
      directory:
        area === 'input'
          ? path.join(childRoot, 'dataset', base.tasks[0]!.input)
          : path.join(childRoot, 'runs', run.id, area),
    })),
    ...Object.entries({ source: 'candidates', build: 'builds', artifact: 'artifacts', qa: 'qa' }).map(
      ([area, directory]) => ({
        reference: {
          kind: 'search',
          jobID: job.id,
          reference: { kind: 'candidate', id: c.digest, area, file },
        },
        directory: path.join(childRoot, directory, c.digest, ...(area === 'build' ? ['logs'] : [])),
      }),
    ),
    ...Object.entries({
      source: `candidates/${c.digest}`,
      suite: 'suite',
      build: `builds/${c.digest}/logs`,
      artifact: `artifacts/${c.digest}`,
      logs: 'logs',
      observations: 'work',
    }).map(([area, directory]) => ({
      reference: { kind: 'search', jobID: job.id, reference: { kind: 'probe', id: probe, area, file } },
      directory: path.join(childRoot, 'probes', probe, directory),
    })),
  ];
  for (const entry of references) await put(entry.directory);
  const validationID = digest('validation-job');
  ledger.db
    .prepare('INSERT INTO jobs VALUES (?,?)')
    .run(validationID, JSON.stringify({ ...job, id: validationID, stage: 'validation', caseId: 'sealed' }));
  return {
    root,
    ledger,
    coordinator,
    child,
    childRoot,
    job,
    references,
    bytes,
    file,
    validationID,
    cleanup: async () => {
      child.close();
      ledger.close();
      await rm(root, { recursive: true, force: true });
    },
  };
}

test('study evidence exposes actual development inputs, deliveries, traces, probes and registered method files', async () => {
  const f = await fixture();
  try {
    const summary = await readStudySearch(f.coordinator, f.job.id);
    assert.equal(summary.runs.length, 1);
    assert.equal(summary.probes.length, 1);
    assert.equal(summary.candidates.length, 1);
    assert.equal(summary.tasks[0]!.prompt, specification().tasks[0]!.prompt);
    const serialized = JSON.stringify(summary);
    for (const restricted of [
      'assessment',
      'evaluation',
      'private-grade',
      'gradeContainer',
      'childRoot',
      'sealed',
    ])
      assert.ok(!serialized.includes(restricted), restricted);
    const sha256 = createHash('sha256').update(f.bytes).digest('hex');
    const hostPath = (virtual: string) =>
      path.join(f.root, 'materialized', virtual.slice('/evidence/'.length));
    for (const { reference } of f.references) {
      const raw = (await readStudyEvidence(f.coordinator, reference)) as { data: string };
      assert.deepEqual(Buffer.from(raw.data, 'base64'), f.bytes);
      const [snapshot, duplicate] = await Promise.all([
        materializeStudyEvidence(f.coordinator, reference),
        materializeStudyEvidence(f.coordinator, reference),
      ]);
      assert.deepEqual(snapshot, duplicate);
      assert.equal(snapshot.sha256, sha256);
      assert.equal(snapshot.bytes, f.bytes.length);
      assert.deepEqual(await readFile(hostPath(snapshot.path)), f.bytes);
      assert.equal((await stat(hostPath(snapshot.path))).mode & 0o222, 0);
      const provenance = JSON.parse(await readFile(hostPath(snapshot.provenance), 'utf8'));
      assert.deepEqual(provenance.reference, reference);
      assert.equal(provenance.studyId, f.ledger.cursor().experimentId);
      const listing = structuredClone(reference) as {
        kind: string;
        file?: string;
        reference?: { file?: string };
      };
      if (listing.kind === 'method') delete listing.file;
      else delete listing.reference!.file;
      assert.deepEqual(await readStudyEvidence(f.coordinator, listing), [
        { path: f.file, hash: sha256, executable: false },
      ]);
    }
  } finally {
    await f.cleanup();
  }
});

test('study evidence denies sealed jobs, private areas, unknown identities, path escapes and symlinks', async () => {
  const f = await fixture();
  try {
    await assert.rejects(readStudySearch(f.coordinator, f.validationID), /Validation job evidence is sealed/);
    const reference = f.references[7]!.reference as Record<string, unknown>;
    const inner = reference.reference as Record<string, unknown>;
    for (const denied of [
      { ...reference, jobID: f.validationID },
      { ...reference, jobID: digest('unknown') },
      { ...reference, reference: { ...inner, area: 'grade-private' } },
      { ...reference, reference: { ...inner, area: 'evaluation' } },
      { ...reference, reference: { ...inner, id: digest('unknown') } },
      { ...reference, reference: { ...inner, file: '../private.json' } },
      { kind: 'method', id: digest('unknown'), area: 'source', file: 'x' },
      { kind: 'method', id: f.ledger.methods()[0]!.id, area: 'build', file: 'x' },
      { ...reference, reference: { kind: 'asset', id: digest('asset'), area: 'source', file: 'x' } },
    ])
      await assert.rejects(readStudyEvidence(f.coordinator, denied));
    await writeFile(path.join(f.root, 'private.txt'), 'private');
    for (const entry of [f.references[0]!, f.references[7]!]) {
      await symlink(path.join(f.root, 'private.txt'), path.join(entry.directory, 'escape'));
      await symlink(f.root, path.join(entry.directory, 'escape-directory'));
      for (const file of ['escape', 'escape-directory/private.txt']) {
        const ref = structuredClone(entry.reference) as {
          kind: string;
          file?: string;
          reference?: { file?: string };
        };
        if (ref.kind === 'method') ref.file = file;
        else ref.reference!.file = file;
        await assert.rejects(readStudyEvidence(f.coordinator, ref), /Authorized evidence reader failed/);
        await assert.rejects(
          materializeStudyEvidence(f.coordinator, ref),
          /Authorized evidence reader failed/,
        );
      }
    }
  } finally {
    await f.cleanup();
  }
});

test('study evidence closes immediately at stage transition and development conclusion, including in-flight reads', async () => {
  const f = await fixture();
  try {
    const reference = f.references[0]!.reference;
    for (const phase of ['validating', 'complete', 'cancelling', 'cancelled']) {
      f.ledger.db.prepare('UPDATE metadata SET value=? WHERE key=?').run(JSON.stringify({ phase }), 'state');
      await assert.rejects(readStudySearch(f.coordinator, f.job.id), /closed/);
      await assert.rejects(readStudyEvidence(f.coordinator, reference), /closed/);
      await assert.rejects(materializeStudyEvidence(f.coordinator, reference), /closed/);
    }
    f.ledger.db
      .prepare('UPDATE metadata SET value=? WHERE key=?')
      .run(JSON.stringify({ phase: 'developing' }), 'state');
    const original = f.ledger.state.bind(f.ledger);
    let calls = 0;
    f.ledger.state = () => (++calls <= 2 ? original() : { phase: 'validating' });
    await assert.rejects(readStudyEvidence(f.coordinator, reference), /closed/);
    f.ledger.state = original;
    await writeFile(path.join(f.root, 'development-conclusion.json'), '{}');
    await assert.rejects(readStudySearch(f.coordinator, f.job.id), /concluded/);
    await assert.rejects(materializeStudyEvidence(f.coordinator, reference), /concluded/);
  } finally {
    await f.cleanup();
  }
});

test('study readers bind the registered child specification and reject substituted evidence roots', async () => {
  const f = await fixture();
  try {
    const entry = f.references[0]!;
    await rm(entry.directory, { recursive: true });
    const outside = path.join(f.root, 'private-root');
    await mkdir(path.join(outside, 'nested'), { recursive: true });
    await writeFile(path.join(outside, f.file), 'not authorized');
    await symlink(outside, entry.directory);
    await assert.rejects(
      readStudyEvidence(f.coordinator, entry.reference),
      /Authorized evidence reader failed/,
    );
    const changed = { ...f.ledger.job(f.job.id), childSpecDigest: digest('different-contract') };
    f.ledger.db.prepare('UPDATE jobs SET body=? WHERE id=?').run(JSON.stringify(changed), f.job.id);
    await assert.rejects(readStudySearch(f.coordinator, f.job.id), /specification.*changed/);
    await assert.rejects(
      readStudyEvidence(f.coordinator, f.references[7]!.reference),
      /specification.*changed/,
    );
  } finally {
    await f.cleanup();
  }
});

test('registered development optimizer episodes expose actual trace bytes and receipt availability without host capabilities', async () => {
  const f = await fixture();
  try {
    const method = f.child.spec.optimizerHarness;
    assert.equal(method.kind, 'artifact');
    if (method.kind !== 'artifact') throw Error('fixture requires frozen method');
    const prepared = {
      sourceDigest: method.source.digest,
      build: method.artifact.identity,
      composition: method.composition,
    };
    await mkdir(path.join(f.childRoot, 'optimizer-harness'), { recursive: true });
    await writeFile(path.join(f.childRoot, 'optimizer-harness/prepared.json'), JSON.stringify(prepared));
    const transport = {
      request: { host: '127.0.0.1', port: 0, endpoint: 'http://127.0.0.1:0' },
      bound: { address: '127.0.0.1', family: 'IPv4', port: 9876 },
      endpoint: 'http://127.0.0.1:9876',
      controlEndpoint: 'http://127.0.0.1:9876',
    };
    const db = new DatabaseSync(path.join(f.childRoot, 'control-transport.sqlite'));
    db.exec('CREATE TABLE transport (id INTEGER PRIMARY KEY, identity TEXT, record TEXT)');
    db.prepare('INSERT INTO transport VALUES (1,?,?)').run(digest(transport), JSON.stringify(transport));
    db.close();
    const identity = digest({
      root: path.resolve(f.childRoot),
      spec: f.child.spec,
      endpoint: transport.endpoint,
      optimizer: prepared,
    });
    const episodeRoot = path.join(f.childRoot, 'optimizer/0');
    await mkdir(path.join(episodeRoot, 'trace'), { recursive: true });
    const intent = {
      ordinal: 0,
      identity,
      name: `he-opt-${identity.slice(0, 32)}-0`,
      seconds: f.child.spec.budget.optimizerSeconds,
    };
    await writeFile(path.join(episodeRoot, 'intent.json'), JSON.stringify(intent));
    await writeFile(path.join(episodeRoot, 'trace/requests.jsonl'), f.bytes);
    const reference = { kind: 'optimizer', jobID: f.job.id, episode: 0, file: 'requests.jsonl' };
    const pending = await readStudySearch(f.coordinator, f.job.id);
    assert.deepEqual(pending.optimizerEpisodes, [
      {
        episode: 0,
        identity,
        seconds: intent.seconds,
        traceAvailable: true,
        receiptAvailable: false,
        metricsAvailable: false,
      },
    ]);
    assert.ok(!JSON.stringify(pending).includes(transport.endpoint));
    await writeFile(
      path.join(episodeRoot, 'trace/receipt.json'),
      JSON.stringify({ status: 'completed', elapsed: 12 }),
    );
    await writeFile(path.join(episodeRoot, 'trace/metrics.json'), JSON.stringify({ requests: 2 }));
    const complete = await readStudySearch(f.coordinator, f.job.id);
    assert.equal(complete.optimizerEpisodes[0]!.receiptAvailable, true);
    assert.equal(complete.optimizerEpisodes[0]!.metricsAvailable, true);
    for (const file of ['requests.jsonl', 'receipt.json', 'metrics.json']) {
      const bytes = await readFile(path.join(episodeRoot, 'trace', file));
      const read = (await readStudyEvidence(f.coordinator, { ...reference, file })) as { data: string };
      assert.deepEqual(Buffer.from(read.data, 'base64'), bytes);
      const snapshot = await materializeStudyEvidence(f.coordinator, { ...reference, file });
      assert.equal(snapshot.sha256, createHash('sha256').update(bytes).digest('hex'));
      assert.deepEqual(
        await readFile(path.join(f.root, 'materialized', snapshot.path.slice('/evidence/'.length))),
        bytes,
      );
    }
    await mkdir(path.join(f.childRoot, 'optimizer/1/trace'), { recursive: true });
    await writeFile(path.join(f.childRoot, 'optimizer/1/trace/receipt.json'), '{}');
    assert.equal((await readStudySearch(f.coordinator, f.job.id)).optimizerEpisodes.length, 1);
    await assert.rejects(
      readStudyEvidence(f.coordinator, { ...reference, episode: 1 }),
      /Unknown registered optimizer episode/,
    );
    await assert.rejects(
      readStudyEvidence(f.coordinator, { ...reference, jobID: f.validationID }),
      /Validation job evidence is sealed/,
    );
    for (const file of [
      '../intent.json',
      '../../controller-token',
      '../../../controller-token',
      '/controller-token',
    ])
      await assert.rejects(readStudyEvidence(f.coordinator, { ...reference, file }));
    await writeFile(path.join(f.childRoot, 'controller-token'), 'do-not-expose');
    await symlink(path.join(f.childRoot, 'controller-token'), path.join(episodeRoot, 'trace/token-link'));
    await assert.rejects(
      materializeStudyEvidence(f.coordinator, { ...reference, file: 'token-link' }),
      /Authorized evidence reader failed/,
    );
    await writeFile(
      path.join(episodeRoot, 'intent.json'),
      JSON.stringify({ ...intent, identity: digest('forged') }),
    );
    await assert.rejects(readStudyEvidence(f.coordinator, reference), /launch identity differs/);
    await writeFile(path.join(episodeRoot, 'intent.json'), JSON.stringify(intent));
    await writeFile(
      path.join(f.childRoot, 'optimizer-harness/prepared.json'),
      JSON.stringify({ ...prepared, sourceDigest: digest('other-method') }),
    );
    await assert.rejects(readStudyEvidence(f.coordinator, reference), /method differs from registered/);
    await writeFile(path.join(f.childRoot, 'optimizer-harness/prepared.json'), JSON.stringify(prepared));
    const changedTransport = new DatabaseSync(path.join(f.childRoot, 'control-transport.sqlite'));
    changedTransport.prepare('UPDATE transport SET identity=? WHERE id=1').run(digest('changed-record'));
    changedTransport.close();
    await assert.rejects(readStudyEvidence(f.coordinator, reference), /transport identity changed/);
    f.ledger.db
      .prepare('UPDATE metadata SET value=? WHERE key=?')
      .run(JSON.stringify({ phase: 'validating' }), 'state');
    await assert.rejects(readStudyEvidence(f.coordinator, reference), /closed/);
    await assert.rejects(materializeStudyEvidence(f.coordinator, reference), /closed/);
  } finally {
    await f.cleanup();
  }
});
