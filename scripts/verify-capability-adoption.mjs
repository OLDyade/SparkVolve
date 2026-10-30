/** Explicit engineering acceptance for a catalog package. No model or quality selection. */
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, readFile, writeFile, cp } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { Experiment, Image } from '../dist/contracts.js';
import { Store } from '../dist/store.js';
import { Docker } from '../dist/docker.js';
import { atomicJSON, freeze, treeDigest, fileDigest, digest } from '../dist/artifacts.js';
import { readCapabilities } from '../dist/capabilities.js';
import { queueResolution, executeResolution } from '../dist/capability-resolution.js';
import { buildBundle } from '../dist/build.js';

const { values } = parseArgs({
  options: Object.fromEntries(
    ['root', 'spec', 'dataset', 'seed', 'name', 'version', 'probe', 'image'].map((key) => [
      key,
      { type: 'string' },
    ]),
  ),
});
for (const key of ['root', 'spec', 'dataset', 'seed', 'name', 'version', 'probe', 'image'])
  assert.ok(values[key], 'Required --' + key);
const root = path.resolve(values.root);
await mkdir(root);
const spec = Experiment.parse(JSON.parse(await readFile(values.spec, 'utf8')));
spec.runtime.image = Image.parse(values.image);
spec.candidate.build.image = spec.runtime.image;
await atomicJSON(path.join(root, 'contract.json'), spec);
assert.ok(spec.capabilities, 'Contract must authorize a frozen catalog');
const dataset = path.resolve(values.dataset);
const catalog = await readCapabilities(
  path.join(dataset, spec.capabilities.directory),
  spec.capabilities.digest,
);
const matches = catalog.entries.filter(
  (entry) => entry.name === values.name && entry.version === values.version,
);
assert.equal(matches.length, 1, 'Selection must identify exactly one frozen capability');
const selected = matches[0];
const parentDigest = await treeDigest(values.seed);
await freeze(values.seed, path.join(root, 'candidates', parentDigest), path.join(root, 'publications'));
await mkdir(path.join(root, 'drafts'));
const store = new Store(path.join(root, 'experiment.sqlite'), spec);
const docker = new Docker();
const report = {
  kind: 'engineering-capability-adoption',
  startedAt: new Date().toISOString(),
  selected,
  catalogDigest: spec.capabilities.digest,
  runtime: spec.runtime,
  passed: false,
  qualityClaim: false,
};
try {
  store.addCandidate({
    digest: parentDigest,
    ordinal: 0,
    phase: 'frozen',
    proposal: {
      draft: 'seed',
      parents: [],
      actions: ['compose'],
      evidence: ['Explicit acceptance seed'],
      hypothesis: 'Validate native capability adoption',
      expectedChange: 'Exercise declared tools without inference',
    },
  });
  const queued = await queueResolution(root, dataset, spec, store, {
    parent: parentDigest,
    draft: 'composed',
    capabilities: [selected.id],
    rationale: 'Registered engineering acceptance of exact community package',
  });
  const resolved = await executeResolution(root, dataset, spec, store, queued, docker);
  assert.equal(resolved.phase, 'resolved', JSON.stringify(resolved));
  report.resolution = resolved.id;
  const candidate = await treeDigest(path.join(root, 'drafts/composed'));
  await freeze(
    path.join(root, 'drafts/composed'),
    path.join(root, 'candidates', candidate),
    path.join(root, 'publications'),
  );
  const build = await buildBundle(root, root, candidate, spec.candidate.build, spec.isolation, docker);
  report.candidate = candidate;
  report.build = build;
  const artifact = path.join(root, 'artifacts', candidate);
  await cp(path.join(artifact, 'bundle.tgz'), path.join(root, 'bundle.tgz'));
  const originalHash = await fileDigest(path.join(root, 'bundle.tgz'));
  for (const mode of ['built', 'installed']) {
    const work = path.join(root, mode);
    await mkdir(work);
    const source = [
      "import{writeFile}from'node:fs/promises';import{command}from'/app/dist/command.js';import{initializeRuntimeEnvironment}from'/app/dist/runtime-environment.js';import{initProfile,loadProfileDirectory}from'/app/node_modules/@deepseek-ai/dsh-app-boot/lib/index.js';import{checkComposition}from'/app/dist/composition.js';import{bundleLayers}from'/app/dist/bundle-composition.js';await initializeRuntimeEnvironment();let patches,bundle;",
      mode === 'built'
        ? "bundle='/candidate';patches=await bundleLayers(bundle);"
        : "process.env.DSH_HOME='/workspace/dsh';initProfile('/workspace/dsh/profiles/reuse',[]);await command('dsh',['plugin','--profile','reuse','add','/bundle.tgz','--ignore-scripts'],{timeoutMs:600000});const installed=loadProfileDirectory('dsh','/workspace/dsh/profiles/reuse','/app/node_modules/@deepseek-ai/dsh/package.json');if(installed.skippedBundles.length)throw Error('Skipped native bundle');if(installed.layers.length!==1)throw Error('Expected one installed capability Bundle');bundle=installed.layers[0].packageDir;patches=installed.layers.flatMap(layer=>layer.patchPaths);",
      "await checkComposition({profile:'sdk',model:" +
        JSON.stringify(spec.executor) +
        ",patches,bundle,directory:'/workspace/qa',processCwd:'/app',workspace:'/workspace',timeoutSeconds:600,behaviorModule:'/probe.mjs'});await writeFile('/workspace/result.json',JSON.stringify({passed:true,patches}));",
    ].join('\n');
    const launch = path.join(root, mode + '.mjs');
    await writeFile(launch, source);
    const result = await docker.run(
      {
        name: 'sv-adoption-' + digest([root, mode]).slice(0, 30),
        image: spec.runtime.image,
        command: ['node', '/launch.mjs'],
        mounts: [
          { source: launch, target: '/launch.mjs', writable: false },
          { source: path.resolve(values.probe), target: '/probe.mjs', writable: false },
          { source: work, target: '/workspace', writable: true },
          ...(mode === 'built'
            ? [{ source: path.join(artifact, 'bundle'), target: '/candidate', writable: false }]
            : []),
          { source: path.join(root, 'bundle.tgz'), target: '/bundle.tgz', writable: false },
        ],
        env: {},
        network: mode === 'installed' ? spec.isolation.network.build : 'none',
        isolation: spec.isolation,
        timeoutSeconds: 600,
      },
      path.join(root, mode + '-logs'),
    );
    assert.equal(result.ExitCode, 0, await readFile(path.join(root, mode + '-logs/stderr.log'), 'utf8'));
    report[mode] = JSON.parse(await readFile(path.join(work, 'result.json'), 'utf8'));
    report[mode].inventoryDigest = await fileDigest(path.join(work, 'qa/harness-inventory.json'));
    report[mode].behavior = JSON.parse(await readFile(path.join(work, 'qa/behavior.json'), 'utf8'));
  }
  assert.equal(await fileDigest(path.join(root, 'bundle.tgz')), originalHash);
  report.bundleSha256 = originalHash;
  report.passed = true;
} catch (error) {
  report.error = String(error.stack ?? error);
  throw error;
} finally {
  report.endedAt = new Date().toISOString();
  await atomicJSON(path.join(root, 'acceptance.json'), report);
  store.close();
  console.log('Original evidence: ' + path.join(root, 'acceptance.json'));
}
