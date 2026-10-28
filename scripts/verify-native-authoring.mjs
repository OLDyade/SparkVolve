/** Real-model native authoring acceptance. Every invocation reserves a new evidence root. */
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { cp, mkdir, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import { isIP } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { parse } from '@babel/parser';
import { Experiment, Image, Isolation, Model } from '../dist/contracts.js';
import { inventory, treeDigest, fileDigest, freeze, digest } from '../dist/artifacts.js';
import { verifyArtifact } from '../dist/build.js';
import { Docker } from '../dist/docker.js';
import { cancelExecutionTree } from '../dist/cancellation.js';
import { Store } from '../dist/store.js';
import { experimentReport, sumUsage } from '../dist/report.js';
import { runLogged } from './verify-feedback-study.mjs';
import { installationConfig, installationProgram } from './verify-study-artifacts.mjs';

const json = async (p) => JSON.parse(await readFile(p, 'utf8'));
const save = async (p, value) => writeFile(p, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
const sha256 = (s) => createHash('sha256').update(s).digest('hex');

export function acceptanceContracts(development, validation) {
  const objective =
    'Improve the general spreadsheet plugin using authorized task evidence. For this native authoring integration acceptance, actually query the relevant Cordis inspect contract and load an official plugin-development or composition Skill before implementing a candidate. These tool-use requirements test integration, not autonomous preference or causal benefit. Choose your own evidence-backed implementation or assembly change; do not encode task identities, coordinates, fixture values or answers. Freeze and evaluate the candidate through the ordinary controller. Optional probes are available. Negative quality results are valid; never change the evaluator, resample an unchanged candidate, or modify the frozen optimizer.';
  const search = Experiment.parse({
    ...development,
    name: 'native-authoring-development',
    objective,
    concurrency: 4,
    repetitions: 1,
    timeoutSeconds: 300,
    failureLimit: 0,
    budget: { candidates: 3, optimizerSeconds: 1200 },
    probes: { limit: 3, timeoutSeconds: 120 },
  });
  const assessment = Experiment.parse({
    ...validation,
    name: 'native-authoring-validation',
    purpose: 'validation',
    objective:
      'Independently assess original H0 and the final search champion on every registered validation task. No search or mutation.',
    concurrency: 4,
    repetitions: 1,
    timeoutSeconds: 300,
    failureLimit: 0,
    budget: { candidates: 1, optimizerSeconds: 1 },
    probes: null,
  });
  assert.equal(search.tasks.length, 4);
  assert.deepEqual(
    search.tasks.map((t) => t.id),
    assessment.tasks.map((t) => t.id),
  );
  assert.equal(search.runtime.image, assessment.runtime.image);
  assert.deepEqual(search.executor, assessment.executor);
  assert.deepEqual(search.candidate, assessment.candidate);
  return {
    search,
    assessment,
    allocation: {
      searchTasks: 12,
      validationTasks: 8,
      totalTaskExecutions: 20,
      candidatesIncludingBaseline: 3,
      optionalProbes: 3,
      optimizerSeconds: 1200,
      boundary:
        'Ceiling, not fabricated observations: QA/build failures consume candidate slots without task scores. Probe/build/QA/optimizer calls are separately accounted. No task retry.',
    },
  };
}

/** Parse durable native events by call identity; a name in prose never establishes a call. */
export function authoringEvidence(notifications, skills) {
  const calls = new Map(),
    completed = [];
  for (const item of notifications) {
    if (item.method !== 'session.event') continue;
    const event = item.params.event;
    const key = (id) => `${item.params.sessionId}:${id}`;
    if (event.type === 'tool/call') {
      assert.ok(!calls.has(key(event.data.callId)), 'Duplicate native tool call identity');
      calls.set(key(event.data.callId), { ...event.data, sequence: event.seq });
    } else if (event.type === 'tool/result') {
      const message = event.data.message,
        call = calls.get(key(message.toolCallId));
      if (!call) continue;
      const text = message.content
        .filter((c) => c.type === 'text')
        .map((c) => c.text)
        .join('\n');
      const success = message.isError === false;
      const matched =
        call.name === 'skill' && success
          ? skills.filter(
              (skill) =>
                text.includes(`Base directory for this skill: ${skill.directory}`) &&
                text.includes(`<skill_instructions>\n${skill.body}\n</skill_instructions>`),
            )
          : [];
      completed.push({
        name: call.name,
        callId: call.callId,
        sequence: call.sequence,
        resultSequence: event.seq,
        success,
        arguments: call.arguments,
        resultSha256: sha256(text),
        skills: matched.map(({ file, sha256: hash, bodySha256 }) => ({ file, sha256: hash, bodySha256 })),
      });
      calls.delete(key(message.toolCallId));
    }
  }
  return {
    completed,
    unfinished: [...calls.values()].map(({ name, callId }) => ({ name, callId })),
    inspectQueried: completed.some((c) => c.name === 'cordis_inspect_query' && c.success),
    officialSkillLoaded: completed.some((c) => c.skills.length > 0),
    boundary:
      'Successful native tool receipts and exact registered official Skill body/source. Tool use proves integration, not comprehension, autonomous preference or causal quality gain.',
  };
}

/** Structural AST evidence, deliberately excluding prose changes. Not a behavioral equivalence proof. */
export function implementationShape(source, filename = 'index.mjs') {
  const tree = parse(source, {
    sourceType: filename.endsWith('.cjs') ? 'script' : 'module',
    attachComment: false,
    plugins: filename.endsWith('.ts') ? ['typescript'] : [],
  });
  function shape(node) {
    if (Array.isArray(node)) return node.map(shape);
    if (node === null || typeof node !== 'object') return node;
    if (['StringLiteral', 'TemplateElement', 'DirectiveLiteral'].includes(node.type))
      return { type: node.type };
    return Object.fromEntries(
      Object.entries(node)
        .filter(([k]) => !['start', 'end', 'loc', 'extra', 'comments', 'tokens', 'errors'].includes(k))
        .map(([k, v]) => [k, shape(v)]),
    );
  }
  return digest(shape(tree));
}

export function integrationChecks({ calls, mutations, search, validationReports, installed, usage }) {
  const testedMutation = mutations.some(
    (m) =>
      m.executableSyntaxChanged &&
      search.candidates.some(
        (c) =>
          c.digest === m.candidate &&
          c.build &&
          !c.qaError &&
          ['champion', 'rejected'].includes(c.phase) &&
          c.scoredRuns === 4,
      ),
  );
  return {
    inspectorActuallyQueried: calls.some((c) => c.inspectQueried),
    officialSkillActuallyLoaded: calls.some((c) => c.officialSkillLoaded),
    implementationMutationNativelyTested: testedMutation,
    searchTerminal:
      search.pendingSubmissions.length === 0 &&
      search.candidates.every((c) => ['champion', 'rejected', 'qa_failed', 'build_failed'].includes(c.phase)),
    independentValidationComplete:
      validationReports.length === 2 &&
      validationReports.every(
        (r) => r.candidates.length === 1 && r.candidates[0].scoredRuns === 4 && r.candidates[0].complete,
      ),
    originalArchiveInstalled:
      installed?.installed === true &&
      installed?.nativeComposition === true &&
      installed?.inferenceRequested === false,
    modelAccountingComplete:
      usage.complete && usage.reportedTotals?.started > 0 && usage.reportedTotals?.unfinished === 0,
  };
}

export function taskObservations(reports) {
  const samples = reports.flatMap((r) => r.candidates.flatMap((c) => c.samples));
  return {
    reservedTaskSlots: samples.length,
    actualTaskExecutions: samples.filter((s) => s.startedAt !== null).length,
    scoredTaskSlots: samples.filter((s) => s.phase === 'scored').length,
    terminalFailedTaskSlots: samples.filter((s) => ['execution_failed', 'cancelled'].includes(s.phase))
      .length,
  };
}

const exists = async (file) => {
  try {
    await stat(file);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
};

/** Explicit owner action after observers stop. Never invoked on normal completion. */
export async function cancelOwnedRuns(root, runner, cancelRegistered = cancelExecutionTree) {
  const results = [];
  async function cancel(slot, action) {
    try {
      const receipt = await action();
      assert.equal(receipt.outcome, 'cancelled', `${slot}: cancellation did not complete`);
      results.push({ slot, status: 'cancelled', receipt });
    } catch (error) {
      results.push({ slot, status: 'failed', error: String(error) });
    }
  }
  const search = path.join(root, 'search'),
    validation = path.join(root, 'validation');
  if (await exists(path.join(search, 'experiment.sqlite'))) {
    await cancel('search', async () =>
      JSON.parse(await runner('cancel-search', ['cancel', '--root', search])),
    );
  } else results.push({ slot: 'search', status: 'unstarted', reason: 'No initialized experiment ledger' });
  if (
    (await exists(path.join(validation, 'registration.json'))) ||
    (await exists(path.join(validation, 'registration-intent/contract.json')))
  ) {
    await cancel('validation', async () =>
      JSON.parse(await runner('cancel-validation', ['cancel-validation', '--root', validation])),
    );
  } else
    results.push({ slot: 'validation', status: 'unstarted', reason: 'No frozen validation registration' });
  const executions = [];
  for (const directory of ['image-preflight/logs', 'installation/execution']) {
    if (await exists(path.join(root, directory, 'execution-intent.json')))
      executions.push({ directory, role: 'qa' });
  }
  if (executions.length)
    await cancel('registered-acceptance-executions', () => cancelRegistered(root, executions));
  else
    results.push({
      slot: 'registered-acceptance-executions',
      status: 'unstarted',
      reason: 'No registered acceptance execution intent',
    });
  return {
    complete: results.every((r) => r.status !== 'failed'),
    results,
    boundary:
      'Explicit task-owner cancellation of original registered execution identities; observers alone never authorize deletion. No task rerun or name-based container search.',
  };
}

async function reportAt(root) {
  const spec = Experiment.parse(await json(path.join(root, 'experiment.json')));
  const store = new Store(path.join(root, 'experiment.sqlite'), spec, 'read');
  try {
    return { report: await experimentReport(root, store), candidates: store.candidates() };
  } finally {
    store.close();
  }
}

export async function main(args = process.argv.slice(2)) {
  const required = ['root', 'image', 'model', 'isolation', 'controller-ip', 'install-policy'];
  const { values } = parseArgs({
    args,
    options: {
      ...Object.fromEntries(required.map((k) => [k, { type: 'string' }])),
      'check-contracts': { type: 'boolean' },
      help: { type: 'boolean' },
    },
  });
  if (values.help) {
    console.log(
      'node --env-file=<private-env> scripts/verify-native-authoring.mjs --root <NEW> --image <immutable> --model <JSON> --isolation <JSON> --controller-ip <IPv4> --install-policy <JSON> [--check-contracts]\nAt most 20 real task executions; optional probes 3. Check-contracts makes no model calls. Never resume or retry an existing root.',
    );
    return;
  }
  for (const key of required) assert.ok(values[key], `Required --${key}`);
  const image = Image.parse(values.image),
    model = Model.parse(await json(values.model)),
    isolation = Isolation.parse(await json(values.isolation));
  assert.equal(isIP(values['controller-ip']), 4);
  assert.equal(model.provider, 'venus');
  assert.deepEqual(model.credentialEnv, ['VENUS_API_KEY']);
  if (!values['check-contracts'])
    assert.ok(process.env.VENUS_API_KEY, 'Load the private environment file before invoking');
  const secrets = model.credentialEnv.map((key) => process.env[key]).filter(Boolean);
  const redact = (text) => secrets.reduce((s, secret) => s.split(secret).join('[REDACTED]'), String(text));
  const repo = fileURLToPath(new URL('..', import.meta.url));
  await mkdir(path.dirname(path.resolve(values.root)), { recursive: true });
  await mkdir(path.resolve(values.root));
  const root = await realpath(values.root),
    inputs = path.join(root, 'inputs'),
    searchRoot = path.join(root, 'search');
  await mkdir(inputs);
  const abort = new AbortController(),
    interrupt = () => abort.abort(new Error('Acceptance interrupted; original attempts retained'));
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, interrupt);
  const receipt = {
    mode: values['check-contracts'] ? 'contract-check-no-inference' : 'real-native-authoring',
    root,
    startedAt: new Date().toISOString(),
    passed: false,
    boundary:
      'Native integration acceptance and descriptive quality outcomes are separate. One four-task synthetic search is not stable improvement, unseen heldout validation, transfer evidence or a mechanism causal estimate.',
  };
  const run = (label, command, argv, env = { PATH: process.env.PATH }) =>
    runLogged(root, label, command, argv, { cwd: repo, env, secrets, signal: abort.signal });
  try {
    await save(path.join(inputs, 'model.json'), model);
    await save(path.join(inputs, 'isolation.json'), isolation);
    const policy = await json(values['install-policy']);
    await save(path.join(inputs, 'install-policy.json'), policy);
    // One immutable image must contain every host runtime module used by the public controller.
    const modules = (await inventory(path.join(repo, 'dist'))).filter((f) => f.path.endsWith('.js'));
    const imageHashes = await run('runtime-identity', 'docker', [
      'run',
      '--rm',
      '--network=none',
      image,
      'sha256sum',
      ...modules.map((f) => `/app/dist/${f.path}`),
    ]);
    assert.deepEqual(
      imageHashes
        .trim()
        .split('\n')
        .map((line) => line.trim().split(/\s+/)[0]),
      modules.map((f) => f.hash),
      'Host/image runtime differs',
    );
    const references = JSON.parse(
      await run('authoring-references', 'docker', [
        'run',
        '--rm',
        '--network=none',
        image,
        'node',
        '--input-type=module',
        '-e',
        `import{authoringSources}from'/app/dist/native-authoring.js';import{readFile}from'node:fs/promises';import path from'node:path';const manifest=await authoringSources();const documents=await Promise.all(manifest.skills.files.filter(f=>f.file.endsWith('/SKILL.md')).map(async f=>({...f,source:await readFile(path.join(manifest.skills.directory,f.file),'utf8')})));console.log(JSON.stringify({manifest,documents}));`,
      ]),
    );
    const skills = references.documents.map((d) => {
      assert.equal(sha256(d.source), d.sha256);
      const front = /^---\r?\n[\s\S]*?\r?\n---\r?\n/.exec(d.source);
      assert.ok(front, `Invalid official Skill ${d.file}`);
      const body = d.source.slice(front[0].length).trim();
      assert.ok(body);
      return {
        file: d.file,
        sha256: d.sha256,
        directory: path.posix.dirname(path.posix.join(references.manifest.skills.directory, d.file)),
        body,
        bodySha256: sha256(body),
      };
    });
    assert.ok(skills.length >= 1);
    await save(path.join(inputs, 'native-authoring-sources.json'), { ...references, skills });
    await run('image-preflight', process.execPath, [
      'examples/spreadsheet/verify-image.mjs',
      image,
      path.join(inputs, 'isolation.json'),
      path.join(root, 'image-preflight'),
    ]);
    await mkdir(path.join(inputs, 'generator'));
    for (const name of ['research.py', 'grade.py'])
      await cp(path.join(repo, 'examples/spreadsheet', name), path.join(inputs, 'generator', name));
    await mkdir(path.join(inputs, 'datasets'));
    for (const split of ['development', 'validation']) {
      await run(`generate-${split}`, 'docker', [
        'run',
        '--rm',
        '--network=none',
        '--user',
        `${process.getuid()}:${process.getgid()}`,
        '--mount',
        `type=bind,source=${path.join(inputs, 'generator')},target=/generator,readonly`,
        '--mount',
        `type=bind,source=${path.join(inputs, 'datasets')},target=/datasets`,
        image,
        'python3',
        '-B',
        '/generator/research.py',
        `/datasets/${split}`,
        split,
      ]);
      await run(`prepare-${split}`, process.execPath, [
        'examples/spreadsheet/prepare.mjs',
        path.join(inputs, 'datasets', split),
        image,
        path.join(inputs, 'model.json'),
        path.join(inputs, `${split}-prepared.json`),
        path.join(inputs, 'isolation.json'),
      ]);
    }
    const contracts = acceptanceContracts(
      await json(path.join(inputs, 'development-prepared.json')),
      await json(path.join(inputs, 'validation-prepared.json')),
    );
    await save(path.join(inputs, 'search.json'), contracts.search);
    await save(path.join(inputs, 'assessment.json'), contracts.assessment);
    const seed = path.join(inputs, 'seed');
    await freeze(path.join(repo, 'examples/spreadsheet/seed'), seed, path.join(root, 'publications'));
    // Validate install policy before any paid call, with the same exact schema used for delivery.
    installationConfig(
      { identity: {} },
      { runtime: contracts.search.runtime, model, composition: null, environment: null },
      policy,
    );
    receipt.registration = {
      protocol: 'native-authoring-acceptance',
      image,
      allocation: contracts.allocation,
      search: contracts.search,
      assessment: contracts.assessment,
      seedDigest: await treeDigest(seed),
      datasets: {
        development: await treeDigest(path.join(inputs, 'datasets/development')),
        validation: await treeDigest(path.join(inputs, 'datasets/validation')),
      },
      references: references.manifest,
      inputDigest: await treeDigest(inputs),
      runtimeModules: modules,
      driverSha256: await fileDigest(fileURLToPath(import.meta.url)),
      installationProgramSha256: sha256(installationProgram),
      commandSha256: await fileDigest(path.join(repo, 'dist/command.js')),
      checks: [
        'actual successful cordis_inspect_query',
        'actual official Skill receipt with exact body and source',
        'non-prose JS/TS/Python AST change in a nonbaseline candidate with native QA and 4 scored tasks',
        'complete H0/Hstar independent validation',
        'original champion archive native installation',
        'complete real-model ledgers',
      ],
      quality:
        'Full denominator; zero/tie/negative gain is not an integration failure. Source/AST changes always compare to registered H0; declared parents remain separate lineage facts. No forced probe, topology or predetermined repair. Structural code change does not prove beneficial behavior.',
    };
    await save(path.join(root, 'registration.json'), receipt.registration);
    if (values['check-contracts']) {
      receipt.passed = true;
      receipt.inferenceRequested = false;
    } else {
      await run('initialize', process.execPath, [
        'dist/cli.js',
        'init',
        '--root',
        searchRoot,
        '--spec',
        path.join(inputs, 'search.json'),
        '--dataset',
        path.join(inputs, 'datasets/development'),
        '--seed',
        seed,
      ]);
      await run(
        'evolve',
        process.execPath,
        [
          'dist/cli.js',
          'evolve',
          '--root',
          searchRoot,
          '--host',
          '0.0.0.0',
          '--port',
          '0',
          '--endpoint',
          `http://${values['controller-ip']}:0`,
        ],
        { PATH: process.env.PATH, VENUS_API_KEY: process.env.VENUS_API_KEY },
      );
      const state = await reportAt(searchRoot);
      receipt.search = state.report;
      const baseline = state.candidates.find((c) => c.ordinal === 0),
        champion = state.candidates.find((c) => c.digest === state.report.currentChampion);
      assert.ok(baseline?.build && champion?.build, 'No frozen baseline and final champion available');
      const arms = [
        ['h0', baseline],
        ['selected', champion],
      ].map(([id, c]) => ({
        id,
        source: path.join(searchRoot, 'candidates', c.digest),
        digest: c.digest,
        artifact: path.join(searchRoot, 'artifacts', c.digest),
        build: c.build,
      }));
      await save(path.join(root, 'validation-arms.json'), arms);
      await run(
        'validate',
        process.execPath,
        [
          'dist/cli.js',
          'validate',
          '--root',
          path.join(root, 'validation'),
          '--spec',
          path.join(inputs, 'assessment.json'),
          '--dataset',
          path.join(inputs, 'datasets/validation'),
          '--arms',
          path.join(root, 'validation-arms.json'),
        ],
        { PATH: process.env.PATH, VENUS_API_KEY: process.env.VENUS_API_KEY },
      );
      receipt.validation = await json(path.join(root, 'validation/comparison.json'));
      receipt.validationReports = await Promise.all(
        arms.map(async (arm) => (await reportAt(path.join(root, 'validation/arms', arm.id))).report),
      );
      receipt.selectedIsBaseline = champion.digest === baseline.digest;
      receipt.authoringCalls = [];
      for (const episode of state.report.optimizer.episodes) {
        const raw = await readFile(
          path.join(searchRoot, 'optimizer', String(episode.episode), 'trace/notifications.jsonl'),
          'utf8',
        );
        receipt.authoringCalls.push({
          episode: episode.episode,
          ...authoringEvidence(raw.trim().split('\n').filter(Boolean).map(JSON.parse), skills),
        });
      }
      receipt.mutations = [];
      for (const candidate of state.candidates.filter((c) => c.ordinal !== 0)) {
        const comparisonBase = baseline.digest,
          before = path.join(searchRoot, 'candidates', comparisonBase),
          after = path.join(searchRoot, 'candidates', candidate.digest);
        const old = new Map((await inventory(before)).map((f) => [f.path, f.hash])),
          current = new Map((await inventory(after)).map((f) => [f.path, f.hash]));
        const files = [...new Set([...old.keys(), ...current.keys()])]
          .sort()
          .filter((f) => old.get(f) !== current.get(f));
        const syntax = [];
        for (const file of files.filter((f) => /\.(?:mjs|cjs|js|ts)$/.test(f))) {
          try {
            const left = old.has(file)
              ? implementationShape(await readFile(path.join(before, file), 'utf8'), file)
              : null;
            const right = current.has(file)
              ? implementationShape(await readFile(path.join(after, file), 'utf8'), file)
              : null;
            syntax.push({ file, before: left, after: right, changed: left !== right });
          } catch (error) {
            syntax.push({ file, changed: null, classificationError: String(error) });
          }
        }
        const pyFiles = files.filter((f) => f.endsWith('.py'));
        if (pyFiles.length) {
          const program = `import ast,json,pathlib\nclass Strip(ast.NodeTransformer):\n def visit_Constant(self,n):\n  return ast.Constant(value='') if isinstance(n.value,str) else n\ndef shape(root,p):\n f=pathlib.Path(root)/p\n return ast.dump(Strip().visit(ast.parse(f.read_text())),include_attributes=False) if f.exists() else None\ndef compare(p):\n try: return {'file':p,'changed':shape('/before',p)!=shape('/after',p)}\n except SyntaxError as e: return {'file':p,'changed':None,'classificationError':str(e)}\nprint(json.dumps([compare(p) for p in json.loads(${JSON.stringify(JSON.stringify(pyFiles))})]))`;
          syntax.push(
            ...JSON.parse(
              await run(`python-ast-${candidate.ordinal}`, 'docker', [
                'run',
                '--rm',
                '--network=none',
                '--mount',
                `type=bind,source=${before},target=/before,readonly`,
                '--mount',
                `type=bind,source=${after},target=/after,readonly`,
                image,
                'python3',
                '-c',
                program,
              ]),
            ),
          );
        }
        receipt.mutations.push({
          candidate: candidate.digest,
          comparisonBase,
          comparisonRelationship: 'registered H0 reference; not an inferred parent',
          declaredParents: candidate.proposal.parents,
          files: files.map((file) => ({
            file,
            before: old.get(file) ?? null,
            after: current.get(file) ?? null,
          })),
          syntax,
          executableSyntaxChanged: syntax.some((s) => s.changed),
          assemblyChanged: files.includes(contracts.search.candidate.patch),
          boundary:
            'AST shape changes exclude literal prose and comments; semantic validity, live invocation and benefit require source/trace review. Other languages are recorded as byte changes, not classified.',
        });
      }
      const archive = path.join(root, 'export');
      await run('export', process.execPath, [
        'dist/cli.js',
        'export',
        '--root',
        searchRoot,
        '--candidate',
        champion.digest,
        '--output',
        archive,
      ]);
      await verifyArtifact(path.join(archive, 'artifact'), champion.digest, champion.build);
      const install = path.join(root, 'installation');
      await mkdir(path.join(install, 'work'), { recursive: true });
      await writeFile(path.join(install, 'install.mjs'), installationProgram, { flag: 'wx' });
      await cp(path.join(repo, 'dist/command.js'), path.join(install, 'command.mjs'));
      assert.equal(await fileDigest(path.join(install, 'command.mjs')), receipt.registration.commandSha256);
      const environment = contracts.search.runtime.environment;
      const environmentPath = environment ? path.join(searchRoot, 'dataset', environment.directory) : null;
      if (environmentPath) assert.equal(await treeDigest(environmentPath), environment.digest);
      await save(path.join(install, 'config.json'), {
        ...installationConfig(
          { identity: champion.build },
          { runtime: contracts.search.runtime, model, composition: null, environment },
          policy,
        ),
        timeoutSeconds: 480,
      });
      const installResult = await new Docker().run(
        {
          name: `he-native-authoring-install-${randomUUID()}`,
          image,
          isolation,
          network: isolation.network.build,
          timeoutSeconds: 480,
          command: ['node', '/acceptance/install.mjs'],
          env: {},
          mounts: [
            { source: install, target: '/acceptance', writable: false },
            { source: path.join(install, 'work'), target: '/workspace', writable: true },
            { source: path.join(archive, 'artifact'), target: '/artifact', writable: false },
            ...(environment
              ? [
                  {
                    source: environmentPath,
                    target: '/environment',
                    writable: false,
                  },
                ]
              : []),
          ],
        },
        path.join(install, 'execution'),
        abort.signal,
      );
      assert.equal(installResult.ExitCode, 0, 'Exact original archive installation failed');
      receipt.installed = await json(path.join(install, 'work/installed.json'));
      await verifyArtifact(path.join(archive, 'artifact'), champion.digest, champion.build);
      if (environmentPath) assert.equal(await treeDigest(environmentPath), environment.digest);
      assert.equal(await treeDigest(inputs), receipt.registration.inputDigest, 'Registered inputs changed');
      receipt.usage = sumUsage(
        [state.report, ...receipt.validationReports].flatMap((r) => [
          ...r.candidates.flatMap((c) => c.samples.map((s) => s.usage)),
          ...r.optimizer.episodes.map((e) => e.usage),
        ]),
      );
      receipt.taskObservations = taskObservations([state.report, ...receipt.validationReports]);
      assert.ok(receipt.taskObservations.reservedTaskSlots <= 20);
      receipt.checks = integrationChecks({
        calls: receipt.authoringCalls,
        mutations: receipt.mutations,
        search: state.report,
        validationReports: receipt.validationReports,
        installed: receipt.installed,
        usage: receipt.usage,
      });
      receipt.passed = Object.values(receipt.checks).every(Boolean);
    }
  } catch (error) {
    receipt.error = redact(error.stack ?? error);
    // Failure snapshots are authoritative read-only projections, never recovery or re-execution.
    try {
      receipt.search = (await reportAt(searchRoot)).report;
    } catch (snapshotError) {
      receipt.searchSnapshotError = redact(snapshotError);
    }
    receipt.passed = false;
  } finally {
    for (const signal of ['SIGINT', 'SIGTERM']) process.removeListener(signal, interrupt);
    if (abort.signal.aborted) {
      try {
        receipt.ownerCancellation = await cancelOwnedRuns(root, (label, argv) =>
          runLogged(root, label, process.execPath, ['dist/cli.js', ...argv], {
            cwd: repo,
            env: { PATH: process.env.PATH },
            secrets,
          }),
        );
      } catch (error) {
        receipt.ownerCancellation = { complete: false, error: redact(error) };
      }
      await save(path.join(root, 'owner-cancellation.json'), receipt.ownerCancellation);
      receipt.passed = false;
    }
    if (!values['check-contracts']) {
      receipt.terminalReports = [];
      for (const [slot, folder] of [
        ['search', searchRoot],
        ['validation-h0', path.join(root, 'validation/arms/h0')],
        ['validation-selected', path.join(root, 'validation/arms/selected')],
      ]) {
        try {
          receipt.terminalReports.push({ slot, report: (await reportAt(folder)).report });
        } catch (error) {
          receipt.terminalReports.push({ slot, report: null, error: redact(error) });
        }
      }
      const observed = receipt.terminalReports.flatMap((s) => (s.report ? [s.report] : []));
      receipt.usage = sumUsage(
        observed.flatMap((r) => [
          ...r.candidates.flatMap((c) => c.samples.map((s) => s.usage)),
          ...r.optimizer.episodes.map((e) => e.usage),
        ]),
      );
      receipt.taskObservations = taskObservations(observed);
      receipt.allocationObserved = {
        taskCeiling: 20,
        ...receipt.taskObservations,
        missingStudyArms: receipt.terminalReports.filter((s) => s.report === null).map((s) => s.slot),
      };
      if (receipt.taskObservations.reservedTaskSlots > 20) {
        receipt.passed = false;
        receipt.allocationError = 'Task allocation exceeded';
      }
    }
    receipt.state = abort.signal.aborted
      ? receipt.ownerCancellation.complete
        ? 'cancelled'
        : 'cancellation-failed'
      : receipt.passed
        ? 'passed'
        : 'failed';
    receipt.driverCompletedAt = new Date().toISOString();
    if (abort.signal.aborted)
      receipt.interruptionBoundary =
        'Observer interruption was followed by explicit owner cancellation. Only successful original-identity cancellation receipts certify cleanup; failed cleanup remains actionable.';
    await save(path.join(root, 'acceptance.json'), receipt);
  }
  return receipt;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main()
    .then((result) => {
      if (result) {
        console.log(JSON.stringify({ root: result.root, passed: result.passed, mode: result.mode }));
        if (!result.passed) process.exitCode = 1;
      }
    })
    .catch((error) => {
      console.error(String(error));
      process.exitCode = 1;
    });
