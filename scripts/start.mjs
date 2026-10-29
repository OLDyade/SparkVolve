/** Recipe-based real-model entry. It assembles the existing DSH controller, not a second agent runtime. */
import assert from 'node:assert/strict';
import { mkdir, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, parseEnv } from 'node:util';
import { z } from 'zod';
import { Experiment, Image, Model, RelativePath } from '../dist/contracts.js';
import { atomicJSON, digest, fileDigest, treeDigest } from '../dist/artifacts.js';
import { timeoutSeconds } from '../examples/timeouts.mjs';
import { runLogged } from './verify-feedback-study.mjs';

export const Recipe = z.strictObject({
  name: z.string().regex(/^[a-z][a-z0-9-]*$/),
  dockerfile: RelativePath.nullable(),
  generate: z.strictObject(
    Object.fromEntries(
      ['search', 'validation', 'reuse'].map((split) => [split, z.array(z.string().min(1)).min(1)]),
    ),
  ),
  prepare: RelativePath,
  seed: RelativePath,
  preflight: RelativePath.nullable(),
});

export function assessmentContract(raw, name) {
  return Experiment.parse({
    ...raw,
    name,
    purpose: 'validation',
    objective: 'Assess the frozen original bundle on every registered task. No optimization or task retry.',
    budget: { candidates: 1, optimizerSeconds: 1 },
    probes: null,
    repetitions: 1,
  });
}

export async function registerSplits(splits) {
  const registrations = {};
  const seen = new Map();
  const search = Experiment.parse(JSON.parse(await readFile(splits.search.specification, 'utf8')));
  for (const [name, split] of Object.entries(splits)) {
    const spec = Experiment.parse(JSON.parse(await readFile(split.specification, 'utf8')));
    assert.equal(spec.purpose, name === 'search' ? 'search' : 'validation');
    for (const key of ['runtime', 'executor', 'metric', 'evaluator', 'isolation', 'egress', 'timeoutSeconds'])
      assert.deepEqual(spec[key], search[key], `Split changes frozen ${key}: ${name}`);
    for (const task of spec.tasks) {
      assert.ok(
        !seen.has(task.inputDigest) || seen.get(task.inputDigest) === name,
        `Task input is reused across splits: ${name}/${task.id}`,
      );
      seen.set(task.inputDigest, name);
    }
    registrations[name] = {
      specificationDigest: digest(spec),
      datasetDigest: await treeDigest(split.dataset),
      tasks: spec.tasks.map(({ id, inputDigest, evaluationDigest }) => ({
        id,
        inputDigest,
        evaluationDigest,
      })),
    };
  }
  return registrations;
}

export async function main(args = process.argv.slice(2)) {
  const { values } = parseArgs({
    args,
    options: {
      'env-file': { type: 'string' },
      pool: { type: 'string', default: process.env.SPARKVOLVE_EGRESS_POOL },
      root: { type: 'string' },
      recipe: { type: 'string', default: 'examples/structured-data/recipe.json' },
      provider: { type: 'string', default: 'examples/deepseek' },
      runtime: { type: 'string', default: 'runc' },
      image: { type: 'string' },
      dns: { type: 'string' },
      'task-seconds': { type: 'string', default: '600' },
      help: { type: 'boolean' },
    },
  });
  if (values.help) {
    console.log(
      'npm start -- --env-file <private.env> [--pool <reserved-private-CIDR>] [--recipe <recipe.json>] [--root <NEW directory>]\nDefaults: official DeepSeek, structured-data example, 600 seconds per task. SPARKVOLVE_EGRESS_POOL supplies --pool. Builds the runtime, freezes three task splits, runs native evolution, independently validates H0/H*, and installs the unchanged selected bundle into clean Profiles for fresh reuse tasks. --image accepts an already-built immutable image ID. No task retry.',
    );
    return;
  }
  assert.ok(
    values.pool,
    'Provide --pool with a reserved private IPv4 CIDR that does not overlap your host/LAN/VPN',
  );
  const repo = fileURLToPath(new URL('..', import.meta.url));
  const recipePath = await realpath(values.recipe);
  const recipe = Recipe.parse(JSON.parse(await readFile(recipePath, 'utf8')));
  const domain = path.dirname(recipePath);
  const provider = await realpath(values.provider);
  const modelFile = path.join(provider, 'model.json');
  const model = Model.parse(JSON.parse(await readFile(modelFile, 'utf8')));
  const env = { ...process.env };
  if (values['env-file']) {
    const privateValues = parseEnv(await readFile(values['env-file'], 'utf8'));
    for (const key of model.credentialEnv) if (privateValues[key]) env[key] = privateValues[key];
  }
  for (const key of model.credentialEnv)
    assert.ok(env[key], `Missing ${key}; set it in your environment or --env-file`);
  const secrets = model.credentialEnv.map((key) => env[key]);
  const taskSeconds = timeoutSeconds(values['task-seconds']);
  const requestedRoot = path.resolve(
    values.root ?? `.evolution/${recipe.name}-${new Date().toISOString().replaceAll(/[:.]/g, '-')}`,
  );
  await mkdir(path.dirname(requestedRoot), { recursive: true });
  await mkdir(requestedRoot);
  const root = await realpath(requestedRoot);
  const abort = new AbortController();
  const interrupt = () => abort.abort(Error('Startup interrupted; original experiment retained'));
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, interrupt);
  const receipt = {
    startedAt: new Date().toISOString(),
    state: 'preparing',
    recipe: recipe.name,
    recipeSha256: await fileDigest(recipePath),
    model,
    taskSeconds,
    root,
    driverSha256: await fileDigest(fileURLToPath(import.meta.url)),
  };
  const run = async (label, program, commandArgs) => {
    console.log(`[${recipe.name}] ${label}`);
    return runLogged(root, label, program, commandArgs, { cwd: repo, env, signal: abort.signal, secrets });
  };
  const node = (label, file, commandArgs = []) => run(label, process.execPath, [file, ...commandArgs]);
  const cli = (label, commandArgs) => node(label, path.join(repo, 'dist/cli.js'), commandArgs);
  try {
    let image;
    if (values.image) image = Image.parse(values.image);
    else {
      const baseId = path.join(root, 'base-image.txt');
      await run('build-runtime', 'docker', ['build', '--iidfile', baseId, '.']);
      image = Image.parse((await readFile(baseId, 'utf8')).trim());
      if (recipe.dockerfile) {
        const domainId = path.join(root, 'domain-image.txt');
        // BuildKit FROM resolves image names, not Docker's local content-ID syntax.
        const baseReference = `sparkvolve-runtime:${image.slice('sha256:'.length)}`;
        await run('name-runtime-image', 'docker', ['image', 'tag', image, baseReference]);
        assert.equal(
          (
            await run('verify-runtime-name', 'docker', [
              'image',
              'inspect',
              baseReference,
              '--format',
              '{{.Id}}',
            ])
          ).trim(),
          image,
        );
        await run('build-domain', 'docker', [
          'build',
          '--build-arg',
          `HARNESS_IMAGE=${baseReference}`,
          '--iidfile',
          domainId,
          '-f',
          path.join(domain, recipe.dockerfile),
          '.',
        ]);
        image = Image.parse((await readFile(domainId, 'utf8')).trim());
      }
    }
    receipt.image = image;
    const dns =
      values.dns ??
      JSON.parse(await node('discover-dns', 'scripts/egress-dns.mjs', [image, values.runtime])).servers.join(
        ',',
      );
    const isolationFile = path.join(root, 'isolation.json');
    const isolation = JSON.parse(
      await node('isolation', 'examples/isolation.mjs', [values.runtime, values.pool, dns]),
    );
    await atomicJSON(isolationFile, isolation);
    const controllerIP = (await node('controller-address', 'scripts/controller-address.mjs', [image])).trim();
    if (recipe.preflight)
      await node('domain-preflight', path.join(domain, recipe.preflight), [
        image,
        isolationFile,
        path.join(root, 'preflight'),
      ]);
    const splits = {};
    for (const name of ['search', 'validation', 'reuse']) {
      const home = path.join(root, `${name}-data`);
      await mkdir(home);
      await run(`generate-${name}`, 'docker', [
        'run',
        '--rm',
        '--network=none',
        '--user',
        `${isolation.user.uid}:${isolation.user.gid}`,
        '--mount',
        `type=bind,src=${domain},dst=/recipe,readonly`,
        '--mount',
        `type=bind,src=${home},dst=/workspace`,
        image,
        ...recipe.generate[name],
      ]);
      const split = { dataset: path.join(home, 'dataset'), specification: path.join(home, 'spec.json') };
      await node(`prepare-${name}`, path.join(domain, recipe.prepare), [
        split.dataset,
        image,
        modelFile,
        split.specification,
        isolationFile,
        provider,
        String(taskSeconds),
      ]);
      if (name !== 'search')
        await atomicJSON(
          split.specification,
          assessmentContract(
            JSON.parse(await readFile(split.specification, 'utf8')),
            `${recipe.name}-${name}`,
          ),
        );
      splits[name] = split;
    }
    await atomicJSON(path.join(root, 'registration.json'), {
      registeredAt: new Date().toISOString(),
      recipeSha256: receipt.recipeSha256,
      model,
      image,
      splits: await registerSplits(splits),
      selection:
        'Select H* strictly from search scores; independent validation and reuse never select or mutate candidates.',
      reuse:
        'Install the original selected archive in a fresh native DSH Profile for each reuse task; no rebuild.',
    });
    const { dataset, specification } = splits.search,
      search = path.join(root, 'search');
    await cli('initialize', [
      'init',
      '--root',
      search,
      '--spec',
      specification,
      '--dataset',
      dataset,
      '--seed',
      path.join(domain, recipe.seed),
    ]);
    receipt.state = 'running';
    await atomicJSON(path.join(root, 'startup.json'), receipt);
    console.log(`Evidence: ${root}\nFollow: node dist/cli.js events --root ${search} --follow`);
    await cli('evolve', [
      'evolve',
      '--root',
      search,
      '--host',
      '0.0.0.0',
      '--port',
      '0',
      '--endpoint',
      `http://${controllerIP}:0`,
    ]);
    const report = JSON.parse(await cli('report', ['report', '--root', search]));
    await atomicJSON(path.join(root, 'report.json'), report);
    assert.ok(report.currentChampion, 'No eligible candidate was produced; inspect report.json');
    await cli('export', [
      'export',
      '--root',
      search,
      '--candidate',
      report.currentChampion,
      '--output',
      path.join(root, 'capability'),
    ]);
    const baseline = report.candidates.find((candidate) => candidate.ordinal === 0);
    assert.ok(baseline?.build, 'Search baseline has no frozen build');
    const selected = report.candidates.find((candidate) => candidate.digest === report.currentChampion);
    const arms = [
      ['h0', baseline],
      ['selected', selected],
    ].map(([id, candidate]) => ({
      id,
      digest: candidate.digest,
      build: candidate.build,
      source: path.join(search, 'candidates', candidate.digest),
      artifact: path.join(search, 'artifacts', candidate.digest),
    }));
    const armsFile = path.join(root, 'validation-arms.json');
    await atomicJSON(armsFile, arms);
    receipt.selectedCandidate = report.currentChampion;
    receipt.state = 'validating';
    await atomicJSON(path.join(root, 'startup.json'), receipt);
    await cli('independent-validation', [
      'validate',
      '--root',
      path.join(root, 'validation'),
      '--spec',
      splits.validation.specification,
      '--dataset',
      splits.validation.dataset,
      '--arms',
      armsFile,
    ]);
    receipt.validation = JSON.parse(await readFile(path.join(root, 'validation/comparison.json'), 'utf8'));
    receipt.state = 'installing-and-reusing';
    await atomicJSON(path.join(root, 'startup.json'), receipt);
    const installPolicy = path.join(root, 'install-policy.json');
    const runtimePackage = JSON.parse(
      await run('runtime-install-policy', 'docker', [
        'run',
        '--rm',
        '--network=none',
        image,
        'node',
        '-e',
        "process.stdout.write(JSON.stringify({allowBuilds:require('/app/package.json').allowScripts}))",
      ]),
    );
    await atomicJSON(installPolicy, runtimePackage);
    await node('original-package-reuse', 'scripts/verify-installed-capability.mjs', [
      '--root',
      path.join(root, 'installed'),
      '--artifact',
      path.join(root, 'capability/artifact'),
      '--spec',
      splits.reuse.specification,
      '--dataset',
      splits.reuse.dataset,
      '--install-policy',
      installPolicy,
    ]);
    const installed = JSON.parse(await readFile(path.join(root, 'installed/acceptance.json'), 'utf8'));
    assert.equal(installed.passed, true, 'Installed execution did not complete; inspect original evidence');
    receipt.reuse = installed.result;
    assert.ok(
      receipt.validation.results.every((result) => result.complete && result.failures === 0),
      'Independent validation has execution failures; original scores and reuse evidence retained',
    );
    receipt.bundleSha256 = await fileDigest(path.join(root, 'capability/bundle.tgz'));
    receipt.state = 'complete';
    receipt.selectedCandidate = report.currentChampion;
    console.log(
      `Completed. Closure: ${root}/startup.json\nSearch: ${root}/report.json\nValidation: ${root}/validation/comparison.json\nReuse: ${root}/installed/acceptance.json\nSelected bundle: ${root}/capability/bundle.tgz`,
    );
  } catch (error) {
    receipt.state = 'failed';
    receipt.error = secrets.reduce(
      (text, secret) => text.split(secret).join('[REDACTED]'),
      String(error.stack ?? error),
    );
    throw Error(`Startup failed. Original evidence: ${root}/startup.json`, { cause: Error(receipt.error) });
  } finally {
    receipt.endedAt = new Date().toISOString();
    await atomicJSON(path.join(root, 'startup.json'), receipt);
    for (const signal of ['SIGINT', 'SIGTERM']) process.removeListener(signal, interrupt);
  }
  return receipt;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
