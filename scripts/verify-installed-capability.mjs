/** Exact archive -> native installation -> registered tasks -> independent grading.
 * New roots only. Never builds, mutates, resumes or retries a candidate.
 */
import assert from 'node:assert/strict';
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { Experiment, Grade } from '../dist/contracts.js';
import {
  atomicJSON,
  confined,
  digest,
  fileDigest,
  freeze,
  inventory,
  treeDigest,
} from '../dist/artifacts.js';
import { verifyArtifact } from '../dist/build.js';
import { Docker } from '../dist/docker.js';
import { EgressSession } from '../dist/egress-session.js';
import { prepareExecution, collectExecution, settleExecutionFailure } from '../dist/execution.js';
import { collectRequestMetrics } from '../dist/metrics.js';
import { usageAt, sumUsage } from '../dist/report.js';
import { installationConfig } from './verify-study-artifacts.mjs';

const json = async (file) => JSON.parse(await readFile(file, 'utf8'));
export const installationSeconds = 480;

export function acceptanceSpec(raw) {
  const spec = Experiment.parse(raw);
  assert.equal(spec.purpose, 'validation', 'Use the registered validation contract');
  assert.equal(spec.repetitions, 1, 'Exactly one attempt per registered task');
  assert.equal(
    spec.isolation.network.executor,
    'controlled',
    'Real-model execution requires controlled egress',
  );
  assert.ok(spec.egress.executor.length, 'No registered model route');
  for (const route of spec.egress.executor)
    assert.ok(route.timeoutSeconds <= spec.timeoutSeconds, 'Model route exceeds task deadline');
  return spec;
}

export function separateRoot(root, inputs) {
  for (const input of inputs) {
    for (const [parent, child] of [
      [input, root],
      [root, input],
    ]) {
      const relative = path.relative(parent, child);
      assert.ok(
        relative && (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)),
        'New evidence root must be separate from all frozen inputs',
      );
    }
  }
}

// Runs in the explicitly registered image. The worker uses this same /trace/dsh;
// the original archive stays unchanged and no /candidate patch is supplied.
export const nativeInstallationProgram = String.raw`import assert from 'node:assert/strict';
import {readFile,writeFile,realpath,lstat} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {parse,stringify} from '/app/node_modules/yaml/dist/index.js';
import {command} from '/app/dist/command.js';
import {initializeRuntimeEnvironment} from '/app/dist/runtime-environment.js';
await initializeRuntimeEnvironment();
import {loadProfileDirectory} from '/app/node_modules/@deepseek-ai/dsh-app-boot/lib/index.js';
const config=JSON.parse(await readFile('/acceptance/install.json','utf8'));
const mode=process.argv[2];assert.ok(['install','verify'].includes(mode));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const home='/trace/dsh', profileRoot=path.join(home,'profiles',config.profile);
const manifest=JSON.parse(await readFile('/artifact/bundle/package.json','utf8'));
assert.match(manifest.name,/^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/i);
assert.equal(hash(await readFile('/artifact/bundle.tgz')),config.identity.tarballDigest);
if(mode==='install'){
 const deadline=Date.now()+config.timeoutSeconds*1000;
 const env={...process.env,DSH_HOME:home};
 const run=async args=>{const timeoutMs=deadline-Date.now();assert.ok(timeoutMs>0,'Installation deadline exceeded');process.stdout.write(await command('dsh',args,{env,timeoutMs}));};
 await run(['--profile',config.profile,'--dump-default-config']);
 const workspace=path.join(profileRoot,'pnpm-workspace.yaml'), settings=parse(await readFile(workspace,'utf8'));
 settings.allowBuilds=config.allowBuilds;await writeFile(workspace,stringify(settings));
 await run(['plugin','--profile',config.profile,'add','/artifact/bundle.tgz']);
}
const profile=JSON.parse(await readFile(path.join(profileRoot,'package.json'),'utf8'));
assert.ok(profile.dsh.profile.bundles.includes(manifest.name),'Native Profile did not register the package');
const installedRoot=await realpath(path.join(profileRoot,'node_modules',manifest.name));
assert.ok(installedRoot.startsWith(profileRoot+'/'),'Installed package must remain within its independent Profile');
const loaded=loadProfileDirectory('dsh',profileRoot,'/app/node_modules/@deepseek-ai/dsh/package.json');
assert.deepEqual(loaded.skippedBundles,[],'Native Profile skipped a selected Bundle');
const layer=loaded.layers.find(layer=>layer.packageName===manifest.name);
assert.ok(layer,'Installed Bundle did not contribute a native layer');
assert.equal(await realpath(layer.packageDir),installedRoot,'Native loader resolved a different installed Bundle');
const resolvedPatches=[];
for(const file of layer.patchPaths){
 const resolved=await realpath(file);
 assert.ok(resolved.startsWith(installedRoot+'/'),'Bundle patch escapes installed package');
 resolvedPatches.push({path:path.relative(installedRoot,resolved),hash:hash(await readFile(resolved))});
}
const files=[];
for(const entry of config.files){
 const file=path.join(installedRoot,entry.path), actual=await realpath(file);
 assert.ok(actual.startsWith(home+'/'),'Installed runtime file escapes its DSH home');
 const observed=hash(await readFile(file));assert.equal(observed,entry.hash,'Installed file differs: '+entry.path);
 assert.equal(Boolean((await lstat(actual)).mode&0o111),entry.executable,'Executable mode differs: '+entry.path);
 files.push({path:entry.path,hash:observed,executable:entry.executable});
}
const profileFiles={};
for(const name of ['package.json','pnpm-workspace.yaml','pnpm-lock.yaml','cordis.patch.yml']){
 try{profileFiles[name]=hash(await readFile(path.join(profileRoot,name),'utf8'));}
 catch(error){if(name==='cordis.patch.yml'&&error.code==='ENOENT')continue;throw error;}
}
const observed={package:manifest.name,profile:config.profile,installedRoot,resolvedPatches,tarballDigest:config.identity.tarballDigest,files,profileFiles,inferenceRequested:false};
if(mode==='verify'){
 const original=JSON.parse(await readFile('/original-installed.json','utf8'));
 assert.deepEqual(observed,original,'Installed identity changed during task execution');
}
await writeFile('/verification/installed.json',JSON.stringify(observed,null,2)+'\n',{flag:'wx'});
`;

export function taskWorkerSpec({ root, task, spec, network, prefix, installed }) {
  const directory = path.join(root, 'tasks', task.id);
  return {
    name: `${prefix}-execute`,
    image: spec.runtime.image,
    command: ['node', '/app/dist/runtime/worker.js', '/launch.json'],
    mounts: [
      { source: path.join(directory, 'work'), target: '/workspace', writable: true },
      { source: path.join(directory, 'trace'), target: '/trace', writable: true },
      // DSH rewrites its empty root config; freeze package/dependency inputs individually.
      {
        source: path.join(directory, 'trace/dsh/profiles', spec.runtime.profile, 'node_modules'),
        target: `/trace/dsh/profiles/${spec.runtime.profile}/node_modules`,
        writable: false,
      },
      ...Object.keys(installed.profileFiles).map((file) => ({
        source: path.join(directory, 'trace/dsh/profiles', spec.runtime.profile, file),
        target: `/trace/dsh/profiles/${spec.runtime.profile}/${file}`,
        writable: false,
      })),
      { source: path.join(root, 'launch', task.id, 'worker.json'), target: '/launch.json', writable: false },
      { source: path.join(root, 'launch/empty.yml'), target: '/empty.yml', writable: false },
      { source: path.join(root, 'inputs', task.input), target: '/input', writable: false },
      ...(spec.runtime.environment
        ? [
            {
              source: path.join(root, 'inputs', spec.runtime.environment.directory),
              target: '/environment',
              writable: false,
            },
          ]
        : []),
    ],
    env: Object.fromEntries(spec.executor.credentialEnv.map((key) => [key, 'egress-client-placeholder'])),
    isolation: spec.isolation,
    network,
    timeoutSeconds: spec.timeoutSeconds,
  };
}

export function gradingSpec({ root, task, spec, prefix }) {
  const directory = path.join(root, 'tasks', task.id);
  return {
    name: `${prefix}-grade`,
    image: spec.evaluator.image,
    command: spec.evaluator.command,
    mounts: [
      { source: path.join(directory, 'delivery'), target: '/delivery', writable: false },
      { source: path.join(root, 'inputs', task.input), target: '/input', writable: false },
      { source: path.join(root, 'inputs', task.evaluation), target: '/evaluation', writable: false },
      { source: path.join(directory, 'grade'), target: '/workspace', writable: true },
    ],
    env: {},
    isolation: spec.isolation,
    network: 'none',
    timeoutSeconds: spec.evaluator.timeoutSeconds,
  };
}

export function summarize(rows, spec) {
  assert.deepEqual(
    rows.map((row) => row.task),
    spec.tasks.map((task) => task.id),
    'Incomplete registered denominator',
  );
  const scored = rows.filter((row) => row.phase === 'scored');
  return {
    registered: rows.length,
    executionAttempts: rows.filter((row) => row.executionAttempted).length,
    terminalExecutions: rows.filter((row) => row.execution !== null).length,
    scored: scored.length,
    failed: rows.filter((row) => row.phase !== 'scored').length,
    passed: rows.every(
      (row) =>
        row.phase === 'scored' && row.usage !== null && row.usage.started > 0 && row.usage.unfinished === 0,
    ),
    quality: {
      metric: spec.metric,
      meanWithRegisteredFailureValue:
        rows.reduce((sum, row) => sum + (row.phase === 'scored' ? row.grade.score : spec.metric.failure), 0) /
        rows.length,
      scoringComplete: scored.length === rows.length,
      boundary:
        'Installed delivery acceptance only. Scores are fresh observations; no improvement or transfer claim and no reuse of search/validation scores.',
    },
    usage: sumUsage(rows.map((row) => row.usage)),
    rows,
  };
}

/** Each effect runs at most once per task; individual failures preserve the full registered denominator. */
export async function runRegisteredTasks(spec, effects) {
  const rows = spec.tasks.map((task) => ({
    task: task.id,
    phase: 'registered',
    installation: null,
    executionAttempted: false,
    execution: null,
    integrity: null,
    deliveryDigest: null,
    grade: null,
    usage: null,
    error: null,
  }));
  const executeRow = async (row, index) => {
    const task = spec.tasks[index];
    try {
      row.phase = 'installing';
      await effects.save(row);
      row.installation = await effects.install(task);
      row.phase = 'executing';
      row.executionAttempted = true;
      await effects.save(row);
      row.execution = await effects.execute(task, row.installation);
      row.integrity = await effects.verifyInstalled(task);
      assert.equal(row.execution.ExitCode, 0, `Task exited ${row.execution.ExitCode}`);
      row.deliveryDigest = await effects.freezeDelivery(task);
      row.phase = 'grading';
      await effects.save(row);
      row.grade = Grade.parse(await effects.grade(task));
      assert.ok(
        row.grade.score >= spec.metric.minimum && row.grade.score <= spec.metric.maximum,
        'Score outside registered metric range',
      );
      row.phase = 'scored';
    } catch (error) {
      const phase = row.phase;
      row.phase = 'failed';
      row.error = { phase, message: effects.redact(String(error)) };
    } finally {
      try {
        row.usage = await effects.usage(task);
      } catch (error) {
        row.phase = 'failed';
        row.usageError = effects.redact(String(error));
      }
      await effects.save(row);
    }
  };
  const settled = [];
  for (let offset = 0; offset < rows.length; offset += spec.concurrency) {
    settled.push(
      ...(await Promise.allSettled(
        rows.slice(offset, offset + spec.concurrency).map((row, index) => executeRow(row, offset + index)),
      )),
    );
  }
  const failedWrites = settled.filter((result) => result.status === 'rejected');
  if (failedWrites.length)
    throw new AggregateError(
      failedWrites.map((result) => result.reason),
      'Failed to persist task evidence',
    );
  return summarize(rows, spec);
}

async function verifyDataset(root, spec) {
  for (const task of spec.tasks) {
    for (const [location, expected] of [
      [task.input, task.inputDigest],
      [task.evaluation, task.evaluationDigest],
    ])
      assert.equal(await treeDigest(confined(root, location)), expected, `Dataset changed: ${location}`);
  }
  const environment = spec.runtime.environment;
  if (environment)
    assert.equal(
      await treeDigest(confined(root, environment.directory)),
      environment.digest,
      'Model environment changed',
    );
}

export async function main(args = process.argv.slice(2)) {
  const { values } = parseArgs({
    args,
    options: Object.fromEntries(
      ['root', 'artifact', 'record', 'spec', 'dataset', 'install-policy'].map((key) => [
        key,
        { type: 'string' },
      ]),
    ),
  });
  for (const name of ['root', 'artifact', 'spec', 'dataset', 'install-policy'])
    assert.ok(values[name], `Required --${name}`);
  const artifact = await realpath(values.artifact),
    dataset = await realpath(values.dataset);
  const root = path.join(await realpath(path.dirname(path.resolve(values.root))), path.basename(values.root));
  separateRoot(root, [artifact, dataset]);
  const spec = acceptanceSpec(await json(values.spec));
  const recordPath = await realpath(
    values.record ?? path.join(path.dirname(artifact), 'research-record.json'),
  );
  const record = await json(recordPath),
    candidate = record.candidate;
  assert.ok(candidate?.build && candidate?.digest, 'Export research record must identify a built candidate');
  await verifyArtifact(artifact, candidate.digest, candidate.build);
  await verifyDataset(dataset, spec);
  const policy = await json(values['install-policy']);
  const install = installationConfig(
    { identity: candidate.build },
    { runtime: spec.runtime, model: spec.executor, composition: null, environment: null },
    policy,
  );
  const keys = [
    ...new Set(spec.egress.executor.flatMap((route) => (route.credential ? [route.credential.env] : []))),
  ];
  for (const key of keys) assert.ok(process.env[key], `Missing credential environment: ${key}`);
  const redact = (message) =>
    keys.reduce((text, key) => text.replaceAll(process.env[key], '[redacted]'), message);
  // Existing roots are never resumed. This mkdir reserves this unique attempt.
  await mkdir(root);
  const receipt = { startedAt: new Date().toISOString(), passed: false, registration: null, result: null };
  const saveReceipt = () => atomicJSON(path.join(root, 'acceptance.json'), receipt);
  const docker = new Docker();
  const abort = new AbortController();
  const interrupt = () => abort.abort(new Error('Installed capability acceptance interrupted; no retry'));
  process.once('SIGINT', interrupt);
  process.once('SIGTERM', interrupt);
  try {
    await mkdir(path.join(root, 'launch'));
    await mkdir(path.join(root, 'tasks'));
    await freeze(dataset, path.join(root, 'inputs'), path.join(root, 'publications'));
    const files = await inventory(path.join(artifact, 'bundle'));
    await writeFile(path.join(root, 'launch/install.mjs'), nativeInstallationProgram, { flag: 'wx' });
    await writeFile(path.join(root, 'launch/empty.yml'), '[]\n', { flag: 'wx' });
    await atomicJSON(path.join(root, 'launch/install.json'), {
      ...install,
      timeoutSeconds: installationSeconds,
      files,
    });
    receipt.registration = {
      kind: 'installed-capability-acceptance',
      artifact,
      sourceDigest: candidate.digest,
      build: candidate.build,
      researchRecordSha256: await fileDigest(recordPath),
      spec,
      specificationDigest: digest(spec),
      datasetDigest: await treeDigest(dataset),
      installPolicy: policy,
      helperDigest: digest(nativeInstallationProgram),
      driverSha256: await fileDigest(fileURLToPath(import.meta.url)),
      taskOrder: spec.tasks.map((task) => task.id),
      taskExecutions: spec.tasks.length,
      repetitions: 1,
      installationSeconds,
      taskSeconds: spec.timeoutSeconds,
      scoringSeconds: spec.evaluator.timeoutSeconds,
      boundary:
        'Independent post-installation delivery experiment; no build or mutation, no task/score retry, no borrowed scores. Model credentials remain exclusively in controlled egress.',
    };
    await atomicJSON(path.join(root, 'registration.json'), receipt.registration);
    await saveReceipt();
    const prefix = `he-installed-${digest(root).slice(0, 20)}`;
    for (const task of spec.tasks) {
      const directory = path.join(root, 'tasks', task.id),
        launch = path.join(root, 'launch', task.id);
      await mkdir(directory);
      await mkdir(launch);
      for (const child of ['work', 'trace', 'installation', 'integrity', 'grade'])
        await mkdir(path.join(directory, child));
      await atomicJSON(path.join(launch, 'worker.json'), {
        profile: spec.runtime.profile,
        model: spec.executor,
        patch: '/empty.yml',
        environmentPatch: spec.runtime.environment ? `/environment/${spec.runtime.environment.patch}` : null,
        prompt: task.prompt,
        timeoutSeconds: spec.timeoutSeconds,
      });
    }
    const id = (task) => `${prefix}-${digest(task.id).slice(0, 12)}`;
    const helper = async (task, mode) => {
      const directory = path.join(root, 'tasks', task.id),
        target = mode === 'install' ? 'installation' : 'integrity';
      // Installation and integrity checks need an isolated writable HOME mountpoint,
      // never the task delivery directory. Keep their temporary work separate.
      const helperWork = path.join(directory, target, 'work');
      await mkdir(helperWork);
      const container = {
        name: `${id(task)}-${mode}`,
        image: spec.runtime.image,
        command: ['node', '/acceptance/install.mjs', mode],
        env: {},
        isolation: spec.isolation,
        network: mode === 'install' ? spec.isolation.network.build : 'none',
        timeoutSeconds: mode === 'install' ? installationSeconds : spec.evaluator.timeoutSeconds,
        mounts: [
          { source: path.join(root, 'launch'), target: '/acceptance', writable: false },
          ...(mode === 'verify'
            ? [
                {
                  source: path.join(directory, 'installation/installed.json'),
                  target: '/original-installed.json',
                  writable: false,
                },
              ]
            : []),
          { source: artifact, target: '/artifact', writable: false },
          { source: path.join(directory, 'trace'), target: '/trace', writable: mode === 'install' },
          { source: helperWork, target: '/workspace', writable: true },
          { source: path.join(directory, target), target: '/verification', writable: true },
        ],
      };
      try {
        const outcome = await docker.run(container, path.join(directory, target, 'execution'), abort.signal);
        assert.equal(outcome.ExitCode, 0, `Native package ${mode} failed`);
        return await json(path.join(directory, target, 'installed.json'));
      } catch (error) {
        await docker.failureEvidence(container, path.join(directory, target, 'execution'));
        await settleExecutionFailure(path.join(directory, target, 'execution'), docker, null, error);
        throw error;
      }
    };
    receipt.result = await runRegisteredTasks(spec, {
      redact,
      save: (row) => atomicJSON(path.join(root, 'tasks', row.task, 'result.json'), row),
      install: (task) => helper(task, 'install'),
      verifyInstalled: (task) => helper(task, 'verify'),
      execute: async (task, installed) => {
        abort.signal.throwIfAborted();
        const directory = path.join(root, 'tasks', task.id);
        const gateway = new EgressSession(
          {
            root: path.join(directory, 'egress'),
            execution: `${id(task)}-execute`,
            image: spec.runtime.image,
            isolation: spec.isolation,
            routes: spec.egress.executor,
            timeoutSeconds: spec.timeoutSeconds,
          },
          docker,
        );
        try {
          const container = await prepareExecution(
            directory,
            { registration: digest(receipt.registration), task: task.id },
            docker,
            gateway,
            async () =>
              taskWorkerSpec({
                root,
                task,
                spec,
                installed,
                prefix: id(task),
                network: await gateway.candidateNetwork(),
              }),
            process.env,
          );
          return await collectExecution(
            directory,
            container,
            path.join(directory, 'execution'),
            docker,
            gateway,
            abort.signal,
          );
        } catch (error) {
          await settleExecutionFailure(directory, docker, gateway, error);
          throw error;
        }
      },
      freezeDelivery: async (task) => {
        const directory = path.join(root, 'tasks', task.id);
        const nativeReceipt = await json(path.join(directory, 'trace/receipt.json'));
        assert.equal(nativeReceipt.status, 'completed', 'Native DSH task did not complete');
        return freeze(
          path.join(directory, 'work'),
          path.join(directory, 'delivery'),
          path.join(root, 'publications'),
        );
      },
      grade: async (task) => {
        const directory = path.join(root, 'tasks', task.id);
        const container = gradingSpec({ root, task, spec, prefix: id(task) });
        try {
          const outcome = await docker.run(container, path.join(directory, 'grading'), abort.signal);
          assert.equal(outcome.ExitCode, 0, 'Independent evaluator failed');
          return await json(path.join(directory, 'grade/result.json'));
        } catch (error) {
          await docker.failureEvidence(container, path.join(directory, 'grading'));
          await settleExecutionFailure(path.join(directory, 'grading'), docker, null, error);
          throw error;
        }
      },
      usage: async (task) => {
        const trace = path.join(root, 'tasks', task.id, 'trace');
        await collectRequestMetrics(trace);
        return usageAt(trace);
      },
    });
    await verifyArtifact(artifact, candidate.digest, candidate.build);
    await verifyDataset(dataset, spec);
    await verifyDataset(path.join(root, 'inputs'), spec);
    assert.equal(await treeDigest(dataset), receipt.registration.datasetDigest, 'Original dataset changed');
    receipt.passed = receipt.result.passed;
  } catch (error) {
    receipt.error = redact(String(error));
  } finally {
    process.removeListener('SIGINT', interrupt);
    process.removeListener('SIGTERM', interrupt);
    receipt.completedAt = new Date().toISOString();
    await saveReceipt();
  }
  return receipt;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main()
    .then((receipt) => {
      console.log(
        JSON.stringify({
          passed: receipt.passed,
          result: receipt.result && {
            registered: receipt.result.registered,
            scored: receipt.result.scored,
            failed: receipt.result.failed,
            quality: receipt.result.quality,
            usage: receipt.result.usage,
          },
        }),
      );
      if (!receipt.passed) process.exitCode = 1;
    })
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}
