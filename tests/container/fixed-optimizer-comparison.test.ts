import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { atomicJSON, digest, fileDigest, freeze, treeDigest } from '../../src/artifacts.js';
import { buildBundle } from '../../src/build.js';
import { Docker, command } from '../../src/docker.js';
import { Experiment } from '../../src/contracts.js';
import {
  FixedOptimizerComparison,
  type FrozenStudyBundleRef,
  type FrozenStudyMethodRef,
} from '../../src/optimizer-study-contracts.js';
import { containerSpecification } from '../fixtures.js';

test(
  'fixed comparison CLI executes every frozen method with real native search, independent assessment and no meta session',
  { timeout: 600_000 },
  async () => {
    const image = process.env.HE_TEST_IMAGE;
    assert.ok(image, 'HE_TEST_IMAGE must name the explicit immutable tested image');
    assert.match(image, /^sha256:[0-9a-f]{64}$/);
    const base = containerSpecification();
    await mkdir('.evolution', { recursive: true });
    const root = await mkdtemp(path.resolve('.evolution/fixed-comparison-native-'));
    console.log(`Fixed comparison native evidence retained: ${root}`);
    const runtimeFiles = [
      'runtime/worker.js',
      'runtime/build.js',
      'runtime/qa.js',
      'plugin.js',
      'preset.js',
      'composition.js',
    ];
    const imageHashes = (
      await command('docker', [
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
    const verifiedRuntime = [];
    for (const [index, file] of runtimeFiles.entries()) {
      const expected = await fileDigest(path.join('dist', file));
      assert.equal(imageHashes[index]!.split(/\s+/)[0], expected, `Image runtime differs: ${file}`);
      verifiedRuntime.push({ file: `dist/${file}`, sha256: expected });
    }
    const inputs = path.join(root, 'inputs'),
      study = path.join(root, 'study');
    await mkdir(inputs);
    const docker = new Docker();
    const build = { image, timeoutSeconds: 120 };
    const createBundle = async (id: string, files: Record<string, string>): Promise<FrozenStudyBundleRef> => {
      const source = path.join(root, 'source', id);
      await mkdir(source, { recursive: true });
      const name = `@harness-evolution/fixed-protocol-${id}`;
      const manifest = {
        name,
        version: '1.0.0',
        type: 'module',
        scripts: { build: 'node --check index.mjs' },
        files: ['index.mjs', 'plugins.yml', 'cordis.patch.yml'],
        dsh: { bundle: { patch: './cordis.patch.yml' } },
      };
      await atomicJSON(path.join(source, 'package.json'), manifest);
      await atomicJSON(path.join(source, 'package-lock.json'), {
        name,
        version: '1.0.0',
        lockfileVersion: 3,
        packages: { '': { name, version: '1.0.0' } },
      });
      for (const [name, text] of Object.entries(files)) await writeFile(path.join(source, name), text);
      const sourceDigest = await treeDigest(source),
        buildRoot = path.join(root, 'build', id);
      await freeze(
        source,
        path.join(buildRoot, 'candidates', sourceDigest),
        path.join(buildRoot, 'publications'),
      );
      const identity = await buildBundle(
        buildRoot,
        digest([root, id]),
        sourceDigest,
        build,
        base.isolation,
        docker,
      );
      const value = {
        source: { directory: `bundles/${id}/source`, digest: sourceDigest },
        artifact: { directory: `bundles/${id}/artifact`, identity },
      };
      await freeze(source, path.join(inputs, value.source.directory), path.join(root, 'publications'));
      await freeze(
        path.join(buildRoot, 'artifacts', sourceDigest),
        path.join(inputs, value.artifact.directory),
        path.join(root, 'publications'),
      );
      return value;
    };
    const seed = await createBundle('h0', {
      'index.mjs': await readFile(new URL('./fixture.mjs', import.meta.url), 'utf8'),
      'cordis.patch.yml': '- insert:\n    - name: ./index.mjs\n',
    });
    const arms: Array<{
      id: string;
      method: FrozenStudyMethodRef;
      hostSearchProtocol: typeof base.hostSearchProtocol;
    }> = [];
    for (const mode of ['direct', 'inspect', 'failure']) {
      const bundle = await createBundle(mode, {
        'index.mjs': `export const inject = ['systemPrompt'];\nexport function apply(ctx) { ctx.systemPrompt.section({name:'fixed-method',order:501,text:'fixed-comparison-fixture:${mode}'}); }\n`,
        'plugins.yml': '- id: fixed-method\n  name: ./index.mjs\n',
        'cordis.patch.yml': '- insert:\n    - id: fixed-method\n      name: ./index.mjs\n',
      });
      arms.push({
        id: mode,
        method: { ...bundle, composition: 'plugins.yml' },
        hostSearchProtocol: base.hostSearchProtocol,
      });
    }
    const caseContract = async (role: 'search' | 'assessment') => {
      const directory = `case/${role}`,
        home = path.join(inputs, directory);
      for (const area of ['input', 'evaluation', 'environment'])
        await mkdir(path.join(home, area), { recursive: true });
      await writeFile(path.join(home, 'input/message.txt'), role);
      await writeFile(path.join(home, 'evaluation/expected.txt'), role.toUpperCase());
      await writeFile(
        path.join(home, 'evaluation/grade.mjs'),
        `import {readFile,writeFile} from 'node:fs/promises';\nconst actual=await readFile('/delivery/result.txt','utf8');const expected=await readFile('/evaluation/expected.txt','utf8');await writeFile('/workspace/result.json',JSON.stringify({score:Number(actual===expected),metrics:{},feedback:actual===expected?'Exact match':'Mismatch'}));\n`,
      );
      await cp(
        new URL('./fixed-comparison-provider.mjs', import.meta.url),
        path.join(home, 'environment/provider.mjs'),
      );
      await writeFile(
        path.join(home, 'environment/cordis.patch.yml'),
        '- insert:\n    - name: ./provider.mjs\n',
      );
      const specification = Experiment.parse({
        ...base,
        name: `fixed-${role}`,
        purpose: role === 'search' ? 'search' : 'validation',
        runtime: {
          image,
          dshVersion: base.runtime.dshVersion,
          profile: 'sdk',
          environment: {
            directory: 'environment',
            digest: await treeDigest(path.join(home, 'environment')),
            patch: 'cordis.patch.yml',
          },
        },
        optimizer: {
          ...base.optimizer,
          provider: 'fixed-comparison-fixture',
          model: 'fixture',
          reasoningEffort: null,
        },
        executor: { ...base.executor, provider: 'container-fixture', model: 'fixture' },
        optimizerHarness: {
          kind: 'artifact',
          source: arms[0]!.method.source,
          artifact: arms[0]!.method.artifact,
          composition: 'plugins.yml',
        },
        candidate: { patch: 'cordis.patch.yml', build, qa: null },
        tasks: [
          {
            id: role,
            prompt: 'Use fixture_deliver to process the public input.',
            input: 'input',
            evaluation: 'evaluation',
            inputDigest: await treeDigest(path.join(home, 'input')),
            evaluationDigest: await treeDigest(path.join(home, 'evaluation')),
          },
        ],
        evaluator: { image, command: ['node', '/evaluation/grade.mjs'], timeoutSeconds: 30 },
        concurrency: 1,
        repetitions: 1,
        failureLimit: 0,
        timeoutSeconds: 60,
        budget: { candidates: role === 'search' ? 2 : 1, optimizerSeconds: 60 },
        probes: null,
      });
      return { specification, dataset: { directory, digest: await treeDigest(home) } };
    };
    const spec = FixedOptimizerComparison.parse({
      kind: 'fixed-comparison',
      name: 'native-fixed-comparison',
      objective: 'Exercise native fixed method comparison, no autonomous mutation or quality-gain claim',
      baseline: 'direct',
      arms,
      cases: [
        {
          id: 'public-protocol-case',
          seed,
          search: await caseContract('search'),
          assessment: await caseContract('assessment'),
        },
      ],
      repetitions: 1,
      budget: { concurrentSearches: 1 },
    });
    const specFile = path.join(root, 'comparison.json');
    await atomicJSON(specFile, spec);
    const cli = async (label: string, args: string[]) => {
      const output = await command(process.execPath, ['dist/cli.js', ...args], { timeoutMs: 480_000 });
      await writeFile(path.join(root, `${label}.log`), output, { flag: 'wx' });
      return output;
    };
    await cli('register', ['study-init', '--root', study, '--spec', specFile, '--dataset', inputs]);
    const hostIP = (
      await command('docker', [
        'run',
        '--rm',
        '--network=bridge',
        '--add-host=host.docker.internal:host-gateway',
        image,
        'getent',
        'ahostsv4',
        'host.docker.internal',
      ])
    ).split(/\s+/)[0]!;
    const runArgs = [
      'study-run',
      '--root',
      study,
      '--child-endpoint',
      `http://${hostIP}:0`,
      '--child-host',
      '0.0.0.0',
    ];
    await cli('run', runArgs);
    const reportFile = path.join(root, 'report.json');
    await cli('report', ['study-report', '--root', study, '--output', reportFile]);
    const report = JSON.parse(await readFile(reportFile, 'utf8'));
    assert.equal(report.state.phase, 'complete');
    assert.equal(report.protocol, 'fixed-comparison');
    assert.equal(report.state.selectedMethod, undefined);
    assert.equal(report.methods.length, 3);
    assert.equal(report.jobs.length, 3);
    assert.equal(report.metaEpisodes.length, 0);
    assert.deepEqual(
      report.comparison.arms.map(
        (arm: { id: string; denominator: number; failures: number; mean: number }) => ({
          id: arm.id,
          denominator: arm.denominator,
          failures: arm.failures,
          mean: arm.mean,
        }),
      ),
      [
        { id: 'direct', denominator: 1, failures: 0, mean: 1 },
        { id: 'inspect', denominator: 1, failures: 0, mean: 1 },
        { id: 'failure', denominator: 1, failures: 1, mean: 0 },
      ],
    );
    assert.equal(report.comparison.arms[2].pairedMeanDelta, -1);
    assert.equal(report.accounting.metaUsage.status, 'not-applicable');
    assert.equal(
      report.accounting.totalUsage.complete,
      false,
      'Failed method has no assessment ledger or reported token usage',
    );
    for (const job of report.jobs.filter((job: { phase: string }) => job.phase === 'complete')) {
      assert.equal(job.selectedHarness.source.digest, seed.source.digest);
      assert.deepEqual(job.selectedHarness.artifact.identity, seed.artifact.identity);
    }
    await assert.rejects(readFile(path.join(study, 'meta-controller-token')), { code: 'ENOENT' });
    const evidenceFiles: Array<{ path: string; sha256: string }> = [];
    const inspect = async (home: string) => {
      for (const item of await readdir(home, { withFileTypes: true })) {
        const file = path.join(home, item.name);
        if (item.isDirectory()) await inspect(file);
        else if (
          ['execution-record.json', 'requests.jsonl', 'fixed-comparison-requests.jsonl'].includes(item.name)
        )
          evidenceFiles.push({ path: path.relative(study, file), sha256: await fileDigest(file) });
      }
    };
    await inspect(study);
    // A failed G can interrupt its concurrent H0 observer. Measure original ledgers rather
    // than assuming how many H0 requests happened before that failure.
    const observedRequests = { started: 0, results: 0, failed: 0, unfinished: 0 };
    for (const file of evidenceFiles.filter((file) => file.path.endsWith('/trace/requests.jsonl'))) {
      const entries = (await readFile(path.join(study, file.path), 'utf8'))
        .trim()
        .split('\n')
        .filter((line) => line.length > 0)
        .map((line) => JSON.parse(line));
      const started = entries.filter((entry) => entry.kind === 'started');
      const terminal = entries.filter((entry) => entry.kind === 'result' || entry.kind === 'failed');
      assert.equal(new Set(started.map((entry) => entry.id)).size, started.length);
      for (const entry of terminal) assert.equal(started.filter((start) => start.id === entry.id).length, 1);
      for (const entry of started) assert.ok(terminal.filter((finish) => finish.id === entry.id).length <= 1);
      observedRequests.started += started.length;
      observedRequests.results += terminal.filter((entry) => entry.kind === 'result').length;
      observedRequests.failed += terminal.filter((entry) => entry.kind === 'failed').length;
      observedRequests.unfinished += started.filter(
        (entry) => !terminal.some((finish) => finish.id === entry.id),
      ).length;
    }
    for (const [key, count] of Object.entries(observedRequests))
      assert.equal(report.accounting.totalUsage.reportedTotals[key], count, `Original ledger total: ${key}`);
    const methodRequests = evidenceFiles.filter((file) =>
      file.path.endsWith('fixed-comparison-requests.jsonl'),
    );
    assert.equal(methodRequests.length, 3);
    const methodCallCounts: Record<string, number> = {};
    for (const file of methodRequests) {
      const entries = (await readFile(path.join(study, file.path), 'utf8'))
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
      assert.ok(entries.every((entry) => entry.tools.includes('evolution_finish')));
      assert.ok(
        entries.every((entry) => !entry.tools.some((tool: string) => tool.startsWith('optimizer_study_'))),
      );
      assert.ok(entries.every((entry) => entry.mode === entries[0].mode));
      methodCallCounts[entries[0].mode] = entries.length;
    }
    assert.deepEqual(methodCallCounts, { direct: 2, inspect: 3, failure: 1 });
    const failedJob = report.jobs.find((job: { phase: string }) => job.phase === 'failed');
    const failureLedger = (
      await readFile(path.join(study, failedJob.childRoot, 'optimizer/0/trace/requests.jsonl'), 'utf8')
    )
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    assert.deepEqual(
      failureLedger.filter((entry) => entry.kind === 'failed').map((entry) => entry.error.message),
      ['Deliberate frozen method protocol failure'],
    );
    await cli('resume', runArgs);
    for (const file of evidenceFiles)
      assert.equal(await fileDigest(path.join(study, file.path)), file.sha256);
    const after: string[] = [];
    const inventory = async (home: string) => {
      for (const item of await readdir(home, { withFileTypes: true })) {
        const file = path.join(home, item.name);
        if (item.isDirectory()) await inventory(file);
        else if (
          ['execution-record.json', 'requests.jsonl', 'fixed-comparison-requests.jsonl'].includes(item.name)
        )
          after.push(path.relative(study, file));
      }
    };
    await inventory(study);
    assert.deepEqual(after.sort(), evidenceFiles.map((file) => file.path).sort());
    await atomicJSON(path.join(root, 'acceptance.json'), {
      passed: true,
      image,
      verifiedRuntime,
      registrationDigest: digest(spec),
      reportSha256: await fileDigest(reportFile),
      expectedMethods: 3,
      completedSearches: 2,
      failedSearches: 1,
      metaEpisodes: 0,
      methodCallCounts,
      observedRequests,
      resumeUnchanged: true,
      evidenceFiles,
      boundary:
        'Actual Docker and DSH Agent Loop/tools, CLI registration and final assessment. Deterministic adapters, no paid model or scientific efficacy claim.',
    });
  },
);
