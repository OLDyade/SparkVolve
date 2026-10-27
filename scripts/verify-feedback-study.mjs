/** Explicit real-model study. --check-contracts performs no model inference. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { cp, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { isIP } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { Experiment, Image, Isolation, Model } from '../dist/contracts.js';
import { FixedOptimizerComparison, studyAllocationCeiling } from '../dist/optimizer-study-contracts.js';
import { OptimizerStudyStore } from '../dist/optimizer-study-store.js';
import { optimizerStudyReport } from '../dist/optimizer-study-report.js';
import { Store } from '../dist/store.js';
import { experimentReport } from '../dist/report.js';
import { validateFrozenArm } from '../dist/validation.js';
import { Docker } from '../dist/docker.js';
import { buildBundle, verifyArtifact } from '../dist/build.js';
import {
  atomicJSON,
  confined,
  digest,
  fileDigest,
  freeze,
  inventory,
  treeDigest,
} from '../dist/artifacts.js';
import { configureEgress } from '../examples/venus/egress.mjs';

export function comparisonRegistration(method, seed, search, assessment) {
  return FixedOptimizerComparison.parse({
    kind: 'fixed-comparison',
    name: 'spreadsheet-feedback-study',
    objective:
      'Compare full and mechanical host feedback with one frozen optimizer and seed-only ancestry. Independent validation selects no optimizer and triggers no release.',
    baseline: 'mechanical',
    arms: ['full', 'mechanical'].map((feedback) => ({
      id: feedback,
      method,
      hostSearchProtocol: { ancestry: 'seed-only', feedback },
    })),
    cases: [{ id: 'public-spreadsheet-families', seed, search, assessment }],
    repetitions: 2,
    budget: { concurrentSearches: 2 },
  });
}

export function allocationRegistration(spec, baseline) {
  const study = studyAllocationCeiling(spec);
  const baselineTasks = baseline.tasks.length * baseline.repetitions;
  return {
    study,
    baselineTasks,
    totalTaskExecutions: study.searchTasks + study.assessmentTasks + baselineTasks,
    boundary:
      'Task execution ceiling includes every H0 search and selected-H validation; optimizer streams, build, native assembly QA and grading are separate resources. No task retry.',
  };
}

export function validateStudyShape(spec, baseline) {
  FixedOptimizerComparison.parse(spec);
  Experiment.parse(baseline);
  assert.equal(spec.cases.length, 1);
  assert.equal(spec.repetitions, 2);
  assert.equal(spec.budget.concurrentSearches, 2);
  assert.deepEqual(
    spec.arms.map((arm) => arm.id),
    ['full', 'mechanical'],
  );
  assert.deepEqual(spec.arms[0].method, spec.arms[1].method, 'Both arms must use the same frozen G');
  for (const arm of spec.arms)
    assert.deepEqual(arm.hostSearchProtocol, { ancestry: 'seed-only', feedback: arm.id });
  const { search, assessment } = spec.cases[0];
  for (const split of [search, assessment]) {
    assert.equal(split.specification.tasks.length, 4);
    assert.equal(split.specification.repetitions, 1);
    assert.equal(split.specification.probes, null);
    assert.equal(split.specification.researchLibrary, null);
    assert.equal(split.specification.candidate.qa, null);
  }
  assert.deepEqual(search.specification.budget, { candidates: 3, optimizerSeconds: 1200 });
  assert.equal(assessment.specification.budget.candidates, 1);
  assert.deepEqual(baseline, {
    ...assessment.specification,
    name: 'spreadsheet-h0-validation',
    repetitions: 2,
  });
  const allocation = allocationRegistration(spec, baseline);
  assert.equal(allocation.study.searchTasks, 48);
  assert.equal(allocation.study.assessmentTasks, 16);
  assert.equal(allocation.baselineTasks, 8);
  assert.equal(allocation.totalTaskExecutions, 72);
  return allocation;
}

/** Each command has its own exclusive telemetry path, never the report output path. */
export async function runLogged(root, label, program, args, { cwd, env, signal, secrets = [] } = {}) {
  assert.match(label, /^[a-z][a-z0-9-]*$/);
  signal?.throwIfAborted();
  const directory = path.join(root, 'command-logs');
  await mkdir(directory, { recursive: true });
  const file = path.join(directory, `${label}.json`);
  const startedAt = new Date().toISOString();
  // Reserve before spawning: duplicate invocation must not start a second process.
  await writeFile(file, JSON.stringify({ startedAt, state: 'started' }) + '\n', { flag: 'wx', mode: 0o600 });
  const redact = (value) =>
    secrets.reduce((text, secret) => text.split(secret).join('[REDACTED]'), String(value));
  const result = await new Promise((resolve) => {
    const out = [],
      err = [];
    const child = spawn(program, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', (data) => out.push(data));
    child.stderr.on('data', (data) => err.push(data));
    const interrupt = () => child.kill('SIGINT');
    signal?.addEventListener('abort', interrupt, { once: true });
    let spawnError = null;
    child.once('error', (error) => {
      spawnError = redact(error.stack ?? error);
    });
    child.once('close', (code, childSignal) => {
      signal?.removeEventListener('abort', interrupt);
      resolve({
        code,
        signal: childSignal,
        spawnError,
        stdout: redact(Buffer.concat(out).toString()),
        stderr: redact(Buffer.concat(err).toString()),
      });
    });
  });
  await atomicJSON(file, {
    startedAt,
    completedAt: new Date().toISOString(),
    program: redact(program),
    args: args.map(redact),
    ...result,
  });
  signal?.throwIfAborted();
  assert.equal(result.code, 0, `${label} failed; original command retained at ${file}; no retry`);
  return result.stdout;
}

async function optionalJSON(file) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

/** Recompute reports with read-only stores, including partial and failed attempts. */
export async function snapshotReports(root) {
  const reports = {};
  const study = path.join(root, 'study');
  const registration = await optionalJSON(path.join(study, 'registration.json'));
  if (registration) {
    const store = new OptimizerStudyStore(path.join(study, 'study.sqlite'), registration, 'read');
    try {
      reports.study = await optimizerStudyReport(study, store);
    } finally {
      store.close();
    }
    await atomicJSON(path.join(root, 'authoritative-study-report.json'), reports.study);
  }
  const baseline = path.join(root, 'h0-validation');
  const specification = await optionalJSON(path.join(baseline, 'experiment.json'));
  if (specification) {
    const store = new Store(path.join(baseline, 'experiment.sqlite'), specification, 'read');
    try {
      reports.baseline = await experimentReport(baseline, store);
    } finally {
      store.close();
    }
    await atomicJSON(path.join(root, 'authoritative-h0-report.json'), reports.baseline);
  }
  return reports;
}

export function assertBaselineComplete(result, spec) {
  const expected = spec.tasks.length * spec.repetitions;
  assert.ok(
    result.complete && Number.isFinite(result.mean) && result.samples?.length === expected,
    'Independent H0 validation did not produce the complete registered denominator',
  );
  const keys = new Set(result.samples.map((sample) => `${sample.task}:${sample.repetition}`));
  assert.equal(keys.size, expected, 'Independent H0 validation contains duplicate slots');
  for (const task of spec.tasks)
    for (let repetition = 0; repetition < spec.repetitions; repetition++)
      assert.ok(keys.has(`${task.id}:${repetition}`), 'Independent H0 validation has an unobserved slot');
}

export function validationComparison(study, baseline, spec) {
  const tasks = spec.cases[0].assessment.specification.tasks.map((task) => task.id);
  const base = baseline?.candidates?.[0];
  const baseSamples = base?.samples ?? [];
  const pairs = spec.arms.flatMap((arm) =>
    Array.from({ length: spec.repetitions }, (_, repetition) => {
      const job = study?.jobs?.find(
        (item) =>
          item.comparisonArm &&
          item.repetition === repetition &&
          study.comparison.arms.find((entry) => entry.id === arm.id)?.armDigest === item.comparisonArm,
      );
      const assessment = study?.accounting?.jobs?.find((item) => item.id === job?.id)?.assessment;
      const samples = assessment?.candidates?.[0]?.samples ?? [];
      return tasks.map((task) => {
        const h0 = baseSamples.find((sample) => sample.task === task && sample.repetition === repetition);
        const selected = samples.find((sample) => sample.task === task && sample.repetition === 0);
        const terminal = (sample) =>
          sample && ['scored', 'execution_failed', 'cancelled'].includes(sample.phase);
        const failedSearch = job?.phase === 'failed';
        const h0Score = terminal(h0)
          ? (h0.score ?? spec.cases[0].assessment.specification.metric.failure)
          : null;
        const selectedScore = failedSearch
          ? spec.cases[0].assessment.specification.metric.failure
          : terminal(selected)
            ? (selected.score ?? spec.cases[0].assessment.specification.metric.failure)
            : null;
        return {
          arm: arm.id,
          searchRepetition: repetition,
          task,
          job: job?.id ?? null,
          selectedHarness: job?.selectedHarness?.source.digest ?? null,
          baselineRun: h0?.id ?? null,
          selectedRun: selected?.id ?? null,
          baselinePhase: h0?.phase ?? 'unobserved',
          selectedPhase: failedSearch ? 'search_failed' : (selected?.phase ?? 'unobserved'),
          h0Score,
          selectedScore,
          delta: h0Score === null || selectedScore === null ? null : selectedScore - h0Score,
        };
      });
    }).flat(),
  );
  return {
    pairs,
    searches: spec.arms.flatMap(({ id }) =>
      Array.from({ length: spec.repetitions }, (_, repetition) => {
        const rows = pairs.filter((row) => row.arm === id && row.searchRepetition === repetition);
        const complete = rows.every((row) => row.delta !== null);
        return {
          arm: id,
          searchRepetition: repetition,
          taskDenominator: rows.length,
          complete,
          h0Mean: complete ? rows.reduce((sum, row) => sum + row.h0Score, 0) / rows.length : null,
          selectedMean: complete ? rows.reduce((sum, row) => sum + row.selectedScore, 0) / rows.length : null,
          meanDelta: complete ? rows.reduce((sum, row) => sum + row.delta, 0) / rows.length : null,
        };
      }),
    ),
    arms: spec.arms.map(({ id }) => {
      const rows = pairs.filter((row) => row.arm === id),
        complete = rows.every((row) => row.delta !== null);
      return {
        id,
        denominator: rows.length,
        observedPairs: rows.filter((row) => row.delta !== null).length,
        complete,
        meanDelta: complete ? rows.reduce((sum, row) => sum + row.delta, 0) / rows.length : null,
      };
    }),
    boundary:
      'One shared independent H0 validation baseline; paired by task and search repetition. The experimental unit is an independent search: two per arm; eight task instances per arm are not eight independent evolutions. Report search-level means/deltas without significance claims. Terminal search failures use registered failure values; unobserved baseline/assessment remains null. Repeated public synthetic families are not unseen heldout data, cross-domain transfer or proof of general causal benefit.',
  };
}

export async function main(args = process.argv.slice(2)) {
  const required = ['root', 'image', 'isolation', 'model', 'controller-ip'];
  const { values } = parseArgs({
    args,
    options: {
      ...Object.fromEntries(required.map((key) => [key, { type: 'string' }])),
      help: { type: 'boolean' },
      'check-contracts': { type: 'boolean' },
    },
  });
  if (values.help) {
    console.log(
      'node --env-file=<private-env> scripts/verify-feedback-study.mjs --root <NEW> --image <immutable> --isolation <JSON file> --model <JSON file> --controller-ip <IPv4> [--check-contracts]\nExplicit execution uses real Venus inference, at most 72 task executions plus optimizer calls. --check-contracts freezes/builds/preflights/parses with no model calls. Existing roots and automatic retries are forbidden.',
    );
    return;
  }
  for (const key of required) assert.ok(values[key], `Required --${key}`);
  const image = Image.parse(values.image),
    isolation = Isolation.parse(JSON.parse(await readFile(values.isolation, 'utf8'))),
    model = Model.parse(JSON.parse(await readFile(values.model, 'utf8')));
  assert.equal(isIP(values['controller-ip']), 4, 'Controller must be a literal IPv4 address');
  assert.equal(isolation.network.executor, 'controlled');
  assert.equal(model.provider, 'venus');
  assert.deepEqual(model.credentialEnv, ['VENUS_API_KEY']);
  if (!values['check-contracts'])
    assert.ok(process.env.VENUS_API_KEY, 'Load VENUS_API_KEY through a private launcher environment');
  const secrets = model.credentialEnv.map((key) => process.env[key]).filter(Boolean);
  const redact = (value) =>
    secrets.reduce((text, secret) => text.split(secret).join('[REDACTED]'), String(value));
  const repo = fileURLToPath(new URL('..', import.meta.url));
  await mkdir(path.dirname(path.resolve(values.root)), { recursive: true });
  await mkdir(path.resolve(values.root));
  const root = await realpath(values.root),
    inputs = path.join(root, 'inputs'),
    studyRoot = path.join(root, 'study');
  await mkdir(inputs);
  const abort = new AbortController();
  const interrupt = () => abort.abort(new Error('Research driver interrupted; original attempts retained'));
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, interrupt);
  const receipt = {
    mode: values['check-contracts'] ? 'non-inference-contract-check' : 'real-model-feedback-study',
    passed: false,
    startedAt: new Date().toISOString(),
    image,
    model,
    driverSha256: await fileDigest(fileURLToPath(import.meta.url)),
    failures: [],
    boundary:
      'Research on public synthetic spreadsheet families, real Venus G/H, fixed frozen methods. Scores do not gate engineering success or automatically promote artifacts. No retry, fallback, benchmark claim or code-generated task answers.',
  };
  const run = (label, program, commandArgs, env = process.env) =>
    runLogged(root, label, program, commandArgs, { cwd: repo, env, signal: abort.signal, secrets });
  const cli = (label, commandArgs) =>
    run(label, process.execPath, [path.join(repo, 'dist/cli.js'), ...commandArgs]);
  const docker = new Docker();
  let spec, baseline;
  try {
    const runtimeFiles = (await inventory(path.join(repo, 'dist')))
      .map((entry) => entry.path)
      .filter((file) => file.endsWith('.js'))
      .sort();
    assert.ok(
      runtimeFiles.includes('optimizer-access.js') && runtimeFiles.includes('optimizer-study-runner.js'),
    );
    const imageHashes = (
      await run('runtime-hashes', 'docker', [
        'run',
        '--rm',
        '--network=none',
        image,
        'sha256sum',
        ...runtimeFiles.map((file) => `/app/dist/${file}`),
      ])
    )
      .trim()
      .split('\n');
    assert.equal(imageHashes.length, runtimeFiles.length);
    receipt.runtime = [];
    for (const [index, file] of runtimeFiles.entries()) {
      const sha256 = await fileDigest(path.join(repo, 'dist', file));
      assert.equal(imageHashes[index].split(/\s+/)[0], sha256, `Runtime image differs: ${file}`);
      receipt.runtime.push({ file: `dist/${file}`, sha256 });
    }
    await atomicJSON(path.join(root, 'isolation.json'), isolation);
    await run(
      'spreadsheet-preflight',
      process.execPath,
      [
        'examples/spreadsheet/verify-image.mjs',
        image,
        path.join(root, 'isolation.json'),
        path.join(root, 'spreadsheet-preflight'),
      ],
      { PATH: process.env.PATH },
    );
    // Freeze source before building so concurrent checkout edits cannot alter the built research object.
    async function bundle(name, original) {
      const home = path.join(root, 'build', name),
        sourceDigest = await treeDigest(original);
      const source = path.join(home, 'candidates', sourceDigest);
      await freeze(original, source, path.join(root, 'publications'));
      const identity = await buildBundle(
        home,
        digest([root, name]),
        sourceDigest,
        { image, timeoutSeconds: 300 },
        isolation,
        docker,
        abort.signal,
      );
      const relative = `bundles/${name}`;
      await freeze(source, path.join(inputs, relative, 'source'), path.join(root, 'publications'));
      await freeze(
        path.join(home, 'artifacts', sourceDigest),
        path.join(inputs, relative, 'artifact'),
        path.join(root, 'publications'),
      );
      await verifyArtifact(path.join(inputs, relative, 'artifact'), sourceDigest, identity);
      return {
        source: { directory: `${relative}/source`, digest: sourceDigest },
        artifact: { directory: `${relative}/artifact`, identity },
      };
    }
    const method = {
      ...(await bundle('g', path.join(repo, 'optimizers/evidence-driven'))),
      composition: 'plugins.yml',
    };
    const seed = await bundle('h0', path.join(repo, 'examples/spreadsheet/seed'));
    const generator = path.join(root, 'generator');
    await mkdir(generator);
    for (const file of ['research.py', 'grade.py'])
      await cp(path.join(repo, 'examples/spreadsheet', file), path.join(generator, file), {
        errorOnExist: true,
        force: false,
      });
    const dshVersion = JSON.parse(
      await readFile(path.join(repo, 'node_modules/@deepseek-ai/dsh-agent/package.json'), 'utf8'),
    ).version;
    async function dataset(split, purpose) {
      const directory = path.join(inputs, 'cases', split);
      await mkdir(path.dirname(directory), { recursive: true });
      await run(
        `generate-${split}`,
        'docker',
        [
          'run',
          '--rm',
          '--network=none',
          '--user',
          `${isolation.user.uid}:${isolation.user.gid}`,
          '--mount',
          `type=bind,src=${generator},dst=/generator,readonly`,
          '--mount',
          `type=bind,src=${inputs},dst=/datasets`,
          image,
          'python3',
          '-B',
          '/generator/research.py',
          `/datasets/cases/${split}`,
          split,
        ],
        { PATH: process.env.PATH },
      );
      await cp(path.join(repo, 'examples/venus'), path.join(directory, 'runtime'), {
        recursive: true,
        force: false,
        errorOnExist: true,
      });
      const egress = await configureEgress(path.join(directory, 'runtime'), model);
      await freeze(
        confined(inputs, method.source.directory),
        path.join(directory, 'method/source'),
        path.join(root, 'publications'),
      );
      await freeze(
        confined(inputs, method.artifact.directory),
        path.join(directory, 'method/artifact'),
        path.join(root, 'publications'),
      );
      const tasks = JSON.parse(await readFile(path.join(directory, 'tasks.json'), 'utf8'));
      for (const task of tasks) {
        task.inputDigest = await treeDigest(confined(directory, task.input));
        task.evaluationDigest = await treeDigest(confined(directory, task.evaluation));
      }
      const specification = Experiment.parse({
        name: `spreadsheet-${split}`,
        purpose,
        hostSearchProtocol: { ancestry: 'seed-only', feedback: 'full' },
        objective:
          'Improve general spreadsheet plugin implementation or composition using authorized source and task evidence. Choose substantive mechanisms, submit distinct candidates, and wait for each to settle before concluding. Follow the declared host feedback and ancestry protocol. Do not encode task IDs, coordinates, fixture values or expected answers; do not change evaluation or resample unchanged versions. Negative results are valid.',
        isolation,
        egress,
        runtime: {
          image,
          dshVersion,
          profile: 'sdk',
          environment: {
            directory: 'runtime',
            patch: 'cordis.patch.yml',
            digest: await treeDigest(path.join(directory, 'runtime')),
          },
        },
        executor: model,
        optimizer: model,
        researchLibrary: null,
        optimizerHarness: {
          kind: 'artifact',
          source: { ...method.source, directory: 'method/source' },
          artifact: { ...method.artifact, directory: 'method/artifact' },
          composition: method.composition,
        },
        candidate: { patch: 'cordis.patch.yml', build: { image, timeoutSeconds: 300 }, qa: null },
        evaluator: { image, command: ['python3', '/evaluation/grade.py'], timeoutSeconds: 120 },
        tasks,
        repetitions: 1,
        concurrency: 4,
        timeoutSeconds: 300,
        failureLimit: 0,
        budget:
          purpose === 'search'
            ? { candidates: 3, optimizerSeconds: 1200 }
            : { candidates: 1, optimizerSeconds: 1 },
        probes: null,
        metric: { name: 'formula_value_accuracy', direction: 'maximize', minimum: 0, maximum: 1, failure: 0 },
        constraints: [],
      });
      return { specification, dataset: { directory: `cases/${split}`, digest: await treeDigest(directory) } };
    }
    const search = await dataset('development', 'search'),
      assessment = await dataset('validation', 'validation');
    spec = comparisonRegistration(method, seed, search, assessment);
    baseline = Experiment.parse({
      ...assessment.specification,
      name: 'spreadsheet-h0-validation',
      repetitions: 2,
    });
    const allocation = validateStudyShape(spec, baseline);
    await atomicJSON(path.join(root, 'study-spec.json'), spec);
    await atomicJSON(path.join(root, 'h0-validation-spec.json'), baseline);
    await atomicJSON(path.join(root, 'research-registration.json'), {
      studyDigest: digest(spec),
      baselineDigest: digest(baseline),
      allocation,
      generator: await fileDigest(path.join(generator, 'research.py')),
      evaluator: await fileDigest(path.join(generator, 'grade.py')),
      method,
      seed,
      baseline: {
        dataset: assessment.dataset,
        specification: baseline,
        source: seed.source,
        artifact: seed.artifact,
        visibility: 'trusted host only; never registered as search evidence',
      },
      selection:
        'Existing host selects H* from each complete child search using the fixed score rule, including H0. Mechanical G cannot observe selection. No study method selection, no automatic release.',
      validity:
        'Two repetitions per arm, same four public families with changed validation numbers. Descriptive paired estimates with shared tasks/baseline; no unseen test or universal feedback benefit claim.',
    });
    receipt.registrationDigest = digest(spec);
    receipt.allocation = allocation;
    await atomicJSON(path.join(root, 'contract-check.json'), {
      passed: true,
      inferenceRequested: false,
      allocation,
      studyDigest: digest(spec),
      baselineDigest: digest(baseline),
    });
    if (!values['check-contracts']) {
      await cli('study-init', [
        'study-init',
        '--root',
        studyRoot,
        '--spec',
        path.join(root, 'study-spec.json'),
        '--dataset',
        inputs,
      ]);
      // Independent baseline still executes after a failed search command, never after cancellation.
      try {
        await cli('study-run', [
          'study-run',
          '--root',
          studyRoot,
          '--child-host',
          '0.0.0.0',
          '--child-endpoint',
          `http://${values['controller-ip']}:0`,
        ]);
      } catch (error) {
        receipt.failures.push({ stage: 'study-run', error: redact(error.stack ?? error) });
      }
      abort.signal.throwIfAborted();
      try {
        receipt.baselineResult = await validateFrozenArm(
          path.join(root, 'h0-validation'),
          baseline,
          confined(inputs, assessment.dataset.directory),
          {
            id: 'h0',
            source: confined(inputs, seed.source.directory),
            digest: seed.source.digest,
            artifact: confined(inputs, seed.artifact.directory),
            build: seed.artifact.identity,
          },
          docker,
          abort.signal,
        );
        assertBaselineComplete(receipt.baselineResult, baseline);
      } catch (error) {
        receipt.failures.push({ stage: 'h0-validation', error: redact(error.stack ?? error) });
      }
    }
    receipt.passed = receipt.failures.length === 0;
  } catch (error) {
    receipt.failures.push({ stage: 'preparation-or-dispatch', error: redact(error.stack ?? error) });
  } finally {
    try {
      const reports = await snapshotReports(root);
      if (spec && !values['check-contracts']) {
        await atomicJSON(
          path.join(root, 'validation-comparison.json'),
          validationComparison(reports.study, reports.baseline, spec),
        );
        receipt.studyUsage = reports.study?.accounting?.totalUsage ?? null;
        receipt.baselineUsage = reports.baseline?.totalUsage ?? null;
        receipt.studyPhase = reports.study?.state?.phase ?? null;
      }
    } catch (error) {
      receipt.failures.push({ stage: 'read-only-report', error: redact(error.stack ?? error) });
    }
    receipt.passed = receipt.passed && receipt.failures.length === 0;
    receipt.completedAt = new Date().toISOString();
    await atomicJSON(path.join(root, 'acceptance.json'), receipt);
    for (const signal of ['SIGINT', 'SIGTERM']) process.removeListener(signal, interrupt);
  }
  console.log(
    JSON.stringify({
      passed: receipt.passed,
      evidence: root,
      mode: receipt.mode,
      allocation: receipt.allocation,
      failures: receipt.failures,
    }),
  );
  if (!receipt.passed) throw Error(`Feedback study failed; original evidence retained at ${root}; no retry`);
  return receipt;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
