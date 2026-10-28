import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { specification } from './fixtures.js';
import { digest } from '../src/artifacts.js';
import {
  FixedOptimizerComparison,
  studyArmIdentity,
  studyMethodIdentity,
  studyJobAllocation,
} from '../src/optimizer-study-contracts.js';
import { OptimizerStudyStore, type StudyJob } from '../src/optimizer-study-store.js';
import {
  assertSeparateOutput,
  deliveryPlan,
  installationConfig,
  installationProgram,
  collectPackages,
  main,
} from '../scripts/verify-study-artifacts.mjs';

function bundle(name: string) {
  return {
    source: { directory: `${name}/source`, digest: digest(name + '-source') },
    artifact: {
      directory: `${name}/artifact`,
      identity: {
        image: specification().runtime.image,
        artifactDigest: digest(name + '-artifact'),
        bundleDigest: digest(name + '-bundle'),
        tarballDigest: digest(name + '-tarball'),
        lockDigest: digest(name + '-lock'),
      },
    },
  };
}
function fixture() {
  const s = specification(),
    method = { ...bundle('G'), composition: 'plugins.yml' };
  const spec = FixedOptimizerComparison.parse({
    kind: 'fixed-comparison',
    name: 'delivery-test',
    objective: 'Compare independently frozen methods',
    baseline: 'full',
    arms: ['full', 'mechanical'].map((feedback) => ({
      id: feedback,
      method,
      hostSearchProtocol: { ancestry: 'seed-only', feedback },
    })),
    cases: [
      {
        id: 'case',
        seed: bundle('H0'),
        search: { specification: s, dataset: { directory: 'data/search', digest: digest('search') } },
        assessment: {
          specification: { ...s, purpose: 'validation', budget: { candidates: 1, optimizerSeconds: 1 } },
          dataset: { directory: 'data/assessment', digest: digest('assessment') },
        },
      },
    ],
    repetitions: 2,
    budget: { concurrentSearches: 2 },
  });
  const jobs: StudyJob[] = spec.arms.flatMap((arm) =>
    Array.from({ length: spec.repetitions }, (_, repetition) => {
      const key = {
        stage: 'validation' as const,
        method: studyMethodIdentity(arm.method),
        comparisonArm: studyArmIdentity(arm),
        caseId: 'case',
        repetition,
      };
      const id = digest({ registration: digest(spec), ...key });
      return {
        ...key,
        id,
        phase: 'complete' as const,
        allocation: studyJobAllocation(spec.cases[0]!),
        childRoot: `children/${id}`,
        assessmentRoot: `assessments/${id}`,
        selectedHarness: bundle('H0'),
        result: {
          score: 0,
          failures: 0,
          constraintsSatisfied: true,
          denominator: spec.cases[0]!.assessment.specification.tasks.length,
          reportDigest: digest(`report-${id}`),
        },
      };
    }),
  );
  return { spec, jobs };
}

test('full denominator and exact identities deduplicate G and repeated H0 selections without dropping origins', () => {
  const { spec, jobs } = fixture();
  const plan = deliveryPlan(spec, { phase: 'complete' }, jobs);
  assert.equal(plan.denominator, 4);
  assert.equal(plan.slots.length, 4);
  assert.equal(plan.packages.length, 2);
  const h = plan.packages.find((item) => item.sourceDigest === spec.cases[0]!.seed.source.digest);
  assert.ok(h);
  assert.equal(h.references.length, 6);
  assert.deepEqual(new Set(h.references.map((ref) => ref.origin)), new Set(['inputs', 'study']));
  assert.equal(h.contexts.length, 1); // Equal registered model/profile/environment, different task datasets.
  assert.equal(h.contexts[0]!.placements.length, 6);
  assert.ok(plan.slots.every((slot) => slot.job?.result?.score === 0)); // No improvement gate.
});

test('different actual runtime contracts remain independent contexts for one exact artifact', () => {
  const { spec, jobs } = fixture();
  spec.cases[0]!.assessment.specification.runtime.profile = 'sdk-minimal';
  const remapped = jobs.map((job) => ({
    ...job,
    id: digest({
      registration: digest(spec),
      stage: job.stage,
      method: job.method,
      comparisonArm: job.comparisonArm,
      caseId: job.caseId,
      repetition: job.repetition,
    }),
  }));
  const plan = deliveryPlan(spec, { phase: 'complete' }, remapped);
  const h = plan.packages.find((item) => item.sourceDigest === spec.cases[0]!.seed.source.digest);
  assert.ok(h);
  assert.equal(h.contexts.length, 2);
  for (const context of h.contexts) {
    const config = installationConfig(h, context, { allowBuilds: {} });
    assert.equal(config.profile, context.runtime.profile);
    assert.deepEqual(config.model, context.model);
    assert.equal(config.environmentPatch, null);
  }
});

test('failed and cancelled unselected slots are explicit; malformed complete and active studies reject', () => {
  const { spec, jobs } = fixture();
  const failed: StudyJob[] = jobs.map(({ selectedHarness, ...job }) => ({
    ...job,
    phase: 'failed',
    error: 'Original failure',
  }));
  const plan = deliveryPlan(spec, { phase: 'complete' }, failed);
  assert.equal(plan.slots.length, 4);
  assert.ok(
    plan.slots.every((slot) => slot.selection === 'not-selected' && slot.job?.error === 'Original failure'),
  );
  assert.equal(plan.packages.length, 2); // G and H0 must still be checked.
  assert.equal(deliveryPlan(spec, { phase: 'cancelled' }, []).slots.length, 4);
  assert.throws(() => deliveryPlan(spec, { phase: 'complete' }, []), /missing a registered job/);
  assert.throws(() => deliveryPlan(spec, { phase: 'validating' }, jobs), /not terminal/);
  assert.throws(
    () => deliveryPlan(spec, { phase: 'complete' }, [{ ...jobs[0]!, phase: 'assessing' }]),
    /active jobs/,
  );
  assert.throws(() => deliveryPlan(spec, { phase: 'complete' }, [...jobs, jobs[0]!]), /Duplicate/);
  assert.throws(
    () =>
      deliveryPlan(
        spec,
        { phase: 'complete' },
        jobs.map((job) => ({ ...job, id: digest('forged') })),
      ),
    /identity/,
  );
});

test('a selected bundle from a terminal failed assessment remains in the delivery plan', () => {
  const { spec, jobs } = fixture();
  jobs[0] = { ...jobs[0]!, phase: 'failed', selectedHarness: bundle('new-H') };
  const plan = deliveryPlan(spec, { phase: 'complete' }, jobs);
  assert.equal(plan.packages.length, 3);
  assert.equal(plan.slots[0]!.selection, 'selected');
  assert.equal(plan.slots[0]!.phase, 'failed');
});

test('package failure preserves its error and still verifies every other registered package', async () => {
  const { spec, jobs } = fixture(),
    plan = deliveryPlan(spec, { phase: 'complete' }, jobs),
    saved: unknown[] = [];
  let calls = 0;
  const results = await collectPackages(
    plan,
    async () => {
      if (++calls === 1) throw Error('Original candidate startup failure');
      return { installed: true };
    },
    async (result) => {
      saved.push(result);
    },
  );
  assert.equal(calls, 2);
  const failed = results[0];
  assert.ok(failed);
  assert.equal(failed.status, 'failed');
  assert.match(failed.error, /Original candidate startup failure/);
  assert.equal(results[1]!.status, 'passed');
  assert.deepEqual(results, saved);
});

test('live authoritative SQLite registration is refused before creating output or reading installer inputs', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'he-artifact-live-'));
  try {
    const study = path.join(root, 'study'),
      output = root + '-output';
    await mkdir(study);
    const { spec } = fixture();
    await writeFile(path.join(study, 'registration.json'), JSON.stringify(spec));
    const store = new OptimizerStudyStore(path.join(study, 'study.sqlite'), spec);
    store.close();
    await assert.rejects(
      main([
        '--evidence-root',
        root,
        '--output',
        output,
        '--framework-tarball',
        '/nonexistent/archive',
        '--install-policy',
        '/nonexistent/policy',
      ]),
      /not terminal/,
    );
    await assert.rejects(readdir(output), { code: 'ENOENT' });
    const readonly = new OptimizerStudyStore(path.join(study, 'study.sqlite'), spec, 'read');
    assert.equal(readonly.state().phase, 'validating');
    assert.equal(readonly.jobs().length, 0);
    readonly.close();
  } finally {
    await rm(root, { recursive: true });
  }
});

test('direct or symlink output descendants are refused without touching evidence', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'he-artifact-path-'));
  try {
    const evidence = path.join(root, 'evidence'),
      alias = path.join(root, 'alias');
    await mkdir(evidence);
    await symlink(evidence, alias);
    for (const base of [evidence, alias])
      await assert.rejects(
        assertSeparateOutput(evidence, path.join(base, 'new', 'output')),
        /outside original/,
      );
    assert.deepEqual(await readdir(evidence), []);
  } finally {
    await rm(root, { recursive: true });
  }
});

test('terminal all-failed ledger produces a new failed receipt with every slot and checks G and H0 independently', async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'he-artifact-terminal-'));
  try {
    const root = path.join(home, 'original'),
      study = path.join(root, 'study'),
      output = path.join(home, 'verification');
    await mkdir(study, { recursive: true });
    const { spec } = fixture();
    await writeFile(path.join(study, 'registration.json'), JSON.stringify(spec));
    await writeFile(path.join(study, 'inputs-digest.json'), JSON.stringify(digest('original-inputs')));
    const db = new OptimizerStudyStore(path.join(study, 'study.sqlite'), spec);
    db.acquire('test', Date.now(), 60_000);
    for (const arm of spec.arms)
      for (let repetition = 0; repetition < spec.repetitions; repetition++) {
        const job = db.reserveJob('test', {
          stage: 'validation',
          method: studyMethodIdentity(arm.method),
          comparisonArm: studyArmIdentity(arm),
          caseId: 'case',
          repetition,
        });
        db.failJob('test', job.id, 'Original search failed; preserved');
      }
    db.finish('test', 'All registered jobs terminal, including failures');
    db.release('test');
    db.close();
    const before = await readFile(path.join(study, 'study.sqlite'));
    const archive = path.join(home, 'support.tgz'),
      policy = path.join(home, 'policy.json');
    await writeFile(archive, 'Explicit support fixture; references fail before any Docker installation');
    await writeFile(policy, JSON.stringify({ allowBuilds: {} }));
    const result = await main([
      '--evidence-root',
      root,
      '--output',
      output,
      '--framework-tarball',
      archive,
      '--install-policy',
      policy,
    ]);
    assert.equal(result.passed, false);
    assert.equal(result.plan.slots.length, 4);
    assert.ok(
      result.plan.slots.every((slot) => slot.phase === 'failed' && slot.selection === 'not-selected'),
    );
    assert.ok(result.installations);
    assert.equal(result.installations.length, 2);
    assert.ok(result.installations.every((item) => item.status === 'failed'));
    assert.deepEqual(await readFile(path.join(study, 'study.sqlite')), before);
    assert.equal(JSON.parse(await readFile(path.join(output, 'acceptance.json'), 'utf8')).passed, false);
    await assert.rejects(
      main([
        '--evidence-root',
        root,
        '--output',
        output,
        '--framework-tarball',
        archive,
        '--install-policy',
        policy,
      ]),
      { code: 'EEXIST' },
    );
  } finally {
    await rm(home, { recursive: true });
  }
});

test('generated native installer parses and contains no model-turn or rebuild commands', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'he-artifact-script-'));
  try {
    const file = path.join(root, 'install.mjs');
    await writeFile(file, installationProgram);
    execFileSync(process.execPath, ['--check', file]);
    const body = await readFile(file, 'utf8');
    assert.ok(body.includes('config.model.credentialEnv'));
    assert.ok(body.includes('config.environmentPatch'));
    assert.ok(body.includes('config.profile'));
    assert.doesNotMatch(body, /session\(\)\.prompt|study-run|npm.*pack|buildBundle/);
  } finally {
    await rm(root, { recursive: true });
  }
});

test('invalid installation deadlines reject before evidence access or output creation', async () => {
  for (const timeout of ['0', '-1', 'NaN', 'Infinity', '0.5', '2147484']) {
    await assert.rejects(
      main([
        '--evidence-root',
        '/nonexistent/study',
        '--output',
        '/nonexistent/output',
        '--framework-tarball',
        '/nonexistent/archive',
        '--install-policy',
        '/nonexistent/policy',
        `--timeout-seconds=${timeout}`,
      ]),
      /positive integer within the Node timer range/,
    );
  }
});
