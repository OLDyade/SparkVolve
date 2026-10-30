import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { specification, hash } from './fixtures.ts';
import {
  comparisonRegistration,
  mutationRegistration,
  prepareMutationSeed,
  validateStudyShape,
  runLogged,
  snapshotReports,
  validationComparison,
  assertBaselineComplete,
  deliverSelections,
  main,
} from '../scripts/verify-feedback-study.mjs';
import { studyArmIdentity } from '../dist/optimizer-study-contracts.js';

test('delivery preserves every study selection and never retries failed installation', async () => {
  const calls = [];
  const jobs = ['ok', 'broken', 'missing'].map((id) => ({
    id,
    phase: id === 'missing' ? 'failed' : 'complete',
    selectedHarness: id === 'missing' ? null : { source: { digest: id } },
  }));
  const result = await deliverSelections({ jobs }, async (job) => {
    calls.push(job.id);
    if (job.id === 'broken') throw Error('install failed');
    return { passed: true };
  });
  assert.deepEqual(calls, ['ok', 'broken']);
  assert.deepEqual(
    result.rows.map((row) => row.status),
    ['complete', 'failed', 'unavailable'],
  );
  assert.equal(result.passed, false);
});

function contracts() {
  const method = {
    source: { directory: 'bundles/g/source', digest: hash },
    artifact: {
      directory: 'bundles/g/artifact',
      identity: {
        image: `sha256:${hash}`,
        artifactDigest: hash,
        bundleDigest: hash,
        lockDigest: hash,
        tarballDigest: hash,
      },
    },
    composition: 'plugins.yml',
  };
  const seed = {
    source: { directory: 'bundles/h/source', digest: 'b'.repeat(64) },
    artifact: { directory: 'bundles/h/artifact', identity: method.artifact.identity },
  };
  const base = specification();
  base.tasks = ['one', 'two', 'three', 'four'].map((id) => ({
    ...base.tasks[0],
    id,
    input: `inputs/${id}`,
    evaluation: `private/${id}`,
  }));
  base.hostSearchProtocol = { ancestry: 'seed-only', feedback: 'full' };
  base.budget = { candidates: 3, optimizerSeconds: 1200 };
  const search = { specification: base, dataset: { directory: 'cases/development', digest: hash } };
  const assessment = {
    specification: { ...base, purpose: 'validation', budget: { candidates: 1, optimizerSeconds: 1 } },
    dataset: { directory: 'cases/validation', digest: hash },
  };
  const spec = comparisonRegistration(method, seed, search, assessment);
  const baseline = { ...assessment.specification, name: 'spreadsheet-h0-validation', repetitions: 2 };
  return { spec, baseline };
}

test('feedback registration shares G/H0 and admits exactly 72 task executions, with no search side channels', () => {
  const { spec, baseline } = contracts();
  const allocation = validateStudyShape(spec, baseline);
  assert.equal(allocation.totalTaskExecutions, 72);
  assert.equal(allocation.study.candidates, 12);
  assert.equal(allocation.study.optimizerSeconds, 4800);
  assert.equal(allocation.study.probes, 0);
  assert.notEqual(studyArmIdentity(spec.arms[0]), studyArmIdentity(spec.arms[1]));
  assert.throws(() => validateStudyShape(spec, { ...baseline, repetitions: 1 }));
  assert.throws(() => validateStudyShape({ ...spec, repetitions: 3 }, baseline));
  const unsafe = structuredClone(spec);
  unsafe.cases[0].search.specification.probes = { limit: 1, timeoutSeconds: 10 };
  assert.throws(() => validateStudyShape(unsafe, baseline), /Seed-only/);
});

test('mutation comparison isolates editable source scope with identical G/H0 and 104-task ceiling', () => {
  const { spec: feedback, baseline } = contracts();
  const { seed, search, assessment } = feedback.cases[0];
  const spec = mutationRegistration(feedback.arms[0].method, seed, search, assessment);
  assert.equal(validateStudyShape(spec, baseline, 'mutation-space').totalTaskExecutions, 104);
  assert.equal(new Set(spec.arms.map(studyArmIdentity)).size, 3);
  const altered = structuredClone(spec);
  altered.arms[0].hostSearchProtocol.editableFiles.push('index.mjs');
  assert.throws(() => validateStudyShape(altered, baseline, 'mutation-space'));
});

test('all mutation arms start with the same native prompt section and packaged guidance', async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), 'mutation-seed-'));
  const target = path.join(parent, 'seed');
  await prepareMutationSeed(new URL('../tests/fixtures/spreadsheet/seed', import.meta.url), target);
  const source = await readFile(path.join(target, 'index.mjs'), 'utf8');
  assert.match(source, /systemPrompt.section/);
  assert.match(source, /guidance.md/);
  assert.ok(
    JSON.parse(await readFile(path.join(target, 'package.json'), 'utf8')).files.includes('guidance.md'),
  );
  assert.equal(
    await readFile(path.join(target, 'workbook.py'), 'utf8'),
    await readFile(new URL('../tests/fixtures/spreadsheet/seed/workbook.py', import.meta.url), 'utf8'),
  );
});

test('command logs preserve failed output and never overwrite authoritative reports or rerun labels', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'feedback-driver-log-'));
  const report = '{"state":{"phase":"complete"}}\n';
  await writeFile(path.join(root, 'study-report.json'), report);
  await assert.rejects(
    runLogged(
      root,
      'study-report',
      process.execPath,
      ['-e', 'console.log("private-token"); process.stderr.write("failed"); process.exit(7)'],
      { secrets: ['private-token'] },
    ),
    /no retry/,
  );
  const logged = JSON.parse(await readFile(path.join(root, 'command-logs/study-report.json'), 'utf8'));
  assert.equal(logged.code, 7);
  assert.equal(logged.stdout, '[REDACTED]\n');
  assert.equal(logged.stderr, 'failed');
  assert.ok(!JSON.stringify(logged).includes('private-token'));
  assert.equal(await readFile(path.join(root, 'study-report.json'), 'utf8'), report);
  await assert.rejects(runLogged(root, 'study-report', '/does-not-exist', []), { code: 'EEXIST' });
  assert.equal(JSON.parse(await readFile(path.join(root, 'command-logs/study-report.json'), 'utf8')).code, 7);
});

test('spawn and cancellation errors retain their causes without launching fallback commands', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'feedback-driver-spawn-'));
  await assert.rejects(runLogged(root, 'missing', '/does-not-exist', []), /no retry/);
  const entry = JSON.parse(await readFile(path.join(root, 'command-logs/missing.json'), 'utf8'));
  assert.match(entry.spawnError, /ENOENT/);
  const aborted = new AbortController();
  aborted.abort(Error('explicit stop'));
  await assert.rejects(
    runLogged(root, 'cancelled', process.execPath, ['-e', 'throw Error("must not run")'], {
      signal: aborted.signal,
    }),
    /explicit stop/,
  );
  assert.deepEqual(await readdir(path.join(root, 'command-logs')), ['missing.json']);
});

test('read-only accounting before registration creates no invented zero-cost report', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'feedback-driver-empty-'));
  assert.deepEqual(await snapshotReports(root), {});
  assert.deepEqual(await readdir(root), []);
});

test('validation comparison keeps shared baseline, failure denominators and unobserved slots explicit', () => {
  const { spec } = contracts();
  const baseline = {
    candidates: [
      {
        samples: Array.from({ length: 2 }, (_, repetition) =>
          spec.cases[0].assessment.specification.tasks.map(({ id }) => ({
            id: `${id}-${repetition}`,
            task: id,
            repetition,
            phase: 'scored',
            score: 0.5,
          })),
        ).flat(),
      },
    ],
  };
  const study = {
    jobs: [],
    accounting: { jobs: [] },
    comparison: { arms: spec.arms.map((arm) => ({ id: arm.id, armDigest: studyArmIdentity(arm) })) },
  };
  for (const arm of spec.arms)
    for (let repetition = 0; repetition < 2; repetition++) {
      const id = `${arm.id}-${repetition}`;
      const failed = arm.id === 'mechanical' && repetition === 1;
      study.jobs.push({
        id,
        comparisonArm: studyArmIdentity(arm),
        repetition,
        phase: failed ? 'failed' : 'complete',
      });
      study.accounting.jobs.push({
        id,
        assessment: failed
          ? null
          : {
              candidates: [
                {
                  samples: spec.cases[0].assessment.specification.tasks.map(({ id }) => ({
                    id: `h-${id}`,
                    task: id,
                    repetition: 0,
                    phase: 'scored',
                    score: 0.75,
                  })),
                },
              ],
            },
      });
    }
  const report = validationComparison(study, baseline, spec);
  assert.equal(report.pairs.length, 16);
  assert.equal(report.searches.length, 4);
  assert.deepEqual(
    report.searches.map((search) => search.meanDelta),
    [0.25, 0.25, 0.25, -0.5],
  );
  assert.ok(report.searches.every((search) => search.taskDenominator === 4));
  assert.deepEqual(
    report.arms.map(({ denominator, complete, meanDelta }) => ({ denominator, complete, meanDelta })),
    [
      { denominator: 8, complete: true, meanDelta: 0.25 },
      { denominator: 8, complete: true, meanDelta: -0.125 },
    ],
  );
  assert.equal(new Set(report.pairs.map((pair) => pair.baselineRun)).size, 8);
  assert.ok(
    validationComparison(study, null, spec).arms.every((arm) => !arm.complete && arm.meanDelta === null),
  );
  assert.ok(validationComparison(null, baseline, spec).arms.every((arm) => !arm.complete));
});

test('baseline QA failure cannot pass as a completed denominator; complete negative results remain valid', () => {
  const { baseline } = contracts();
  assert.throws(
    () => assertBaselineComplete({ complete: false, samples: null, mean: null }, baseline),
    /complete registered denominator/,
  );
  const samples = Array.from({ length: 2 }, (_, repetition) =>
    baseline.tasks.map(({ id }) => ({ task: id, repetition, score: 0, phase: 'execution_failed' })),
  ).flat();
  assert.doesNotThrow(() => assertBaselineComplete({ complete: true, samples, mean: 0 }, baseline));
  assert.throws(
    () => assertBaselineComplete({ complete: true, samples: samples.slice(1), mean: 0 }, baseline),
    /complete registered denominator/,
  );
  assert.throws(
    () =>
      assertBaselineComplete(
        { complete: true, samples: [...samples.slice(1), samples[1]], mean: 0 },
        baseline,
      ),
    /duplicate slots/,
  );
});

test('invalid invocation exits before any root or paid work is created', async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), 'feedback-driver-args-'));
  await assert.rejects(main(['--root', path.join(parent, 'new'), '--check-contracts']), /Required --image/);
  assert.deepEqual(await readdir(parent), []);
});

test('an existing evidence root is rejected before preparation or model invocation', async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), 'feedback-driver-exclusive-'));
  const source = specification();
  source.isolation.network.executor = 'controlled';
  const isolationFile = path.join(parent, 'isolation.json'),
    modelFile = path.join(parent, 'model.json');
  await writeFile(isolationFile, JSON.stringify(source.isolation));
  await writeFile(
    modelFile,
    JSON.stringify({ ...source.executor, provider: 'venus', credentialEnv: ['VENUS_API_KEY'] }),
  );
  const before = await readdir(parent);
  await assert.rejects(
    main([
      '--root',
      parent,
      '--image',
      source.runtime.image,
      '--isolation',
      isolationFile,
      '--model',
      modelFile,
      '--provider-directory',
      'examples/venus',
      '--controller-ip',
      '192.0.2.1',
      '--check-contracts',
    ]),
    { code: 'EEXIST' },
  );
  assert.deepEqual(await readdir(parent), before);
});
