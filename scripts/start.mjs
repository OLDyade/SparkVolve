/** Recipe-based real-model entry. It assembles the existing DSH controller, not a second agent runtime. */
import assert from 'node:assert/strict';
import { mkdir, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, parseEnv } from 'node:util';
import { z } from 'zod';
import { Image, Model, RelativePath } from '../dist/contracts.js';
import { atomicJSON, fileDigest } from '../dist/artifacts.js';
import { timeoutSeconds } from '../examples/timeouts.mjs';
import { runLogged } from './verify-feedback-study.mjs';

export const Recipe = z.strictObject({
  name: z.string().regex(/^[a-z][a-z0-9-]*$/),
  dockerfile: RelativePath.nullable(),
  generate: z.array(z.string().min(1)).min(1),
  prepare: RelativePath,
  seed: RelativePath,
  preflight: RelativePath.nullable(),
});

export async function main(args = process.argv.slice(2)) {
  const { values } = parseArgs({
    args,
    options: {
      'env-file': { type: 'string' },
      pool: { type: 'string' },
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
      'npm start -- --pool <reserved-private-CIDR> [--env-file <private.env>] [--recipe <recipe.json>] [--root <NEW directory>]\nDefaults: official DeepSeek, structured-data example, 600 seconds per task. Builds the runtime, initializes and runs real evolution, then exports the selected bundle. --image accepts an already-built immutable image ID. No task retry.',
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
        const baseReference = `harness-evolution-runtime:${image.slice('sha256:'.length)}`;
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
    await run('generate-tasks', 'docker', [
      'run',
      '--rm',
      '--network=none',
      '--user',
      `${isolation.user.uid}:${isolation.user.gid}`,
      '--mount',
      `type=bind,src=${domain},dst=/recipe,readonly`,
      '--mount',
      `type=bind,src=${root},dst=/workspace`,
      image,
      ...recipe.generate,
    ]);
    const dataset = path.join(root, 'dataset'),
      specification = path.join(root, 'spec.json'),
      search = path.join(root, 'search');
    await node('prepare-contract', path.join(domain, recipe.prepare), [
      dataset,
      image,
      modelFile,
      specification,
      isolationFile,
      provider,
      String(taskSeconds),
    ]);
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
    receipt.state = 'complete';
    receipt.selectedCandidate = report.currentChampion;
    console.log(`Completed. Report: ${root}/report.json\nSelected bundle: ${root}/capability/bundle.tgz`);
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
