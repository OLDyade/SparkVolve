/** Real paid inference, once per explicit new root. No automatic retry or quality-gain assertion.
 * node --env-file=/private/venus.env scripts/verify-optimizer-study.mjs --root <NEW directory>
 *   --image sha256:... --isolation policy.json --model model.json --controller-ip <IPv4>
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { cp, mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { isIP } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { parse } from 'yaml';
import { Experiment, Image, Isolation, Model } from '../dist/contracts.js';
import { OptimizerStudy } from '../dist/optimizer-study-contracts.js';
import { OptimizerStudyStore } from '../dist/optimizer-study-store.js';
import { optimizerStudyReport } from '../dist/optimizer-study-report.js';
import { Store } from '../dist/store.js';
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

export function assertTerminalStudyReport(report) {
  assert.equal(report.state?.phase, 'complete', 'Only a terminal complete study can be verified');
  assert.ok(
    Array.isArray(report.methods) &&
      report.methods.every((method) => Number.isInteger(method.ordinal) && typeof method.id === 'string'),
    'Expected authoritative study methods',
  );
  assert.ok(
    Array.isArray(report.jobs) && Array.isArray(report.metaEpisodes),
    'Expected authoritative study jobs and meta episodes',
  );
}
export async function writeCommandResult(root, label, result) {
  assert.match(label, /^[a-z][a-z0-9-]*$/);
  const directory = path.join(root, 'command-logs');
  await mkdir(directory, { recursive: true });
  const file = path.join(directory, `${label}.json`);
  await writeFile(file, JSON.stringify(result, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  return file;
}
export async function assertOutputOutside(original, output) {
  let ancestor = path.resolve(output);
  const missing = [];
  for (;;) {
    try {
      ancestor = path.join(await realpath(ancestor), ...missing);
      break;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      missing.unshift(path.basename(ancestor));
      ancestor = path.dirname(ancestor);
    }
  }
  const relative = path.relative(await realpath(original), ancestor);
  assert.ok(
    relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative),
    'Verification output must be outside original evidence tree',
  );
}
export function installationConfiguration(model, identity, composition, runtime) {
  assert.ok(
    ['sdk', 'sdk-minimal'].includes(runtime.profile),
    'Installation requires registered native profile',
  );
  return { model, identity, composition, profile: runtime.profile };
}
export async function collectInstallations(items, install, onResult = async () => {}) {
  const results = [];
  for (const item of items) {
    let result;
    try {
      result = { name: item.name, status: 'passed', evidence: await install(item) };
    } catch (error) {
      result = { name: item.name, status: 'failed', error: String(error) };
    }
    results.push(result);
    await onResult(results);
  }
  return results;
}

export async function main(args = process.argv.slice(2)) {
  const keys = ['root', 'image', 'isolation', 'model', 'controller-ip'];
  const { values } = parseArgs({
    args,
    options: {
      ...Object.fromEntries(keys.map((key) => [key, { type: 'string' }])),
      help: { type: 'boolean' },
      'check-contracts': { type: 'boolean' },
      'verify-completed': { type: 'string' },
      'framework-package': { type: 'string' },
    },
  });
  if (values.help) {
    console.log(
      'node --env-file=<private-env> scripts/verify-optimizer-study.mjs --root <NEW directory> --image <immutable digest> --isolation <json> --model <json> --controller-ip <IPv4>\nRuns real paid inference once. Keeps failures. Never retries.\n--check-contracts builds the three real bundles and validates all four dataset contracts and study registration, then exits before study-init/inference. This non-inference check does not require a credential.\n--verify-completed <original completed root> --root <NEW verification directory> verifies preserved evidence and installs exact frozen artifacts without study-init, study-run, model calls or rewriting original reports. Other execution options are forbidden.',
    );
    process.exit(0);
  }
  assert.ok(values.root, 'Required --root');
  const completedRoot = values['verify-completed'] ? await realpath(values['verify-completed']) : null;
  if (completedRoot) {
    await assertOutputOutside(completedRoot, values.root);
    assert.ok(!values['check-contracts'], 'Completed verification cannot construct contracts');
    for (const key of keys.filter((key) => key !== 'root'))
      assert.equal(
        values[key],
        undefined,
        `Completed verification uses registered ${key}; overrides are forbidden`,
      );
    assert.ok(
      values['framework-package'],
      'Completed verification requires an explicit already-built --framework-package',
    );
  } else for (const key of keys) assert.ok(values[key], `Required --${key}`);
  const completedSpec = completedRoot
    ? OptimizerStudy.parse(
        JSON.parse(await readFile(path.join(completedRoot, 'study/registration.json'), 'utf8')),
      )
    : null;
  const image = Image.parse(completedSpec ? completedSpec.metaRuntime.runtime.image : values.image);
  const isolation = completedSpec
    ? completedSpec.metaRuntime.isolation
    : Isolation.parse(JSON.parse(await readFile(values.isolation, 'utf8')));
  const model = completedSpec
    ? completedSpec.metaRuntime.model
    : Model.parse(JSON.parse(await readFile(values.model, 'utf8')));
  assert.equal(isolation.network.executor, 'controlled');
  if (!completedRoot) assert.equal(isIP(values['controller-ip']), 4);
  assert.equal(model.provider, 'venus');
  assert.deepEqual(model.credentialEnv, ['VENUS_API_KEY']);
  if (!values['check-contracts'] && !completedRoot)
    assert.ok(process.env.VENUS_API_KEY, 'Load VENUS_API_KEY through the trusted launcher environment');
  const secrets = model.credentialEnv.map((name) => process.env[name]).filter(Boolean);
  const redact = (text) =>
    secrets.reduce((value, secret) => value.split(secret).join('[REDACTED]'), String(text));
  const repo = fileURLToPath(new URL('..', import.meta.url));
  await mkdir(path.dirname(path.resolve(values.root)), { recursive: true });
  await mkdir(path.resolve(values.root)); // Exclusive: never silently reuse a previous experiment.
  const root = await realpath(values.root);
  const study = path.join(completedRoot ?? root, 'study');
  const inputs = completedRoot ? path.join(study, 'inputs') : path.join(root, 'inputs');
  if (!completedRoot) await mkdir(inputs);
  const preservedFiles = completedRoot
    ? await Promise.all(
        [
          'acceptance.json',
          'authoritative-study-report.json',
          'study-report.json',
          'study/registration.json',
          'study/study.sqlite',
        ].map(async (file) => ({ file, sha256: await fileDigest(path.join(completedRoot, file)) })),
      )
    : [];
  const docker = new Docker(),
    stop = new AbortController();
  for (const signal of ['SIGINT', 'SIGTERM'])
    process.once(signal, () =>
      stop.abort(new Error(`Observer received ${signal}; original executions retained`)),
    );
  const receipt = {
    passed: false,
    mode: completedRoot
      ? 'completed-artifact-verification'
      : values['check-contracts']
        ? 'non-inference-contract-check'
        : 'real-model-study',
    originalEvidence: completedRoot,
    preservedFiles,
    mechanismReview: 'pending-human-source-review',
    startedAt: new Date().toISOString(),
    image,
    model,
    driverDevelopmentNotes: [
      'A non-paid self-check found TypeScript 7.0.2 exposes version metadata without the previous compiler AST API. The unsupported AST screen was removed before any model run; exact changes and native submissions remain evidence for human mechanism review. This is a driver-development finding, not a model failure.',
      'The first preparation stopped before inference because assessment incorrectly inherited search candidate/probe budgets. Corrected to one frozen candidate and no probes; --check-contracts now executes actual four-split Experiment and parent Study schema checks before any model run.',
    ],
    boundary:
      'Real native meta-optimizer and nested searches on public synthetic families. Content-disjoint independent assessment; no unseen-benchmark or causal gain claim. Scores are reports, never engineering gates. Original failures retain full denominators.',
    driverSha256: await fileDigest(fileURLToPath(import.meta.url)),
    commands: [],
    usage: [],
    checks: {},
  };
  const json = async (file) => JSON.parse(await readFile(file, 'utf8'));
  async function optional(file) {
    try {
      return await readFile(file, 'utf8');
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw error;
    }
  }
  async function run(program, args, label, env = process.env) {
    stop.signal.throwIfAborted();
    if (completedRoot && args.some((arg) => ['study-init', 'study-run'].includes(arg)))
      throw Error('Completed verification cannot dispatch a study');
    const result = await new Promise((resolve, reject) => {
      const child = spawn(program, args, { cwd: repo, env, stdio: ['ignore', 'pipe', 'pipe'] });
      const out = [],
        err = [];
      child.stdout.on('data', (data) => out.push(data));
      child.stderr.on('data', (data) => err.push(data));
      const interrupt = () => child.kill('SIGINT');
      stop.signal.addEventListener('abort', interrupt, { once: true });
      child.once('error', reject);
      child.once('close', (code, signal) => {
        stop.signal.removeEventListener('abort', interrupt);
        resolve({
          code,
          signal,
          stdout: redact(Buffer.concat(out).toString()),
          stderr: redact(Buffer.concat(err).toString()),
        });
      });
    });
    await writeCommandResult(root, label, result);
    receipt.commands.push({ label, program, args, code: result.code, signal: result.signal });
    await atomicJSON(path.join(root, 'acceptance.json'), receipt);
    stop.signal.throwIfAborted();
    assert.equal(result.code, 0, `${label} failed; inspect preserved ${label}.json; no retry`);
    return result.stdout;
  }
  async function bundle(name, source) {
    const home = path.join(root, 'preparation', name),
      sourceDigest = await treeDigest(source);
    await freeze(source, path.join(home, 'candidates', sourceDigest), path.join(root, 'publications'));
    const identity = await buildBundle(
      home,
      digest({ root, name }),
      sourceDigest,
      { image, timeoutSeconds: 300 },
      isolation,
      docker,
      stop.signal,
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
  const objective =
    'Evolve general structured-data plugins from actual inputs, deliveries and traces. Choose and implement a substantive plugin code or composition mechanism, then submit and evaluate the frozen candidate. Do not encode task IDs, fixture literals or expected answers, change the evaluator, or heuristically repair outputs. Ties and negative results are valid. Never resample unchanged bytes.';
  async function dataset(name, index, baseline, namespace) {
    const directory = path.join(inputs, 'cases', name);
    // Reuse the public fixture oracle, applying a bijective label rename to inputs and oracle together.
    // This is trusted dataset generation; no candidate implementation or model delivery is authored.
    const python = `import importlib.util,json,shutil,sys
from pathlib import Path
p=Path(sys.argv[1]);s=importlib.util.spec_from_file_location('fixtures',p);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
name,filename,data,prompt,expected=m.fixtures()[int(sys.argv[3])]
prefix=sys.argv[4]+'-'
def transform(value,key=''):
 if isinstance(value,list): return [transform(v,key) for v in value]
 if isinstance(value,dict): return {k:transform(v,k) for k,v in value.items()}
 if isinstance(value,str) and key in ('entity','event_id','tombstones','name','id','advisory','unmatched_advisories'): return prefix+value
 if isinstance(value,str) and key=='path': return '/'+prefix+value.lstrip('/')
 return value
data,expected=transform(data),transform(expected)
r=Path(sys.argv[2]);(r/'input').mkdir(parents=True);(r/'evaluation').mkdir()
(r/'input'/filename).write_text(('\\n'.join(json.dumps(v) for v in data) if filename.endswith('.jsonl') else json.dumps(data))+'\\n')
(r/'evaluation'/'expected.json').write_text(json.dumps(expected))
shutil.copyfile(p.with_name('grade.py'),r/'evaluation'/'grade.py')
(r/'task.json').write_text(json.dumps({'id':name,'prompt':prompt,'input':'input','evaluation':'evaluation'}))
`;
    await run(
      'python3',
      [
        '-B',
        '-c',
        python,
        path.join(repo, 'examples/structured-data/generate.py'),
        directory,
        String(index),
        namespace,
      ],
      `generate-${name}`,
      { PATH: process.env.PATH },
    );
    await cp(path.join(repo, 'examples/venus'), path.join(directory, 'runtime'), {
      recursive: true,
      errorOnExist: true,
    });
    await freeze(
      confined(inputs, baseline.source.directory),
      path.join(directory, 'method/source'),
      path.join(root, 'publications'),
    );
    await freeze(
      confined(inputs, baseline.artifact.directory),
      path.join(directory, 'method/artifact'),
      path.join(root, 'publications'),
    );
    const egress = await configureEgress(path.join(directory, 'runtime'), model),
      task = await json(path.join(directory, 'task.json'));
    task.inputDigest = await treeDigest(path.join(directory, task.input));
    task.evaluationDigest = await treeDigest(path.join(directory, task.evaluation));
    const purpose = name.endsWith('search') ? 'search' : 'validation';
    const spec = Experiment.parse({
      name,
      purpose,
      hostSearchProtocol: { ancestry: 'unrestricted', feedback: 'full' },
      objective,
      isolation,
      egress,
      runtime: {
        image,
        dshVersion: '0.2.1-rc.4',
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
        source: { ...baseline.source, directory: 'method/source' },
        artifact: { ...baseline.artifact, directory: 'method/artifact' },
        composition: baseline.composition,
      },
      candidate: { patch: 'cordis.patch.yml', build: { image, timeoutSeconds: 300 }, qa: null },
      evaluator: { image, command: ['python3', '/evaluation/grade.py'], timeoutSeconds: 30 },
      tasks: [task],
      repetitions: 1,
      concurrency: 1,
      timeoutSeconds: 300,
      failureLimit: 0,
      budget:
        purpose === 'search'
          ? { candidates: 2, optimizerSeconds: 600 }
          : { candidates: 1, optimizerSeconds: 1 },
      probes: purpose === 'search' ? { limit: 4, timeoutSeconds: 60 } : null,
      metric: {
        name: 'structured_output_accuracy',
        direction: 'maximize',
        minimum: 0,
        maximum: 1,
        failure: 0,
      },
      constraints: [],
    });
    return {
      specification: spec,
      dataset: { directory: `cases/${name}`, digest: await treeDigest(directory) },
    };
  }
  async function mechanism(before, after, beforeComposition, afterComposition) {
    const original = new Map((await inventory(before)).map((item) => [item.path, item.hash]));
    const current = new Map((await inventory(after)).map((item) => [item.path, item.hash]));
    const changed = [...new Set([...original.keys(), ...current.keys()])]
      .filter((file) => original.get(file) !== current.get(file))
      .sort();
    const implementationFiles = changed.filter((file) => /\.[cm]?[jt]s$/.test(file));
    const sourceChanges = [];
    for (const file of changed)
      sourceChanges.push({ file, before: original.get(file) ?? null, after: current.get(file) ?? null });
    const beforeText = await readFile(confined(before, beforeComposition), 'utf8');
    const afterText = await readFile(confined(after, afterComposition), 'utf8');
    const beforeGraph = parse(beforeText);
    const afterGraph = parse(afterText);
    const compositionChanged = digest(beforeGraph) !== digest(afterGraph);
    await atomicJSON(path.join(root, 'method-source-changes.json'), {
      before,
      after,
      beforeComposition,
      afterComposition,
      sourceChanges,
      composition: { beforeText, afterText, beforeGraph, afterGraph, parsedChanged: compositionChanged },
    });
    return {
      changed,
      implementationFiles,
      compositionChanged,
      humanMechanismReviewRequired: true,
      boundary:
        'Exact implementation/assembly changes are recorded. Human source review must establish substantive general behavior beyond wording; file changes alone do not prove a mechanism, effectiveness or causality.',
    };
  }
  async function records(directory, role, sealedMarkers = []) {
    const raw = await optional(path.join(directory, 'trace/requests.jsonl'));
    if (raw === null) return { directory: path.relative(root, directory), role, unavailable: true };
    for (const secret of secrets) assert.ok(!raw.includes(secret), 'Credential leaked to request telemetry');
    const entries = raw.split('\n').filter(Boolean).map(JSON.parse),
      starts = entries.filter((e) => e.kind === 'started');
    const terminals = entries.filter((e) => ['result', 'failed'].includes(e.kind));
    assert.equal(new Set(starts.map((e) => e.id)).size, starts.length);
    for (const entry of terminals) assert.equal(starts.filter((start) => start.id === entry.id).length, 1);
    for (const start of starts) assert.ok(terminals.filter((e) => e.id === start.id).length <= 1);
    const names = starts.flatMap((e) => e.tools.map((t) => t.name));
    if (role === 'meta') {
      assert.ok(names.some((n) => n.startsWith('optimizer_study_')));
      assert.ok(!names.some((n) => n.startsWith('evolution_')));
      for (const marker of sealedMarkers)
        assert.ok(!raw.includes(marker), 'Sealed data reached a meta model request');
    } else if (role === 'optimizer') {
      if (starts.length) assert.ok(names.some((n) => n.startsWith('evolution_')));
      assert.ok(!names.some((n) => n.startsWith('optimizer_study_')));
    } else assert.ok(!names.some((n) => n.startsWith('evolution_') || n.startsWith('optimizer_study_')));
    const observed = await json(path.join(directory, 'execution-spec.json'));
    assert.ok(!observed.mounts.some((m) => m.source === study || m.source === path.join(study, 'inputs')));
    assert.ok(
      observed.mounts
        .filter((m) => m.target !== '/trace' && m.target !== '/workspace')
        .every((m) => !m.writable),
    );
    const ledger = await optional(path.join(directory, 'egress/ledger/requests.jsonl'));
    const http = ledger === null ? [] : ledger.split('\n').filter(Boolean).map(JSON.parse);
    const native = await optional(path.join(directory, 'trace/receipt.json'));
    return {
      directory: path.relative(root, directory),
      role,
      started: starts.length,
      result: terminals.filter((e) => e.kind === 'result').length,
      failed: terminals.filter((e) => e.kind === 'failed').length,
      unfinished: starts.filter((s) => !terminals.some((e) => e.id === s.id)).length,
      accounting:
        'Token completeness and totals are supplied by the authoritative study report, not inferred here.',
      httpStarted: http.filter((e) => e.phase === 'started').length,
      httpFinished: http.filter((e) => e.phase === 'finished').length,
      requestLedgerSha256: await fileDigest(path.join(directory, 'trace/requests.jsonl')),
      native: native === null ? null : JSON.parse(native),
    };
  }
  async function installArtifact(name, artifact, sourceDigest, identity, composition, runtime, environment) {
    await verifyArtifact(artifact, sourceDigest, identity);
    const home = path.join(root, 'installation', name);
    await mkdir(path.join(home, 'work'), { recursive: true });
    const program = `import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {parse,stringify} from 'yaml';
import {command} from '/app/dist/docker.js';
import {checkComposition} from '/app/dist/composition.js';
import path from 'node:path';
import {sdkPreset,evolutionPreset} from '/app/dist/preset.js';
import {fileDigest,atomicJSON} from '/app/dist/artifacts.js';
const config=JSON.parse(await readFile('/acceptance/config.json','utf8'));
const env={...process.env,DSH_HOME:'/workspace/native/dsh',EVOLUTION_ENDPOINT:'http://127.0.0.1:1',EVOLUTION_TOKEN:'unused-install-acceptance',VENUS_API_KEY:'unused-install-acceptance'};Object.assign(process.env,env);
await command('dsh',['--profile',config.profile,'--dump-default-config'],{env,timeoutMs:30000});
const profileRoot=env.DSH_HOME+'/profiles/'+config.profile;
const workspace=profileRoot+'/pnpm-workspace.yaml',settings=parse(await readFile(workspace,'utf8'));
settings.allowBuilds={'@deepseek-ai/dsh-subprocess-local@0.2.1-rc.4':true,'@google/genai@2.21.0':true,'koffi@3.1.1':true,'node-pty@1.2.0-beta.15':true,'protobufjs@7.6.6':true};await writeFile(workspace,stringify(settings));
if(config.composition)await command('dsh',['plugin','--profile',config.profile,'add','/framework/package.tgz'],{env,timeoutMs:180000});
await command('dsh',['plugin','--profile',config.profile,'add','/artifact/bundle.tgz'],{env,timeoutMs:180000});
const profile=JSON.parse(await readFile(profileRoot+'/package.json','utf8'));
const manifest=JSON.parse(await readFile('/artifact/bundle/package.json','utf8'));assert.ok(profile.dsh.profile.bundles.includes(manifest.name));
assert.equal(await fileDigest('/artifact/bundle.tgz'),config.identity.tarballDigest);
await mkdir('/workspace/task',{recursive:true});const patches=['/environment/cordis.patch.yml'];
if(config.composition){
 const installedComposition=path.join(profileRoot,'node_modules',manifest.name,config.composition);
 await readFile(installedComposition);
 const methodPreset=evolutionPreset({plugin:'@harness-evolution/dsh-bundle',endpoint:env.EVOLUTION_ENDPOINT,tokenEnv:'EVOLUTION_TOKEN',composition:installedComposition});
 await writeFile('/workspace/preset.yml',stringify([{insert:sdkPreset('evolution','@harness-evolution/dsh-bundle/sdk-preset',config.profile)},{id:'preset-evolution',config:methodPreset.config}]));patches.push('/workspace/preset.yml');
}
await checkComposition({profile:config.profile,model:config.model,patches,directory:'/workspace/native',processCwd:'/app',workspace:'/workspace/task',timeoutSeconds:60});
const observed=JSON.parse(await readFile('/workspace/native/composition.json','utf8'));
if(config.composition)assert.ok(observed.tools.some(t=>t.name==='evolution_status'));
else assert.ok(!observed.tools.some(t=>t.name.startsWith('evolution_')));
assert.ok(!observed.tools.some(t=>t.name.startsWith('optimizer_study_')));
await atomicJSON('/workspace/installed.json',{package:manifest.name,profile:config.profile,composition:config.composition,tarballDigest:config.identity.tarballDigest,installed:true,nativeComposition:true,inferenceRequested:false});
`;
    await writeFile(path.join(home, 'install.mjs'), program);
    await atomicJSON(
      path.join(home, 'config.json'),
      installationConfiguration(model, identity, composition, runtime),
    );
    const result = await docker.run(
      {
        name: `he-install-study-${randomUUID()}`,
        image,
        isolation,
        network: isolation.network.build,
        timeoutSeconds: 480,
        command: ['node', '/acceptance/install.mjs'],
        env: {},
        mounts: [
          { source: home, target: '/acceptance', writable: false },
          { source: path.join(home, 'work'), target: '/workspace', writable: true },
          { source: artifact, target: '/artifact', writable: false },
          { source: path.join(root, 'framework'), target: '/framework', writable: false },
          { source: environment, target: '/environment', writable: false },
        ],
      },
      path.join(home, 'execution'),
    );
    assert.equal(result.ExitCode, 0, `Exact-artifact installation failed: ${name}`);
    const installed = await json(path.join(home, 'work/installed.json'));
    await verifyArtifact(artifact, sourceDigest, identity);
    return installed;
  }
  async function verifyCompleted(report, baseline, seed, markers) {
    receipt.report = report;
    assertTerminalStudyReport(report);
    for (const bundle of [baseline, seed]) {
      assert.equal(await treeDigest(confined(inputs, bundle.source.directory)), bundle.source.digest);
      await verifyArtifact(
        confined(inputs, bundle.artifact.directory),
        bundle.source.digest,
        bundle.artifact.identity,
      );
    }
    assert.equal(report.methods.length, 2);
    const g1 = report.methods.find((m) => m.ordinal === 1);
    assert.equal(g1.phase, 'ready', 'Real G1 must build and complete native method QA');
    receipt.mechanism = await mechanism(
      confined(inputs, baseline.source.directory),
      confined(study, g1.method.source.directory),
      baseline.composition,
      g1.method.composition,
    );
    const db = new DatabaseSync(path.join(study, 'study.sqlite'), { readOnly: true });
    let events;
    try {
      events = db
        .prepare('SELECT at,type,body FROM events ORDER BY seq')
        .all()
        .map((e) => ({ ...e, body: JSON.parse(e.body) }));
    } finally {
      db.close();
    }
    const selected = events.find((e) => e.type === 'study.method_selected');
    assert.ok(selected);
    const metaCalls = [];
    for (const episode of report.metaEpisodes) {
      const directory = path.join(study, 'meta-optimizer', String(episode.ordinal));
      const usage = await records(directory, 'meta', [
        markers['development-assessment'],
        markers['validation-search'],
        markers['validation-assessment'],
      ]);
      receipt.usage.push(usage);
      assert.ok(usage.started > 0);
      assert.ok(
        usage.native && Date.parse(usage.native.endedAt) <= Date.parse(selected.at),
        'Meta must end before sealed validation opens',
      );
      const session = await json(path.join(directory, 'trace/result.json'));
      metaCalls.push(...session.events.filter((e) => e.type === 'tool/call').map((e) => e.data.name));
    }
    assert.ok(
      metaCalls.includes('optimizer_study_submit'),
      'G1 must be submitted by the real native meta model',
    );
    for (const method of report.methods)
      assert.ok(report.jobs.some((j) => j.stage === 'development' && j.method === method.methodIdentity));
    const searchProof = [];
    for (const job of report.jobs) {
      assert.ok(['complete', 'failed'].includes(job.phase));
      const child = confined(study, job.childRoot),
        childSpec = Experiment.parse(await json(path.join(child, 'experiment.json')));
      assert.equal(childSpec.budget.candidates, 2);
      assert.deepEqual(childSpec.executor, model);
      assert.deepEqual(childSpec.optimizer, model);
      const store = new Store(path.join(child, 'experiment.sqlite'), childSpec, 'read');
      let candidates, runs;
      try {
        candidates = store.candidates();
        runs = store.runs();
      } finally {
        store.close();
      }
      const h0 = candidates.find((c) => c.digest === seed.source.digest);
      assert.ok(h0);
      assert.deepEqual(h0.build, seed.artifact.identity);
      const episodes = await readdir(path.join(child, 'optimizer'), { withFileTypes: true });
      for (const item of episodes.filter((e) => e.isDirectory() && /^\d+$/.test(e.name)))
        receipt.usage.push(await records(path.join(child, 'optimizer', item.name), 'optimizer'));
      for (const item of runs)
        receipt.usage.push(await records(path.join(child, 'runs', item.id), 'executor'));
      const proof = {
        job: job.id,
        stage: job.stage,
        method: job.method,
        h0: seed.source.digest,
        h0Build: h0.build,
        candidates: candidates.map((c) => ({ digest: c.digest, phase: c.phase })),
        runs: runs.length,
        result: job.result ?? null,
        error: job.error ?? null,
      };
      if (job.phase === 'complete') {
        assert.ok(job.selectedHarness);
        const assessment = confined(study, job.assessmentRoot),
          assessmentSpec = Experiment.parse(await json(path.join(assessment, 'experiment.json')));
        assert.equal(assessmentSpec.purpose, 'validation');
        assert.deepEqual(assessmentSpec.executor, model);
        const a = new Store(path.join(assessment, 'experiment.sqlite'), assessmentSpec, 'read');
        let arms, graded;
        try {
          arms = a.candidates();
          graded = a.runs();
        } finally {
          a.close();
        }
        assert.equal(arms.length, 1);
        assert.equal(arms[0].digest, job.selectedHarness.source.digest);
        assert.deepEqual(arms[0].build, job.selectedHarness.artifact.identity);
        assert.equal(job.result.denominator, assessmentSpec.tasks.length * assessmentSpec.repetitions);
        assert.equal(graded.length, job.result.denominator);
        assert.ok(
          graded.every((r) => !runs.some((s) => s.id === r.id)),
          'Assessment must use independently registered execution identities',
        );
        for (const item of graded)
          receipt.usage.push(await records(path.join(assessment, 'runs', item.id), 'executor'));
        proof.assessment = { candidate: arms[0].digest, build: arms[0].build, denominator: graded.length };
      }
      searchProof.push(proof);
    }
    assert.ok(receipt.usage.some((e) => e.role === 'optimizer' && e.started > 0));
    for (const stage of ['development', 'validation'])
      for (const method of report[stage]) assert.equal(method.denominator, 1);
    receipt.searchProof = searchProof;
    receipt.checks = {
      realMetaSubmission: true,
      exactSourceAndCompositionChangesRecorded: true,
      humanMechanismReviewRequired: true,
      commonFrozenH0: true,
      independentFrozenAssessment: true,
      scopeIsolation: true,
      sealedValidationNotFedBack: true,
      fullDenominators: true,
    };
    await mkdir(path.join(root, 'framework'));
    let frameworkPackage;
    if (completedRoot) frameworkPackage = await realpath(values['framework-package']);
    else {
      const pack = JSON.parse(
        await run(
          'npm',
          ['pack', '--ignore-scripts', '--pack-destination', path.join(root, 'framework'), '--json'],
          'pack-framework',
        ),
      );
      frameworkPackage = path.join(root, 'framework', pack['@harness-evolution/dsh-bundle'].filename);
    }
    const frameworkDigest = await fileDigest(frameworkPackage);
    await cp(frameworkPackage, path.join(root, 'framework/package.tgz'), { errorOnExist: true });
    assert.equal(await fileDigest(path.join(root, 'framework/package.tgz')), frameworkDigest);
    receipt.frameworkInstallation = {
      source: frameworkPackage,
      tarballDigest: frameworkDigest,
      boundary:
        'Separately identified installation support package; original experiment runtime identity remains its registered immutable image. No claim that these are the same artifact.',
    };
    const registration = OptimizerStudy.parse(await json(path.join(study, 'registration.json')));
    const methodCase = registration.developmentCases[0].search;
    const methodRuntime = methodCase.specification.runtime;
    const methodEnvironment = confined(
      confined(path.join(study, 'inputs'), methodCase.dataset.directory),
      methodRuntime.environment.directory,
    );
    const installationItems = [
      {
        name: 'g1',
        artifact: confined(study, g1.method.artifact.directory),
        bundle: g1.method,
        runtime: methodRuntime,
        environment: methodEnvironment,
      },
      {
        name: 'g0',
        artifact: confined(inputs, baseline.artifact.directory),
        bundle: baseline,
        runtime: methodRuntime,
        environment: methodEnvironment,
      },
    ];
    const selectedJobs = report.jobs.filter((j) => j.stage === 'validation' && j.phase === 'complete'),
      installed = new Set();
    for (const job of selectedJobs) {
      const arm = job.selectedHarness;
      if (installed.has(arm.artifact.identity.artifactDigest)) continue;
      installed.add(arm.artifact.identity.artifactDigest);
      const caseSpec = registration.validationCases.find((item) => item.id === job.caseId);
      assert.ok(caseSpec);
      const runtime = caseSpec.assessment.specification.runtime;
      installationItems.push({
        name: `h-${arm.source.digest.slice(0, 12)}`,
        artifact: confined(study, arm.artifact.directory),
        bundle: { ...arm, composition: null },
        runtime,
        environment: confined(
          confined(path.join(study, 'inputs'), caseSpec.assessment.dataset.directory),
          runtime.environment.directory,
        ),
      });
    }
    assert.ok(
      selectedJobs.length,
      'At least one H* must reach independent validation for installability evidence',
    );
    receipt.installation = await collectInstallations(
      installationItems,
      (item) =>
        installArtifact(
          item.name,
          item.artifact,
          item.bundle.source.digest,
          item.bundle.artifact.identity,
          item.bundle.composition,
          item.runtime,
          item.environment,
        ),
      async (results) => {
        receipt.installation = results;
        await atomicJSON(path.join(root, 'acceptance.json'), receipt);
      },
    );
    assert.ok(
      receipt.installation.every((item) => item.status === 'passed'),
      'At least one exact-artifact installation failed; all independent package results are preserved',
    );
  }

  try {
    if (completedRoot) {
      const store = new OptimizerStudyStore(path.join(study, 'study.sqlite'), completedSpec, 'read');
      let report;
      try {
        report = await optimizerStudyReport(study, store);
      } finally {
        store.close();
      }
      assertTerminalStudyReport(report);
      await atomicJSON(path.join(root, 'study-report.json'), report);
      receipt.registrationDigest = digest(completedSpec);
      const seed = completedSpec.developmentCases[0].seed;
      for (const item of [...completedSpec.developmentCases, ...completedSpec.validationCases])
        assert.deepEqual(item.seed, seed, 'Acceptance requires the same frozen H0');
      const data = await json(path.join(completedRoot, 'data-registration.json'));
      const markers = Object.fromEntries(data.splits.map((item) => [item.name, item.namespace]));
      receipt.frozen = { baseline: completedSpec.baseline, meta: completedSpec.metaOptimizer, seed };
      await verifyCompleted(report, completedSpec.baseline, seed, markers);
    } else {
      const baseline = {
        ...(await bundle('g0', path.join(repo, 'optimizers/evidence-driven'))),
        composition: 'plugins.yml',
      };
      const meta = {
        ...(await bundle('meta', path.join(repo, 'optimizers/method-research'))),
        composition: 'plugins.yml',
      };
      const seed = await bundle('h0', path.join(repo, 'examples/structured-data/seed'));
      const markers = Object.fromEntries(
        ['development-search', 'development-assessment', 'validation-search', 'validation-assessment'].map(
          (name) => [name, randomUUID()],
        ),
      );
      const splitRegistration = Object.entries(markers).map(([name, namespace], i) => ({
        name,
        namespace,
        fixtureIndex: [0, 1, 2, 0][i],
      }));
      await atomicJSON(path.join(root, 'data-registration.json'), {
        splits: splitRegistration,
        generator: await fileDigest(path.join(repo, 'examples/structured-data/generate.py')),
        evaluator: await fileDigest(path.join(repo, 'examples/structured-data/grade.py')),
        boundary:
          'Public synthetic families; disjoint bijectively renamed contents; original evaluator unchanged.',
      });
      const splits = {};
      for (const entry of splitRegistration)
        splits[entry.name] = await dataset(entry.name, entry.fixtureIndex, baseline, entry.namespace);
      await cp(path.join(repo, 'examples/venus'), path.join(inputs, 'runtime'), {
        recursive: true,
        errorOnExist: true,
      });
      const routes = await configureEgress(path.join(inputs, 'runtime'), model);
      const spec = OptimizerStudy.parse({
        name: 'native-optimizer-method-study',
        objective:
          'Study and improve the optimizer itself using real development-search evidence. Inspect G0 plugin implementation and native DSH APIs; choose a general substantive mechanism change to optimizer code or composition, such as native service/event/tool behavior, beyond prompt wording. Use native study tools to branch and submit one G1. Do not hand-author H candidates outside inner searches, encode task answers, change contracts or access sealed validation. Examine development results then finish. Ties, regressions and failed searches are valid; never resample.',
        baseline,
        metaOptimizer: meta,
        metaRuntime: {
          runtime: {
            image,
            dshVersion: '0.2.1-rc.4',
            profile: 'sdk',
            environment: {
              directory: 'runtime',
              patch: 'cordis.patch.yml',
              digest: await treeDigest(path.join(inputs, 'runtime')),
            },
          },
          model,
          isolation,
          egress: routes.optimizer,
        },
        methodBuild: { image, timeoutSeconds: 300 },
        methodQA: null,
        developmentCases: [
          {
            id: 'development',
            seed,
            search: splits['development-search'],
            assessment: splits['development-assessment'],
          },
        ],
        validationCases: [
          {
            id: 'sealed-validation',
            seed,
            search: splits['validation-search'],
            assessment: splits['validation-assessment'],
          },
        ],
        repetitions: 1,
        budget: { methodCandidates: 2, metaOptimizerSeconds: 1200, concurrentSearches: 1 },
        selection: { failureLimit: 0 },
      });
      await atomicJSON(path.join(root, 'study-spec.json'), spec);
      receipt.registrationDigest = digest(spec);
      receipt.frozen = { baseline, meta, seed };
      receipt.contractChecks = [];
      for (const [name, split] of Object.entries(splits)) {
        const parsed = Experiment.parse(split.specification),
          search = name.endsWith('search');
        assert.equal(parsed.purpose, search ? 'search' : 'validation');
        assert.equal(parsed.budget.candidates, search ? 2 : 1);
        assert.deepEqual(parsed.probes, search ? { limit: 4, timeoutSeconds: 60 } : null);
        if (!search) {
          assert.equal(
            Experiment.safeParse({ ...parsed, budget: { ...parsed.budget, candidates: 2 } }).success,
            false,
          );
          assert.equal(
            Experiment.safeParse({ ...parsed, probes: { limit: 4, timeoutSeconds: 60 } }).success,
            false,
          );
        }
        receipt.contractChecks.push({
          name,
          purpose: parsed.purpose,
          candidates: parsed.budget.candidates,
          probes: parsed.probes,
          schemaPassed: true,
          datasetDigest: split.dataset.digest,
        });
      }
      assert.equal(receipt.contractChecks.length, 4);
      assert.deepEqual(OptimizerStudy.parse(spec), spec);
      await atomicJSON(path.join(root, 'contract-check.json'), {
        passed: true,
        splits: receipt.contractChecks,
        studyDigest: digest(spec),
        inferenceRequested: false,
      });
      if (!values['check-contracts']) {
        await run(
          process.execPath,
          [
            path.join(repo, 'dist/cli.js'),
            'study-init',
            '--root',
            study,
            '--spec',
            path.join(root, 'study-spec.json'),
            '--dataset',
            inputs,
          ],
          'study-init',
        );
        await run(
          process.execPath,
          [
            path.join(repo, 'dist/cli.js'),
            'study-run',
            '--root',
            study,
            '--host',
            '0.0.0.0',
            '--port',
            '0',
            '--endpoint',
            `http://${values['controller-ip']}:0`,
            '--child-host',
            '0.0.0.0',
            '--child-endpoint',
            `http://${values['controller-ip']}:0`,
          ],
          'study-run',
        );
        await run(
          process.execPath,
          [
            path.join(repo, 'dist/cli.js'),
            'study-report',
            '--root',
            study,
            '--output',
            path.join(root, 'study-report.json'),
          ],
          'study-report',
        );
        const report = await json(path.join(root, 'study-report.json'));
        await verifyCompleted(report, baseline, seed, markers);
      }
    }
    receipt.passed = true;
  } catch (error) {
    receipt.error = redact(error?.stack ?? error);
    throw new Error(receipt.error);
  } finally {
    // Read-only accounting also runs after an interrupted/failed study. Never invent zero costs.
    try {
      const registration = await optional(path.join(study, 'registration.json'));
      if (registration !== null) {
        const store = new OptimizerStudyStore(
          path.join(study, 'study.sqlite'),
          JSON.parse(registration),
          'read',
        );
        try {
          receipt.report = await optimizerStudyReport(study, store);
        } finally {
          store.close();
        }
        await atomicJSON(path.join(root, 'authoritative-study-report.json'), receipt.report);
      }
    } catch (error) {
      receipt.passed = false;
      receipt.accountingError = redact(error?.stack ?? error);
      process.exitCode = 1;
    }
    try {
      for (const entry of preservedFiles)
        assert.equal(
          await fileDigest(path.join(completedRoot, entry.file)),
          entry.sha256,
          `Original evidence changed: ${entry.file}`,
        );
      receipt.originalEvidenceUnchanged = completedRoot ? true : null;
    } catch (error) {
      receipt.passed = false;
      receipt.preservationError = String(error);
      process.exitCode = 1;
    }
    receipt.completedAt = new Date().toISOString();
    await atomicJSON(path.join(root, 'acceptance.json'), receipt);
  }
  console.log(
    JSON.stringify({
      passed: receipt.passed,
      evidence: root,
      development: receipt.report?.development,
      validation: receipt.report?.validation,
      usage: receipt.usage,
      boundary: receipt.boundary,
    }),
  );
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
