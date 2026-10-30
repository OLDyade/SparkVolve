/** Community-benchmark startup, using the native controller for search, grading and delivery. */
import assert from 'node:assert/strict';
import { mkdir, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs, parseEnv } from 'node:util';
import { Experiment, Image, Model } from '../dist/contracts.js';
import {
  atomicJSON,
  digest,
  fileDigest,
  freeze,
  inventory,
  treeDigest,
  confined,
} from '../dist/artifacts.js';
import { buildBundle } from '../dist/build.js';
import { Docker } from '../dist/docker.js';
import { validateFrozenArm } from '../dist/validation.js';
import {
  FixedOptimizerComparison,
  studyAllocationCeiling,
  studyArmIdentity,
} from '../dist/optimizer-study-contracts.js';
import { runLogged } from './verify-feedback-study.mjs';
import { timeoutSeconds } from '../examples/timeouts.mjs';

export function assessmentContract(raw, name) {
  const { screening: _, ...protocol } = raw.hostSearchProtocol;
  return Experiment.parse({
    ...raw,
    name,
    purpose: 'validation',
    hostSearchProtocol: protocol,
    budget: { candidates: 1, optimizerSeconds: 1 },
    probes: null,
    capabilities: null,
    repetitions: 1,
  });
}

export async function registerSplits(splits, inputs) {
  const seen = new Map(),
    registrations = {};
  const search = splits.development.specification;
  for (const [name, split] of Object.entries(splits)) {
    const spec = Experiment.parse(split.specification);
    assert.equal(spec.purpose, name === 'development' ? 'search' : 'validation');
    for (const key of ['runtime', 'executor', 'metric', 'evaluator', 'isolation', 'egress', 'timeoutSeconds'])
      assert.deepEqual(spec[key], search[key], 'Split changes frozen ' + key + ': ' + name);
    assert.equal(await treeDigest(confined(inputs, split.dataset.directory)), split.dataset.digest);
    for (const task of spec.tasks) {
      assert.ok(
        !seen.has(task.inputDigest) || seen.get(task.inputDigest) === name,
        'Task input reused across splits: ' + name + '/' + task.id,
      );
      seen.set(task.inputDigest, name);
    }
    registrations[name] = {
      specificationDigest: digest(spec),
      ...split.dataset,
      tasks: spec.tasks.map(({ id, inputDigest, evaluationDigest }) => ({
        id,
        inputDigest,
        evaluationDigest,
      })),
    };
  }
  return registrations;
}

export function mutationRegistration(adapter, method, seed, search, assessment) {
  return FixedOptimizerComparison.parse({
    kind: 'fixed-comparison',
    name: adapter.name + '-mutation-study',
    objective:
      'Compare registered mutation spaces with identical H0, G, models, tasks and budget. Autonomous ancestry and capability choices; no required mutation counts. Independent assessment never reaches G.',
    baseline: adapter.mutationSpaces[0].id,
    arms: adapter.mutationSpaces.map(({ id, ...scope }) => ({
      id,
      method,
      hostSearchProtocol: { ...search.specification.hostSearchProtocol, ...scope },
    })),
    cases: [{ id: adapter.name, seed, search, assessment }],
    repetitions: 1,
    budget: { concurrentSearches: adapter.mutationSpaces.length },
  });
}

export function completedComparisonJob(report, arm) {
  const identity = studyArmIdentity(arm);
  const matches = report.jobs.filter((job) => job.comparisonArm === identity);
  assert.equal(matches.length, 1, 'Expected one registered job for comparison arm ' + arm.id);
  const job = matches[0];
  assert.ok(
    job.phase === 'complete' && job.result && job.selectedHarness,
    'Incomplete comparison arm ' + arm.id + '; original failure retained: ' + (job.error ?? job.phase),
  );
  return job;
}

export function selectValidation(baseline, selections, direction) {
  assert.ok(baseline.complete && baseline.mean !== null, 'H0 validation incomplete');
  assert.equal(baseline.eligible, true, 'H0 validation exceeds the registered failure or constraint limit');
  assert.ok(['maximize', 'minimize'].includes(direction), 'Invalid selection direction');
  // H0 wins ties. Other ties use the preregistered arm order, never the test result.
  let selected = baseline;
  for (const candidate of selections) {
    assert.ok(candidate.complete && candidate.mean !== null, 'Arm validation incomplete: ' + candidate.id);
    const improves =
      direction === 'maximize' ? candidate.mean > selected.mean : candidate.mean < selected.mean;
    if (candidate.eligible && candidate.bundle !== baseline.bundle && improves) selected = candidate;
  }
  return selected;
}

export function installedComparison(deliveries, winnerId, specification) {
  const baseline = deliveries.find((row) => row.id === 'h0');
  const selected =
    deliveries.find((row) => row.id === winnerId) ?? (winnerId === 'h0' ? baseline : undefined);
  assert.ok(baseline && selected, 'Missing installed comparison arm');
  const expected = specification.tasks.map((task) => task.id);
  for (const arm of [baseline, selected])
    assert.deepEqual(
      arm.result.rows.map((row) => row.task),
      expected,
      'Installed task denominator differs',
    );
  const pairs = selected.result.rows.map((row, index) => {
    const original = baseline.result.rows[index];
    const score = row.phase === 'scored' ? row.grade.score : specification.metric.failure;
    const before = original.phase === 'scored' ? original.grade.score : specification.metric.failure;
    return {
      task: row.task,
      baseline: before,
      selected: score,
      delta: score - before,
      baselineMetrics: original.grade?.metrics ?? null,
      selectedMetrics: row.grade?.metrics ?? null,
    };
  });
  return {
    baseline: baseline.candidate,
    selected: selected.candidate,
    identity: baseline.bundle === selected.bundle ? 'same_bundle' : 'different_bundle',
    denominator: pairs.length,
    meanDelta: pairs.reduce((sum, pair) => sum + pair.delta, 0) / pairs.length,
    pairs,
    boundary:
      'Fresh installed-package measurements on the preregistered test panel. Descriptive pilot; no new selection or task retries.',
  };
}

export async function main(args = process.argv.slice(2)) {
  const { values } = parseArgs({
    args,
    options: {
      'env-file': { type: 'string' },
      pool: { type: 'string', default: process.env.SPARKVOLVE_EGRESS_POOL },
      root: { type: 'string' },
      benchmark: { type: 'string', default: 'benchmarks/spreadsheetbench2/index.mjs' },
      provider: { type: 'string', default: 'examples/deepseek' },
      runtime: { type: 'string', default: 'runc' },
      image: { type: 'string' },
      dns: { type: 'string' },
      'task-seconds': { type: 'string', default: '600' },
      study: { type: 'boolean', default: false },
      'prepare-only': { type: 'boolean', default: false },
      help: { type: 'boolean' },
    },
  });
  if (values.help) {
    console.log(
      'npm start -- --env-file <private.env> --pool <reserved-private-CIDR> [--study] [--benchmark <adapter.mjs>] [--root <NEW directory>]\nDefault: official DeepSeek, SpreadsheetBench 2 family-separated mixed36, 600s/task. --study compares prompt / single-plugin / open-plugins. --prepare-only freezes contracts without inference. Downloaded workbooks stay local. No task retry.',
    );
    return;
  }
  assert.ok(values.pool, 'Provide --pool with a reserved private IPv4 CIDR outside your LAN/VPN');
  const repo = fileURLToPath(new URL('..', import.meta.url));
  const { benchmark: adapter, prepare } = await import(pathToFileURL(await realpath(values.benchmark)).href);
  assert.ok(
    adapter.name && adapter.seed && typeof prepare === 'function',
    'Invalid community benchmark adapter',
  );
  const provider = await realpath(values.provider);
  const model = Model.parse(JSON.parse(await readFile(path.join(provider, 'model.json'), 'utf8')));
  const env = { ...process.env };
  if (values['env-file']) {
    const credentials = parseEnv(await readFile(values['env-file'], 'utf8'));
    for (const key of model.credentialEnv) if (credentials[key]) env[key] = credentials[key];
  }
  if (!values['prepare-only']) for (const key of model.credentialEnv) assert.ok(env[key], 'Missing ' + key);
  const secrets = model.credentialEnv.map((key) => env[key]).filter(Boolean);
  for (const key of model.credentialEnv) if (env[key]) process.env[key] = env[key];
  const requested = path.resolve(
    values.root ?? '.evolution/' + adapter.name + '-' + new Date().toISOString().replaceAll(/[:.]/g, '-'),
  );
  await mkdir(path.dirname(requested), { recursive: true });
  await mkdir(requested);
  const root = await realpath(requested),
    inputs = path.join(root, 'inputs');
  await mkdir(inputs);
  const abort = new AbortController(),
    interrupt = () => abort.abort(Error('Interrupted; original attempts retained'));
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, interrupt);
  const receipt = {
    startedAt: new Date().toISOString(),
    state: 'preparing',
    root,
    benchmark: adapter.name,
    study: values.study,
    failures: [],
  };
  const run = async (label, program, argv) => {
    console.log('[' + adapter.name + '] ' + label);
    return runLogged(root, label, program, argv, { cwd: repo, env, signal: abort.signal, secrets });
  };
  const node = (label, file, argv = []) => run(label, process.execPath, [file, ...argv]);
  const cli = (label, argv) => node(label, path.join(repo, 'dist/cli.js'), argv);
  const save = () => atomicJSON(path.join(root, 'startup.json'), receipt);
  try {
    let image;
    if (values.image) image = Image.parse(values.image);
    else {
      const base = path.join(root, 'base-image.txt');
      await run('build-runtime', 'docker', ['build', '--iidfile', base, '.']);
      const baseImage = Image.parse((await readFile(base, 'utf8')).trim());
      const reference = 'sparkvolve-runtime:' + baseImage.slice(7);
      await run('tag-runtime', 'docker', ['image', 'tag', baseImage, reference]);
      const domain = path.join(root, 'domain-image.txt');
      await run('build-benchmark', 'docker', [
        'build',
        '--build-arg',
        'HARNESS_IMAGE=' + reference,
        '--iidfile',
        domain,
        '-f',
        adapter.dockerfile,
        '.',
      ]);
      image = Image.parse((await readFile(domain, 'utf8')).trim());
    }
    receipt.image = image;
    await run('verify-runtime-permissions', 'docker', [
      'run',
      '--rm',
      '--network=none',
      '--user',
      `${process.getuid()}:${process.getgid()}`,
      image,
      'node',
      '-e',
      "require('/app/package.json'); require('node:fs').readFileSync('/app/cordis.patch.yml'); console.log('Non-root runtime inputs readable')",
    ]);
    const files = (await inventory(path.join(repo, 'dist')))
      .map((x) => x.path)
      .filter((x) => x.endsWith('.js'))
      .sort();
    const hashes = (
      await run('verify-runtime', 'docker', [
        'run',
        '--rm',
        '--network=none',
        '--user',
        `${process.getuid()}:${process.getgid()}`,
        image,
        'sha256sum',
        ...files.map((x) => '/app/dist/' + x),
      ])
    )
      .trim()
      .split('\n');
    assert.equal(files.length, hashes.length);
    for (const [i, file] of files.entries())
      assert.equal(
        hashes[i].split(/\s+/)[0],
        await fileDigest(path.join(repo, 'dist', file)),
        'Image differs: ' + file,
      );
    const dns =
      values.dns ??
      JSON.parse(await node('discover-dns', 'scripts/egress-dns.mjs', [image, values.runtime])).servers.join(
        ',',
      );
    const isolation = JSON.parse(
      await node('isolation', 'examples/isolation.mjs', [values.runtime, values.pool, dns]),
    );
    const address = (await node('controller-address', 'scripts/controller-address.mjs', [image])).trim();
    await atomicJSON(path.join(root, 'isolation.json'), isolation);
    const docker = new Docker();
    async function bundle(name, original) {
      const home = path.join(root, 'build', name),
        sourceDigest = await treeDigest(original);
      const source = path.join(home, 'candidates', sourceDigest);
      await freeze(original, source, path.join(root, 'publications'));
      const identity = await buildBundle(
        home,
        digest([root, name]),
        sourceDigest,
        { image, timeoutSeconds: 600 },
        isolation,
        docker,
        abort.signal,
      );
      const relative = 'bundles/' + name;
      await freeze(source, path.join(inputs, relative, 'source'), path.join(root, 'publications'));
      await freeze(
        path.join(home, 'artifacts', sourceDigest),
        path.join(inputs, relative, 'artifact'),
        path.join(root, 'publications'),
      );
      return {
        source: { directory: relative + '/source', digest: sourceDigest },
        artifact: { directory: relative + '/artifact', identity },
      };
    }
    const method = {
      ...(await bundle('g', path.join(repo, 'optimizers/evidence-driven'))),
      composition: 'plugins.yml',
    };
    const seed = await bundle('h0', adapter.seed);
    const prepared = await prepare({
      root,
      inputs,
      image,
      isolation,
      model,
      provider,
      method,
      run,
      taskSeconds: timeoutSeconds(values['task-seconds']),
    });
    const { development: search, validation: assessment, test } = prepared.splits;
    const registeredSplits = await registerSplits(prepared.splits, inputs);
    const study = values.study ? mutationRegistration(adapter, method, seed, search, assessment) : null;
    const armCount = study?.arms.length ?? 1;
    const allocation = {
      searchTasks: study
        ? studyAllocationCeiling(study).searchTasks
        : search.specification.budget.candidates * search.specification.tasks.length,
      validationTasks: (armCount + 1) * assessment.specification.tasks.length,
      installedTestTasks: 2 * test.specification.tasks.length,
    };
    allocation.total = Object.values(allocation).reduce((a, b) => a + b, 0);
    receipt.allocation = allocation;
    await atomicJSON(path.join(root, 'registration.json'), {
      registeredAt: new Date().toISOString(),
      adapterSha256: await fileDigest(values.benchmark),
      provenance: prepared.provenance,
      boundary: prepared.boundary,
      model,
      image,
      method,
      seed,
      splits: registeredSplits,
      study,
      allocation,
      selection:
        'Choose each search H* from full development scores. Compare frozen H* on validation; H0 wins ties, then registered arm order. No validation feedback reaches G. Freeze one winner before test; test never changes selection.',
      test: 'Install unchanged original archives for H0 and the validation winner on the fixed test panel. Identical bundles execute once and share the measurement. No task retry or replacement. One search per arm is a pilot, not a significance claim.',
    });
    if (study) await atomicJSON(path.join(root, 'study-spec.json'), study);
    receipt.state = values['prepare-only'] ? 'prepared' : 'searching';
    await save();
    console.log('Task execution ceiling: ' + allocation.total + '. Evidence: ' + root);
    if (values['prepare-only']) return receipt;
    const selections = [];
    if (study) {
      const studyRoot = path.join(root, 'study');
      await cli('study-init', [
        'study-init',
        '--root',
        studyRoot,
        '--spec',
        path.join(root, 'study-spec.json'),
        '--dataset',
        inputs,
      ]);
      let dispatchError;
      try {
        await cli('study-run', [
          'study-run',
          '--root',
          studyRoot,
          '--child-host',
          '0.0.0.0',
          '--child-endpoint',
          'http://' + address + ':0',
        ]);
      } catch (error) {
        dispatchError = String(error);
      }
      const report = JSON.parse(await cli('study-report', ['study-report', '--root', studyRoot]));
      await atomicJSON(path.join(root, 'study-report.json'), report);
      if (dispatchError) throw Error('Study dispatch failed; original report retained: ' + dispatchError);
      for (const arm of study.arms) {
        const job = completedComparisonJob(report, arm);
        selections.push({
          id: arm.id,
          complete: true,
          mean: job.result.score,
          eligible:
            job.result.failures <= assessment.specification.failureLimit && job.result.constraintsSatisfied,
          bundle: job.selectedHarness.artifact.identity.bundleDigest,
          source: confined(studyRoot, job.selectedHarness.source.directory),
          artifact: confined(studyRoot, job.selectedHarness.artifact.directory),
          digest: job.selectedHarness.source.digest,
          build: job.selectedHarness.artifact.identity,
          exportRoot: confined(studyRoot, job.childRoot),
        });
      }
    } else {
      const home = path.join(root, 'search');
      await cli('initialize', [
        'init',
        '--root',
        home,
        '--spec',
        path.join(root, 'development-spec.json'),
        '--dataset',
        confined(inputs, search.dataset.directory),
        '--seed',
        confined(inputs, seed.source.directory),
      ]);
      await cli('evolve', [
        'evolve',
        '--root',
        home,
        '--host',
        '0.0.0.0',
        '--port',
        '0',
        '--endpoint',
        'http://' + address + ':0',
      ]);
      const report = JSON.parse(await cli('report', ['report', '--root', home]));
      await atomicJSON(path.join(root, 'report.json'), report);
      const h = report.candidates.find((c) => c.digest === report.currentChampion);
      assert.ok(h?.build, 'No eligible search selection');
      const arm = {
        id: 'open-plugins',
        digest: h.digest,
        build: h.build,
        source: path.join(home, 'candidates', h.digest),
        artifact: path.join(home, 'artifacts', h.digest),
      };
      const measured = await validateFrozenArm(
        path.join(root, 'selected-validation'),
        assessment.specification,
        confined(inputs, assessment.dataset.directory),
        arm,
        docker,
        abort.signal,
      );
      selections.push({
        ...arm,
        ...measured,
        eligible:
          measured.failures <= assessment.specification.failureLimit &&
          measured.constraints.every((c) => c.status === 'passed'),
        bundle: h.build.bundleDigest,
        exportRoot: home,
      });
    }
    receipt.state = 'validating';
    await save();
    const baseRoot = path.join(root, 'h0-validation');
    const baseArm = {
      id: 'h0',
      source: confined(inputs, seed.source.directory),
      digest: seed.source.digest,
      artifact: confined(inputs, seed.artifact.directory),
      build: seed.artifact.identity,
    };
    const baseResult = await validateFrozenArm(
      baseRoot,
      assessment.specification,
      confined(inputs, assessment.dataset.directory),
      baseArm,
      docker,
      abort.signal,
    );
    const baseline = {
      ...baseArm,
      ...baseResult,
      bundle: seed.artifact.identity.bundleDigest,
      exportRoot: baseRoot,
      eligible:
        baseResult.failures <= assessment.specification.failureLimit &&
        baseResult.constraints.every((c) => c.status === 'passed'),
    };
    const winner = selectValidation(baseline, selections, assessment.specification.metric.direction);
    await atomicJSON(path.join(root, 'validation-selection.json'), {
      baseline,
      selections,
      winner: winner.id,
      selectedDigest: winner.digest,
    });
    receipt.selectedCandidate = winner.digest;
    receipt.state = 'installing-and-testing';
    await save();
    const policy = JSON.parse(
      await run('install-policy', 'docker', [
        'run',
        '--rm',
        '--network=none',
        image,
        'node',
        '-e',
        "process.stdout.write(JSON.stringify({allowBuilds:require('/app/package.json').allowScripts}))",
      ]),
    );
    await atomicJSON(path.join(root, 'install-policy.json'), policy);
    const deliveries = winner.bundle === baseline.bundle ? [baseline] : [baseline, winner];
    await mkdir(path.join(root, 'delivery'));
    receipt.delivery = [];
    for (const arm of deliveries) {
      const output = path.join(root, 'delivery', arm.id);
      await mkdir(output);
      const capability = path.join(output, 'capability');
      await cli('export-' + arm.id, [
        'export',
        '--root',
        arm.exportRoot,
        '--candidate',
        arm.digest,
        '--output',
        capability,
      ]);
      await node('installed-test-' + arm.id, 'scripts/verify-installed-capability.mjs', [
        '--root',
        path.join(output, 'installed'),
        '--artifact',
        path.join(capability, 'artifact'),
        '--spec',
        path.join(root, 'test-spec.json'),
        '--dataset',
        confined(inputs, test.dataset.directory),
        '--install-policy',
        path.join(root, 'install-policy.json'),
      ]);
      const acceptance = JSON.parse(await readFile(path.join(output, 'installed/acceptance.json'), 'utf8'));
      assert.equal(acceptance.passed, true, 'Original-package test did not complete');
      assert.equal(await fileDigest(path.join(capability, 'bundle.tgz')), arm.build.tarballDigest);
      receipt.delivery.push({
        id: arm.id,
        candidate: arm.digest,
        bundle: arm.bundle,
        bundleSha256: arm.build.tarballDigest,
        result: acceptance.result,
      });
    }
    receipt.installedComparison = installedComparison(receipt.delivery, winner.id, test.specification);
    await atomicJSON(path.join(root, 'installed-comparison.json'), receipt.installedComparison);
    receipt.state = 'complete';
    console.log('Completed: ' + root + '/startup.json');
  } catch (error) {
    receipt.state = 'failed';
    receipt.failures.push(
      secrets.reduce((text, secret) => text.replaceAll(secret, '[REDACTED]'), String(error.stack ?? error)),
    );
    throw Error('Community benchmark failed; original evidence: ' + root + '/startup.json', {
      cause: Error(receipt.failures.at(-1)),
    });
  } finally {
    receipt.endedAt = new Date().toISOString();
    await save();
    for (const signal of ['SIGINT', 'SIGTERM']) process.removeListener(signal, interrupt);
  }
  return receipt;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
