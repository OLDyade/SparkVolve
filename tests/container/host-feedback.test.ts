import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Context } from '@deepseek-ai/cordis';
import SystemPrompt from '@deepseek-ai/dsh-system-prompt';
import Tools from '@deepseek-ai/dsh-tools';
import { ToolCallId } from '@deepseek-ai/dsh-llm';
import { atomicJSON, digest, fileDigest, freeze, treeDigest } from '../../src/artifacts.js';
import { buildBundle } from '../../src/build.js';
import { Docker, command } from '../../src/docker.js';
import { Experiment } from '../../src/contracts.js';
import { Controller } from '../../src/controller.js';
import { Store } from '../../src/store.js';
import { serve } from '../../src/api.js';
import * as Evolution from '../../src/plugin.js';
import { FixedOptimizerComparison, type FrozenStudyBundleRef } from '../../src/optimizer-study-contracts.js';
import { containerSpecification } from '../fixtures.js';

/** Include decoded evidence bytes, so base64 is never mistaken for information hiding. */
function visibleText(value: unknown): string {
  const output: string[] = [];
  const visit = (item: unknown): void => {
    if (typeof item === 'string') {
      output.push(item);
      try {
        visit(JSON.parse(item));
      } catch {
        /* Native prose and errors need not be JSON. */
      }
    } else if (item && typeof item === 'object') {
      const object = item as Record<string, unknown>;
      if (object.encoding === 'base64' && typeof object.data === 'string')
        output.push(Buffer.from(object.data, 'base64').toString('utf8'));
      for (const child of Object.values(object)) visit(child);
    }
  };
  visit(value);
  return output.join('\n');
}

function assertMechanicalPayload(value: unknown): void {
  if (!value || typeof value !== 'object') return;
  const object = value as Record<string, unknown>;
  for (const key of ['champion', 'mean', 'runs', 'grade', 'score', 'constraintsSatisfied'])
    assert.ok(!(key in object), `Mechanical tool response contains quality field: ${key}`);
  if ('phase' in object) assert.ok(!['champion', 'rejected', 'scored'].includes(String(object.phase)));
  if ('type' in object) {
    assert.notEqual(object.type, 'candidate.decision');
    assert.ok(!String(object.type).startsWith('run.'));
  }
  for (const child of Object.values(object)) assertMechanicalPayload(child);
}

async function executionEvidence(home: string): Promise<Array<{ path: string; sha256: string }>> {
  const result: Array<{ path: string; sha256: string }> = [];
  const inspect = async (directory: string): Promise<void> => {
    for (const item of await readdir(directory, { withFileTypes: true })) {
      const file = path.join(directory, item.name);
      if (item.isDirectory()) await inspect(file);
      else if (
        ['execution-record.json', 'requests.jsonl', 'host-feedback-requests.jsonl'].includes(item.name)
      )
        result.push({ path: path.relative(home, file), sha256: await fileDigest(file) });
    }
  };
  await inspect(home);
  return result.sort((a, b) => a.path.localeCompare(b.path));
}

test(
  'same frozen G runs full/mechanical host views through actual DSH containers and independent assessment',
  { timeout: 600_000 },
  async () => {
    const image = process.env.HE_TEST_IMAGE;
    assert.ok(image, 'HE_TEST_IMAGE must name the immutable tested runtime image');
    assert.match(image, /^sha256:[0-9a-f]{64}$/);
    const base = containerSpecification();
    await mkdir('.evolution', { recursive: true });
    const root = await mkdtemp(path.resolve('.evolution/host-feedback-native-'));
    console.log(`Host feedback native evidence retained: ${root}`);
    const runtimeFiles = [
      'runtime/worker.js',
      'runtime/build.js',
      'runtime/qa.js',
      'plugin.js',
      'preset.js',
      'composition.js',
      'api.js',
      'optimizer-access.js',
      'optimizer.js',
      'optimizer-study.js',
      'optimizer-study-contracts.js',
      'optimizer-study-store.js',
      'optimizer-study-runner.js',
      'optimizer-study-report.js',
      'evidence.js',
      'contracts.js',
      'control-routes.js',
      'controller.js',
      'experiment.js',
    ];
    const runtimeHashes = (
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
      assert.equal(runtimeHashes[index]!.split(/\s+/)[0], expected, `Stale image file: ${file}`);
      verifiedRuntime.push({ file: `dist/${file}`, sha256: expected });
    }
    const inputs = path.join(root, 'inputs'),
      study = path.join(root, 'study');
    await mkdir(inputs);
    const build = { image, timeoutSeconds: 120 };
    const docker = new Docker();
    const bundle = async (id: string, files: Record<string, string>): Promise<FrozenStudyBundleRef> => {
      const source = path.join(root, 'source', id);
      await mkdir(source, { recursive: true });
      const name = `@harness-evolution/feedback-protocol-${id}`;
      await atomicJSON(path.join(source, 'package.json'), {
        name,
        version: '1.0.0',
        type: 'module',
        scripts: { build: 'node --check index.mjs' },
        files: ['index.mjs', 'plugins.yml', 'cordis.patch.yml'],
        dsh: { bundle: { patch: './cordis.patch.yml' } },
      });
      await atomicJSON(path.join(source, 'package-lock.json'), {
        name,
        version: '1.0.0',
        lockfileVersion: 3,
        packages: { '': { name, version: '1.0.0' } },
      });
      for (const [file, text] of Object.entries(files)) await writeFile(path.join(source, file), text);
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
      const reference = {
        source: { directory: `bundles/${id}/source`, digest: sourceDigest },
        artifact: { directory: `bundles/${id}/artifact`, identity },
      };
      await freeze(source, path.join(inputs, reference.source.directory), path.join(root, 'publications'));
      await freeze(
        path.join(buildRoot, 'artifacts', sourceDigest),
        path.join(inputs, reference.artifact.directory),
        path.join(root, 'publications'),
      );
      return reference;
    };
    const original = await readFile(new URL('./fixture.mjs', import.meta.url), 'utf8');
    const replacement = "await writeFile('/workspace/result.txt', input.toUpperCase());";
    assert.equal(original.split(replacement).length, 2, 'Fixture source seam must be exact');
    const seed = await bundle('h0', {
      'index.mjs':
        "import {randomUUID} from 'node:crypto';\n" +
        original.replace(
          replacement,
          "const nonce = 'delivery-' + randomUUID(); await writeFile('/workspace/result.txt', JSON.stringify({value:input.toUpperCase(),nonce})); await writeFile('/trace/feedback-private.txt','trace-' + randomUUID());",
        ),
      'cordis.patch.yml': '- insert:\n    - name: ./index.mjs\n',
    });
    const method = {
      ...(await bundle('shared-g', {
        'index.mjs':
          "export const inject=['systemPrompt']; export function apply(ctx){ctx.systemPrompt.section({name:'host-feedback-protocol',order:501,text:'Drive the registered host feedback protocol fixture. No scientific efficacy claim.'});}\n",
        'plugins.yml': '- id: shared-method\n  name: ./index.mjs\n',
        'cordis.patch.yml': '- insert:\n    - id: shared-method\n      name: ./index.mjs\n',
      })),
      composition: 'plugins.yml',
    };
    const caseContract = async (role: 'search' | 'assessment') => {
      const directory = `case/${role}`,
        home = path.join(inputs, directory);
      for (const area of ['input', 'evaluation', 'environment'])
        await mkdir(path.join(home, area), { recursive: true });
      await writeFile(path.join(home, 'input/message.txt'), role);
      await writeFile(path.join(home, 'evaluation/expected.txt'), role.toUpperCase());
      await writeFile(
        path.join(home, 'evaluation/grade.mjs'),
        "import {readFile,writeFile} from 'node:fs/promises'; import {randomUUID} from 'node:crypto'; const actual=JSON.parse(await readFile('/delivery/result.txt','utf8')); const expected=await readFile('/evaluation/expected.txt','utf8'); await writeFile('/workspace/result.json',JSON.stringify({score:Number(actual.value===expected),metrics:{},feedback:'grade-'+randomUUID()}));\n",
      );
      await cp(
        new URL('./host-feedback-provider.mjs', import.meta.url),
        path.join(home, 'environment/provider.mjs'),
      );
      await writeFile(
        path.join(home, 'environment/cordis.patch.yml'),
        '- insert:\n    - name: ./provider.mjs\n',
      );
      const specification = Experiment.parse({
        ...base,
        name: `feedback-${role}`,
        purpose: role === 'search' ? 'search' : 'validation',
        hostSearchProtocol: { ancestry: 'seed-only', feedback: 'full' },
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
          provider: 'host-feedback-fixture',
          model: 'fixture',
          reasoningEffort: null,
        },
        executor: { ...base.executor, provider: 'container-fixture', model: 'fixture' },
        optimizerHarness: {
          kind: 'artifact',
          source: method.source,
          artifact: method.artifact,
          composition: method.composition,
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
        budget: { candidates: role === 'search' ? 2 : 1, optimizerSeconds: 180 },
        probes: null,
      });
      return { specification, dataset: { directory, digest: await treeDigest(home) } };
    };
    const spec = FixedOptimizerComparison.parse({
      kind: 'fixed-comparison',
      name: 'native-host-feedback',
      objective: 'Verify frozen host feedback access through native runtime; no method efficacy claim',
      baseline: 'full',
      arms: ['full', 'mechanical'].map((feedback) => ({
        id: feedback,
        method,
        hostSearchProtocol: { ancestry: 'seed-only', feedback },
      })),
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
    assert.equal(report.methods.length, 1, 'Same frozen G must not be registered as two methods');
    assert.equal(report.jobs.length, 2);
    assert.equal(new Set(report.jobs.map((job: { method: string }) => job.method)).size, 1);
    assert.equal(new Set(report.jobs.map((job: { comparisonArm: string }) => job.comparisonArm)).size, 2);
    assert.deepEqual(
      report.comparison.arms.map(
        (arm: { id: string; mean: number; failures: number; denominator: number }) => ({
          id: arm.id,
          mean: arm.mean,
          failures: arm.failures,
          denominator: arm.denominator,
        }),
      ),
      [
        { id: 'full', mean: 1, failures: 0, denominator: 1 },
        { id: 'mechanical', mean: 1, failures: 0, denominator: 1 },
      ],
    );
    const before = await executionEvidence(study);
    await cli('resume', runArgs);
    assert.deepEqual(
      await executionEvidence(study),
      before,
      'Terminal reentry must not execute or request again',
    );

    const observations = [];
    for (const job of report.jobs) {
      const childRoot = path.join(study, job.childRoot);
      const childSpec = Experiment.parse(
        JSON.parse(await readFile(path.join(childRoot, 'experiment.json'), 'utf8')),
      );
      const mode = childSpec.hostSearchProtocol.feedback;
      const store = new Store(path.join(childRoot, 'experiment.sqlite'), childSpec);
      const controller = new Controller(childRoot, path.join(childRoot, 'dataset'), childSpec, store);
      await controller.start();
      try {
        const rawRuns = store.runs();
        assert.equal(rawRuns.length, 2, 'Replay must not add an attempt');
        assert.ok(rawRuns.every((run) => run.phase === 'scored' && run.grade?.score === 1));
        assert.equal(store.candidates().length, 2);
        assert.deepEqual(
          rawRuns.map((run) => run.candidate).sort(),
          store
            .candidates()
            .map((candidate) => candidate.digest)
            .sort(),
        );
        assert.equal(store.getMeta('champion'), seed.source.digest, 'Same-score selection keeps the seed');
        const requestFile = path.join(childRoot, 'optimizer/0/trace/host-feedback-requests.jsonl');
        const requests = (await readFile(requestFile, 'utf8'))
          .trim()
          .split('\n')
          .map((line) => JSON.parse(line));
        const transcript = visibleText(requests);
        const nativeSession = JSON.parse(
          await readFile(path.join(childRoot, 'optimizer/0/trace/result.json'), 'utf8'),
        );
        const calls = nativeSession.events.filter((event: { type: string }) => event.type === 'tool/call');
        const toolResponses = nativeSession.events.filter(
          (event: { type: string }) => event.type === 'tool/result',
        );
        assert.equal(
          toolResponses.length,
          calls.length,
          'Every issued native call must have a terminal result',
        );
        let finishObserved = false;
        for (const event of toolResponses) {
          const message = event.data.message;
          const call = calls.find(
            (entry: { data: { callId: string } }) => entry.data.callId === message.toolCallId,
          );
          assert.ok(call, 'Native response must reference its exact call');
          const args = JSON.parse(call.data.arguments);
          const forbidden =
            [
              'evolution_library',
              'evolution_asset',
              'evolution_import',
              'evolution_probe',
              'evolution_probe_evidence',
            ].includes(call.data.name) ||
            (call.data.name === 'evolution_materialize' && ['probe', 'asset'].includes(args.kind)) ||
            (mode === 'mechanical' &&
              (call.data.name === 'evolution_evidence' ||
                (call.data.name === 'evolution_materialize' && args.kind === 'run'))) ||
            (call.data.name === 'evolution_branch' && args.parent !== seed.source.digest) ||
            (call.data.name === 'evolution_submit' && args.parents[0] !== seed.source.digest);
          assert.equal(
            message.isError,
            forbidden,
            `Unexpected native result: ${call.data.name} ${call.data.arguments}`,
          );
          if (message.isError || call.data.name === 'bash') continue;
          const blocks = message.content.filter((block: { type: string }) => block.type === 'text');
          assert.equal(blocks.length, 1, 'Evolution tools return exactly one structured text response');
          const payload = JSON.parse(blocks[0].text);
          if (mode === 'mechanical') assertMechanicalPayload(payload);
          if (call.data.name === 'evolution_wait') {
            assert.equal(payload.cursor.viewDigest, args.viewDigest);
            assert.deepEqual(
              payload.events.map((entry: { sequence: number }) => entry.sequence),
              Array.from({ length: payload.events.length }, (_, index) => args.sequence + index + 1),
            );
            assert.equal(payload.cursor.sequence, args.sequence + payload.events.length);
          }
          if (call.data.name === 'evolution_finish') {
            assert.equal(payload.conclusion.reason, args.reason);
            finishObserved = true;
          }
        }
        assert.equal(
          finishObserved,
          true,
          'Inspect the actual native finish response, including conclude-turn paths',
        );
        const canaries: string[] = [];
        for (const run of rawRuns) {
          canaries.push(String(run.grade!.feedback));
          const delivery = JSON.parse(
            await readFile(path.join(childRoot, 'runs', run.id, 'delivery/result.txt'), 'utf8'),
          );
          canaries.push(delivery.nonce);
          canaries.push(
            await readFile(path.join(childRoot, 'runs', run.id, 'trace/feedback-private.txt'), 'utf8'),
          );
        }
        if (mode === 'mechanical')
          for (const canary of canaries)
            assert.ok(
              !transcript.includes(canary),
              `Private feedback entered mechanical model messages: ${canary}`,
            );
        else
          for (const canary of canaries.slice(0, 3))
            assert.ok(transcript.includes(canary), `Full feedback positive control missing: ${canary}`);
        assert.ok(transcript.includes('Seed-only protocol requires exactly the initial harness as parent'));
        assert.ok(transcript.includes('Search already concluded') === false);
        const materialization = JSON.parse(
          await readFile(path.join(childRoot, 'optimizer/0/trace/host-feedback-materialized.json'), 'utf8'),
        );
        assert.equal(materialization.reference.kind, 'task');
        assert.equal(materialization.sha256, materialization.observedSha256);
        const isolation = JSON.parse(
          await readFile(path.join(childRoot, 'optimizer/0/isolation-final.json'), 'utf8'),
        );
        const mounts = isolation.observed.mounts;
        assert.equal(
          mounts.find((mount: { Destination: string }) => mount.Destination === '/evidence').RW,
          false,
        );
        assert.ok(
          !mounts.some((mount: { Destination: string }) =>
            ['/evaluation', '/runs', '/experiment.sqlite'].includes(mount.Destination),
          ),
        );

        // Post-search native Tools probe receives actual run IDs explicitly. It is separate from G's search
        // and proves denial by authorization, rather than relying on an unguessable run identifier.
        const token = await readFile(path.join(childRoot, 'controller-token'), 'utf8');
        const server = await serve(controller, token, 0, '127.0.0.1');
        const address = server.address();
        assert.ok(address && typeof address !== 'string');
        const ctx = new Context();
        process.env.HE_FEEDBACK_TEST_CAPABILITY = token;
        const probes: Array<{ name: string; args: Record<string, unknown>; result: unknown }> = [];
        try {
          await ctx.plugin(SystemPrompt);
          await ctx.plugin(Tools);
          await ctx.plugin(Evolution, {
            endpoint: `http://127.0.0.1:${address.port}`,
            tokenEnv: 'HE_FEEDBACK_TEST_CAPABILITY',
          });
          const call = async (name: string, args: Record<string, unknown>) => {
            const result = await ctx.tools.execute({
              callId: ToolCallId(`known-run-${probes.length}`),
              name,
              arguments: args,
              signal: AbortSignal.timeout(10_000),
            });
            probes.push({ name, args, result });
            return result;
          };
          for (const run of rawRuns)
            for (const area of ['input', 'delivery', 'trace']) {
              const file =
                area === 'input'
                  ? 'message.txt'
                  : area === 'delivery'
                    ? 'result.txt'
                    : 'feedback-private.txt';
              for (const args of [
                { run: run.id, area },
                { run: run.id, area, file },
              ]) {
                const result = await call('evolution_evidence', args);
                assert.equal(result.isError, mode === 'mechanical');
                if (mode === 'mechanical')
                  assert.match(visibleText(result), /Execution evidence is not authorized/);
              }
              const result = await call('evolution_materialize', { kind: 'run', id: run.id, area, file });
              assert.equal(result.isError, mode === 'mechanical');
            }
          const input = await call('evolution_input', { task: 'search', file: 'message.txt' });
          assert.equal(input.isError, false);
          assert.ok(visibleText(input).includes('search'));
          const status = await call('evolution_status', {});
          assert.equal(status.isError, false);
          const replay = await call('evolution_submit', store.candidates()[1]!.proposal);
          assert.equal(replay.isError, false);
          if (mode === 'mechanical') {
            const text = visibleText(probes);
            for (const canary of canaries) assert.ok(!text.includes(canary));
            assert.ok(!text.includes('"champion"'));
            assert.ok(!text.includes('"mean"'));
          }
        } finally {
          await ctx.fiber.dispose();
          delete process.env.HE_FEEDBACK_TEST_CAPABILITY;
          await new Promise<void>((resolve, reject) =>
            server.close((error) => (error ? reject(error) : resolve())),
          );
        }
        await atomicJSON(path.join(root, `known-run-probes-${mode}.json`), probes);
        observations.push({
          mode,
          job: job.id,
          method: job.method,
          arm: job.comparisonArm,
          nativeModelRequests: requests.length,
          nativeToolResponses: toolResponses.length,
          nativeKnownRunProbes: probes.length,
          rawRuns: rawRuns.length,
          canaryCount: canaries.length,
          materializedTaskBytes: materialization.bytes,
          requestSha256: await fileDigest(requestFile),
          isolationSha256: await fileDigest(path.join(childRoot, 'optimizer/0/isolation-final.json')),
        });
      } finally {
        await controller.close();
        store.close();
      }
    }
    await atomicJSON(path.join(root, 'acceptance.json'), {
      passed: true,
      image,
      verifiedRuntime,
      registrationDigest: digest(spec),
      reportSha256: await fileDigest(reportFile),
      sameFrozenMethod: true,
      observations,
      terminalReentryUnchanged: true,
      executionEvidence: before,
      boundary:
        'Actual Docker/DSH search and independent assessment with deterministic model fixture; separate native Tools probes use real run IDs. No paid model, efficacy claim, or live-crash recovery claim.',
    });
  },
);
