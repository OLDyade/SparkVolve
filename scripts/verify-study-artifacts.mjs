/** Terminal-only delivery verification. No search, build, pack, scoring or model inference. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { copyFile, mkdir, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { canonical, confined, digest, fileDigest, treeDigest } from '../dist/artifacts.js';
import { verifyArtifact } from '../dist/build.js';
import { Docker } from '../dist/docker.js';
import {
  FixedOptimizerComparison,
  FrozenStudyBundle,
  studyArmIdentity,
  studyMethodIdentity,
} from '../dist/optimizer-study-contracts.js';
import { OptimizerStudyStore } from '../dist/optimizer-study-store.js';

const json = async (file) => JSON.parse(await readFile(file, 'utf8'));
const save = async (file, value) => writeFile(file, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
const terminal = new Set(['complete', 'failed', 'cancelled']);

export async function assertSeparateOutput(original, output) {
  original = await realpath(original);
  let existing = path.resolve(output);
  const suffix = [];
  for (;;) {
    try {
      existing = await realpath(existing);
      break;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      suffix.unshift(path.basename(existing));
      existing = path.dirname(existing);
    }
  }
  const resolved = path.join(existing, ...suffix);
  const relative = path.relative(original, resolved);
  assert.ok(
    relative === '..' || relative.startsWith('../') || path.isAbsolute(relative),
    'Output must be outside original evidence tree',
  );
  return resolved;
}

/** Expand the complete registered denominator, including cancelled unreserved slots. */
export function deliveryPlan(raw, state, jobs) {
  const spec = FixedOptimizerComparison.parse(raw);
  assert.ok(['complete', 'cancelled'].includes(state.phase), 'Study is not terminal; installation forbidden');
  assert.ok(
    jobs.every((job) => terminal.has(job.phase)),
    'Study has active jobs; installation forbidden',
  );
  const packages = new Map(),
    used = new Set(),
    slots = [];
  function add(bundle, origin, placement, split, role, composition = null) {
    FrozenStudyBundle.parse({ source: bundle.source, artifact: bundle.artifact });
    const id = digest(bundle.artifact.identity);
    let item = packages.get(id);
    if (!item) {
      item = {
        id,
        sourceDigest: bundle.source.digest,
        identity: bundle.artifact.identity,
        references: [],
        contexts: [],
      };
      packages.set(id, item);
    }
    assert.equal(item.sourceDigest, bundle.source.digest, 'One artifact identity names conflicting sources');
    item.references.push({ origin, bundle, placement });
    const s = split.specification;
    const context = {
      role,
      composition,
      runtime: s.runtime,
      model: s[role],
      isolation: s.isolation,
      environment:
        s.runtime.environment === null
          ? null
          : {
              directory: `${split.dataset.directory}/${s.runtime.environment.directory}`,
              digest: s.runtime.environment.digest,
              patch: s.runtime.environment.patch,
            },
    };
    const contextId = digest(context);
    const existing = item.contexts.find((c) => c.id === contextId);
    if (existing) existing.placements.push(placement);
    else item.contexts.push({ id: contextId, ...context, placements: [placement] });
  }
  for (const arm of spec.arms)
    for (const item of spec.cases) {
      add(
        arm.method,
        'inputs',
        { role: 'G', arm: arm.id, caseId: item.id },
        item.search,
        'optimizer',
        arm.method.composition,
      );
      for (let repetition = 0; repetition < spec.repetitions; repetition++) {
        const matches = jobs.filter(
          (job) =>
            job.comparisonArm === studyArmIdentity(arm) &&
            job.caseId === item.id &&
            job.repetition === repetition,
        );
        assert.ok(matches.length <= 1, 'Duplicate registered job slot');
        const job = matches[0];
        if (job) {
          assert.equal(job.stage, 'validation');
          assert.equal(job.method, studyMethodIdentity(arm.method));
          const expectedId = digest({
            registration: digest(spec),
            stage: 'validation',
            method: job.method,
            comparisonArm: job.comparisonArm,
            caseId: job.caseId,
            repetition,
          });
          assert.equal(job.id, expectedId, 'Job identity differs from registered slot');
          used.add(job.id);
          if (job.phase === 'complete')
            assert.ok(job.selectedHarness, 'Complete job has no selected harness');
        } else assert.equal(state.phase, 'cancelled', 'Complete study is missing a registered job');
        slots.push({
          arm: arm.id,
          caseId: item.id,
          repetition,
          job: job ?? null,
          phase: job?.phase ?? 'cancelled-unreserved',
          selection: job?.selectedHarness ? 'selected' : 'not-selected',
        });
        if (job?.selectedHarness)
          add(
            job.selectedHarness,
            'study',
            { role: 'selectedHarness', arm: arm.id, caseId: item.id, repetition, job: job.id },
            item.assessment,
            'executor',
          );
      }
    }
  assert.equal(used.size, jobs.length, 'Unregistered or duplicate jobs in authoritative ledger');
  for (const item of spec.cases)
    for (const split of ['search', 'assessment'])
      add(item.seed, 'inputs', { role: 'H0', caseId: item.id, split }, item[split], 'executor');
  return {
    registrationDigest: digest(spec),
    state,
    denominator: slots.length,
    slots,
    packages: [...packages.values()],
  };
}

export function installationConfig(item, context, policy) {
  assert.ok(
    policy &&
      Object.keys(policy).length === 1 &&
      typeof policy.allowBuilds === 'object' &&
      policy.allowBuilds !== null &&
      !Array.isArray(policy.allowBuilds) &&
      Object.values(policy.allowBuilds).every((v) => typeof v === 'boolean'),
    'Explicit install policy must contain only pnpm allowBuilds',
  );
  return {
    identity: item.identity,
    profile: context.runtime.profile,
    model: context.model,
    composition: context.composition,
    environmentPatch: context.environment?.patch ?? null,
    allowBuilds: policy.allowBuilds,
  };
}

// Installs the exact archive through the native DSH bundle loader. SDK startup only; no prompt/send.
export const installationProgram = String.raw`import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {parse,stringify} from 'yaml';
import {command} from '/acceptance/command.mjs';
import {checkComposition} from '/app/dist/composition.js';
import {initializeRuntimeEnvironment} from '/app/dist/runtime-environment.js';
await initializeRuntimeEnvironment();
import {sdkPreset,evolutionPreset} from '/app/dist/preset.js';
import {fileDigest,atomicJSON} from '/app/dist/artifacts.js';
const config=JSON.parse(await readFile('/acceptance/config.json','utf8'));
// One deadline covers the whole installation, including native composition.
const deadline=Date.now()+config.timeoutSeconds*1000;
function remaining(){const ms=deadline-Date.now();if(ms<=0)throw Error('Artifact installation deadline exceeded');return ms;}
const run=(args)=>command('dsh',args,{env,timeoutMs:remaining()});
const env={...process.env,DSH_HOME:'/workspace/native/dsh',SPARKVOLVE_ENDPOINT:'http://127.0.0.1:1',SPARKVOLVE_TOKEN:'unused-install-acceptance'};
for(const key of config.model.credentialEnv)env[key]='unused-install-acceptance';
Object.assign(process.env,env);
await run(['--profile',config.profile,'--dump-default-config']);
const profileRoot=path.join(env.DSH_HOME,'profiles',config.profile);
const workspace=path.join(profileRoot,'pnpm-workspace.yaml'),settings=parse(await readFile(workspace,'utf8'));
settings.allowBuilds=config.allowBuilds;await writeFile(workspace,stringify(settings));
if(config.composition)await run(['plugin','--profile',config.profile,'add','/framework/package.tgz']);
await run(['plugin','--profile',config.profile,'add','/artifact/bundle.tgz']);
const profile=JSON.parse(await readFile(path.join(profileRoot,'package.json'),'utf8'));
const manifest=JSON.parse(await readFile('/artifact/bundle/package.json','utf8'));
assert.ok(profile.dsh.profile.bundles.includes(manifest.name));
assert.equal(await fileDigest('/artifact/bundle.tgz'),config.identity.tarballDigest);
await mkdir('/workspace/task',{recursive:true});
const patches=config.environmentPatch===null?[]:[path.join('/environment',config.environmentPatch)];
if(config.composition){
 const installedComposition=path.join(profileRoot,'node_modules',manifest.name,config.composition);await readFile(installedComposition);
 const preset=evolutionPreset({plugin:'@sparkvolve/dsh-bundle',endpoint:env.SPARKVOLVE_ENDPOINT,tokenEnv:'SPARKVOLVE_TOKEN',composition:installedComposition});
 await writeFile('/workspace/preset.yml',stringify([{insert:sdkPreset('evolution','@sparkvolve/dsh-bundle/sdk-preset',config.profile)},{id:'preset-evolution',config:preset.config}]));patches.push('/workspace/preset.yml');
}
await checkComposition({profile:config.profile,model:config.model,patches,directory:'/workspace/native',processCwd:'/app',workspace:'/workspace/task',timeoutSeconds:remaining()/1000});
const observed=JSON.parse(await readFile('/workspace/native/composition.json','utf8'));
if(config.composition)assert.ok(observed.tools.some(t=>t.name==='evolution_status'));
else assert.ok(!observed.tools.some(t=>t.name.startsWith('evolution_')));
assert.ok(!observed.tools.some(t=>t.name.startsWith('optimizer_study_')));
await atomicJSON('/workspace/installed.json',{package:manifest.name,profile:config.profile,composition:config.composition,tarballDigest:config.identity.tarballDigest,installed:true,nativeComposition:true,inferenceRequested:false});
`;

async function checkedPath(root, relative) {
  const lexical = confined(root, relative),
    actual = await realpath(lexical);
  assert.equal(actual, lexical, 'Frozen reference must not traverse symbolic links');
  return actual;
}

async function verifyReferences(study, item) {
  for (const reference of item.references) {
    const root = reference.origin === 'inputs' ? path.join(study, 'inputs') : study;
    assert.equal(
      await treeDigest(await checkedPath(root, reference.bundle.source.directory)),
      item.sourceDigest,
    );
    await verifyArtifact(
      await checkedPath(root, reference.bundle.artifact.directory),
      item.sourceDigest,
      item.identity,
    );
  }
  for (const context of item.contexts)
    if (context.environment)
      assert.equal(
        await treeDigest(await checkedPath(path.join(study, 'inputs'), context.environment.directory)),
        context.environment.digest,
      );
}

export async function collectPackages(plan, install, saveResult) {
  const results = [];
  for (const item of plan.packages)
    for (const context of item.contexts) {
      let result;
      try {
        result = {
          artifact: item.id,
          context: context.id,
          status: 'passed',
          installed: await install(item, context),
        };
      } catch (error) {
        result = { artifact: item.id, context: context.id, status: 'failed', error: String(error) };
      }
      results.push(result);
      await saveResult(result);
    }
  return results;
}

async function originalMarkers(study) {
  const markers = {};
  for (const name of ['registration.json', 'inputs-digest.json', 'study.sqlite', 'study.sqlite-wal']) {
    try {
      markers[name] = await fileDigest(path.join(study, name));
    } catch (error) {
      if (name.endsWith('-wal') && error.code === 'ENOENT') markers[name] = null;
      else throw error;
    }
  }
  return markers;
}

export async function main(args = process.argv.slice(2)) {
  const { values } = parseArgs({
    args,
    options: {
      'evidence-root': { type: 'string' },
      output: { type: 'string' },
      'framework-tarball': { type: 'string' },
      'install-policy': { type: 'string' },
      'timeout-seconds': { type: 'string', default: '480' },
    },
  });
  for (const key of ['evidence-root', 'output', 'framework-tarball', 'install-policy'])
    assert.ok(values[key], `Required --${key}`);
  const timeoutSeconds = Number(values['timeout-seconds']);
  assert.ok(
    Number.isSafeInteger(timeoutSeconds) && timeoutSeconds > 0 && timeoutSeconds <= 2_147_483,
    '--timeout-seconds must be a positive integer within the Node timer range',
  );
  const evidence = await realpath(values['evidence-root']);
  const output = await assertSeparateOutput(evidence, values.output);
  const study = await checkedPath(evidence, 'study');
  const spec = FixedOptimizerComparison.parse(await json(path.join(study, 'registration.json')));
  const store = new OptimizerStudyStore(path.join(study, 'study.sqlite'), spec, 'read');
  let plan;
  try {
    plan = deliveryPlan(spec, store.state(), store.jobs());
  } finally {
    store.close();
  }
  // Only terminal state may create a new post-processing directory or invoke Docker.
  await mkdir(output);
  const receipt = {
    protocol: 'frozen-study-artifacts-1',
    evidenceRoot: evidence,
    output,
    startedAt: new Date().toISOString(),
    plan,
    passed: false,
    inferenceRequested: false,
    boundary: 'Installation and native composition only; no quality improvement or mechanism claim.',
  };
  try {
    const commandFile = fileURLToPath(new URL('../dist/command.js', import.meta.url));
    const commandBytes = await readFile(commandFile);
    receipt.verifier = {
      scriptDigest: await fileDigest(fileURLToPath(import.meta.url)),
      installationProgramDigest: digest(installationProgram),
      commandDigest: await fileDigest(commandFile),
      timeoutSeconds,
      runtimeBoundary: 'Original study image and archives; separately hashed post-study command runner',
    };
    const before = await originalMarkers(study);
    receipt.originalMarkers = before;
    await save(path.join(output, 'plan.json'), plan);
    const policy = await json(values['install-policy']);
    const framework = await realpath(values['framework-tarball']);
    assert.ok((await stat(framework)).isFile(), 'Framework archive must already exist');
    receipt.frameworkSupport = {
      path: framework,
      sha256: await fileDigest(framework),
      role: 'independent installation support; not a study G or H artifact',
    };
    await mkdir(path.join(output, 'framework'));
    await copyFile(framework, path.join(output, 'framework/package.tgz'));
    assert.equal(
      await fileDigest(path.join(output, 'framework/package.tgz')),
      receipt.frameworkSupport.sha256,
    );
    await save(path.join(output, 'install-policy.json'), policy);
    const docker = new Docker();
    receipt.installations = await collectPackages(
      plan,
      async (item, context) => {
        await verifyReferences(study, item);
        const home = path.join(output, 'packages', item.id, context.id);
        await mkdir(path.join(home, 'work'), { recursive: true });
        await writeFile(path.join(home, 'install.mjs'), installationProgram, { flag: 'wx' });
        await writeFile(path.join(home, 'command.mjs'), commandBytes, { flag: 'wx' });
        assert.equal(await fileDigest(path.join(home, 'command.mjs')), receipt.verifier.commandDigest);
        await save(path.join(home, 'config.json'), {
          ...installationConfig(item, context, policy),
          timeoutSeconds,
        });
        const ref = item.references[0],
          base = ref.origin === 'inputs' ? path.join(study, 'inputs') : study;
        const mounts = [
          { source: home, target: '/acceptance', writable: false },
          { source: path.join(home, 'work'), target: '/workspace', writable: true },
          {
            source: await checkedPath(base, ref.bundle.artifact.directory),
            target: '/artifact',
            writable: false,
          },
        ];
        if (context.composition)
          mounts.push({ source: path.join(output, 'framework'), target: '/framework', writable: false });
        if (context.environment)
          mounts.push({
            source: await checkedPath(path.join(study, 'inputs'), context.environment.directory),
            target: '/environment',
            writable: false,
          });
        const result = await docker.run(
          {
            name: `he-delivery-${randomUUID()}`,
            image: context.runtime.image,
            isolation: context.isolation,
            network: context.isolation.network.build,
            timeoutSeconds,
            command: ['node', '/acceptance/install.mjs'],
            env: {},
            mounts,
          },
          path.join(home, 'execution'),
        );
        assert.equal(result.ExitCode, 0, `Exact artifact installation failed: ${item.id}/${context.id}`);
        await verifyReferences(study, item);
        return await json(path.join(home, 'work/installed.json'));
      },
      async (result) => {
        const home = path.join(output, 'results');
        await mkdir(home, { recursive: true });
        await save(path.join(home, `${result.artifact}-${result.context}.json`), result);
      },
    );
    const after = await originalMarkers(study);
    receipt.originalMarkersAfter = after;
    receipt.originalControlEvidenceUnchanged = canonical(before) === canonical(after);
    assert.ok(receipt.originalControlEvidenceUnchanged, 'Original study control evidence changed');
    for (const item of plan.packages) await verifyReferences(study, item);
    receipt.frozenReferencesUnchanged = true;
    receipt.deliveryComplete = plan.slots.every(
      (slot) => slot.phase === 'complete' && slot.selection === 'selected',
    );
    receipt.installationsPassed =
      receipt.installations.length > 0 && receipt.installations.every((item) => item.status === 'passed');
    receipt.passed = receipt.deliveryComplete && receipt.installationsPassed;
  } catch (error) {
    receipt.error = String(error);
  }
  receipt.completedAt = new Date().toISOString();
  await save(path.join(output, 'acceptance.json'), receipt);
  return receipt;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main()
    .then((receipt) => {
      console.log(JSON.stringify({ output: receipt.output, passed: receipt.passed }));
      if (!receipt.passed) process.exitCode = 1;
    })
    .catch((error) => {
      console.error(String(error));
      process.exitCode = 1;
    });
}
