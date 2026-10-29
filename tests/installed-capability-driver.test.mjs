import test from 'node:test';
import assert from 'node:assert/strict';
import { specification } from './fixtures.ts';
import {
  acceptanceSpec,
  separateRoot,
  nativeInstallationProgram,
  taskWorkerSpec,
  gradingSpec,
  runRegisteredTasks,
  summarize,
} from '../scripts/verify-installed-capability.mjs';

function spec() {
  const value = specification();
  value.purpose = 'validation';
  value.repetitions = 1;
  value.concurrency = 4;
  value.timeoutSeconds = 600;
  value.budget.candidates = 1;
  value.probes = null;
  value.tasks = ['one', 'two', 'three', 'four'].map((id) => ({ ...value.tasks[0], id }));
  value.isolation.network.executor = 'controlled';
  value.egress.executor = [
    {
      id: 'model',
      path: '/v1/chat/completions',
      method: 'POST',
      upstream: 'https://provider.invalid/v1/chat/completions',
      addresses: { kind: 'public' },
      credential: { env: 'TEST_MODEL_KEY', header: 'authorization', prefix: 'Bearer ' },
      body: { kind: 'empty' },
      maxRequestBytes: 1024,
      timeoutSeconds: 600,
    },
  ];
  return value;
}
const usage = () => ({
  started: 2,
  results: 2,
  failed: 0,
  unfinished: 0,
  inputTokensReported: 30,
  outputTokensReported: 10,
  missingUsage: 0,
  requestDurationMsSum: 12,
});
function effects(overrides = {}) {
  const calls = [];
  const invoke = (name, result) => async (task) => {
    calls.push(`${task.id}:${name}`);
    return structuredClone(result);
  };
  return {
    calls,
    redact: (message) => message.replaceAll('private-value', '[redacted]'),
    save: async () => {},
    install: invoke('install', {
      tarballDigest: 'a'.repeat(64),
      profileFiles: { 'package.json': 'b'.repeat(64) },
    }),
    execute: invoke('execute', { ExitCode: 0 }),
    verifyInstalled: invoke('verify', { unchanged: true }),
    freezeDelivery: invoke('freeze', 'c'.repeat(64)),
    grade: invoke('grade', { score: 0.5, metrics: {}, feedback: 'Fresh grade' }),
    usage: invoke('usage', usage()),
    ...overrides,
  };
}

test('uses registered task count, concurrency and deadlines with one attempt and controlled egress', async () => {
  assert.equal(acceptanceSpec(spec()).tasks.length, 4);
  const custom = spec();
  custom.tasks.pop();
  custom.concurrency = 1;
  custom.timeoutSeconds = 900;
  assert.equal(acceptanceSpec(custom).tasks.length, 3);
  const result = await runRegisteredTasks(custom, effects());
  assert.equal(result.registered, 3);
  assert.equal(result.scored, 3);
  assert.equal(
    taskWorkerSpec({
      root: '/fresh',
      task: custom.tasks[0],
      spec: custom,
      installed: { profileFiles: {} },
      prefix: 'custom',
      network: 'isolated',
    }).timeoutSeconds,
    900,
  );
  for (const mutate of [
    (s) => {
      s.purpose = 'search';
    },
    (s) => {
      s.repetitions = 2;
    },
    (s) => {
      s.timeoutSeconds = 300;
    },
    (s) => {
      s.egress.executor[0].timeoutSeconds = 900;
    },
    (s) => {
      s.isolation.network.executor = 'none';
    },
  ]) {
    const invalid = spec();
    mutate(invalid);
    assert.throws(() => acceptanceSpec(invalid));
  }
});
test('evidence root cannot contain or be inside frozen input trees', () => {
  separateRoot('/experiments/new', ['/experiments/original/artifact', '/datasets/frozen']);
  for (const root of ['/datasets', '/datasets/frozen', '/datasets/frozen/new'])
    assert.throws(() => separateRoot(root, ['/datasets/frozen']));
});
test('worker boots installed DSH home with no candidate/archive/evaluation mounts or real credentials', () => {
  const s = spec(),
    task = s.tasks[0];
  const result = taskWorkerSpec({
    root: '/fresh',
    spec: s,
    task,
    prefix: 'test',
    network: 'isolated',
    installed: { profileFiles: { 'package.json': 'hash', 'pnpm-lock.yaml': 'hash' } },
  });
  assert.equal(result.timeoutSeconds, 600);
  assert.deepEqual(result.command, ['node', '/app/dist/runtime/worker.js', '/launch.json']);
  assert.ok(
    result.mounts.every((mount) => !['/candidate', '/artifact', '/evaluation'].includes(mount.target)),
  );
  for (const mount of result.mounts.filter((mount) => mount.target.includes('/profiles/')))
    assert.equal(mount.writable, false);
  assert.deepEqual(
    result.env,
    Object.fromEntries(s.executor.credentialEnv.map((key) => [key, 'egress-client-placeholder'])),
  );
  assert.ok(result.mounts.some((mount) => mount.target === '/empty.yml' && !mount.writable));
});
test('independent grader has only delivery, input, private evaluation and its output', () => {
  const s = spec(),
    result = gradingSpec({ root: '/fresh', task: s.tasks[0], spec: s, prefix: 'test' });
  assert.equal(result.network, 'none');
  assert.deepEqual(result.env, {});
  assert.equal(result.image, s.evaluator.image);
  assert.deepEqual(
    result.mounts.map((mount) => [mount.target, mount.writable]),
    [
      ['/delivery', false],
      ['/input', false],
      ['/evaluation', false],
      ['/workspace', true],
    ],
  );
});
test('native installer and worker share the same DSH path and install the original tarball', () => {
  assert.match(nativeInstallationProgram, /home='\/trace\/dsh'/);
  assert.match(
    nativeInstallationProgram,
    /\['plugin','--profile',config.profile,'add','\/artifact\/bundle.tgz'\]/,
  );
  assert.match(nativeInstallationProgram, /config.identity.tarballDigest/);
  assert.match(nativeInstallationProgram, /assert.deepEqual\(observed,original/);
  assert.doesNotMatch(nativeInstallationProgram, /npm.*(?:pack|build)|runtime\.run|\.prompt\(/);
});
test('four successful installations execute and score each task exactly once with fresh metrics', async () => {
  const fx = effects(),
    report = await runRegisteredTasks(spec(), fx);
  assert.equal(report.passed, true);
  assert.equal(report.scored, 4);
  assert.equal(report.quality.meanWithRegisteredFailureValue, 0.5);
  assert.equal(report.usage.reportedTotals.started, 8);
  for (const id of ['one', 'two', 'three', 'four'])
    assert.deepEqual(
      fx.calls.filter((call) => call.startsWith(`${id}:`)),
      ['install', 'execute', 'verify', 'freeze', 'grade', 'usage'].map((step) => `${id}:${step}`),
    );
});
test('installation, execution, and grading failures keep full denominator and never retry', async () => {
  const fx = effects();
  for (const [stage, id] of [
    ['install', 'one'],
    ['execute', 'two'],
    ['grade', 'three'],
  ]) {
    const original = fx[stage];
    fx[stage] = async (task, ...rest) => {
      if (task.id === id) {
        fx.calls.push(`${id}:${stage}`);
        throw Error('private-value failure');
      }
      return original(task, ...rest);
    };
  }
  const report = await runRegisteredTasks(spec(), fx);
  assert.equal(report.passed, false);
  assert.equal(report.registered, 4);
  assert.equal(report.scored, 1);
  assert.equal(report.quality.meanWithRegisteredFailureValue, 0.125);
  assert.equal(report.executionAttempts, 3);
  assert.equal(fx.calls.filter((value) => value === 'one:install').length, 1);
  assert.ok(!fx.calls.includes('one:execute'));
  assert.ok(!fx.calls.includes('two:grade'));
  assert.ok(report.rows.slice(0, 3).every((row) => row.error.message.includes('[redacted]')));
});
test('installed identity drift prevents scoring without repairing files', async () => {
  const fx = effects({
    verifyInstalled: async () => {
      throw Error('identity changed');
    },
  });
  const report = await runRegisteredTasks(spec(), fx);
  assert.equal(report.scored, 0);
  assert.equal(report.registered, 4);
  assert.ok(!fx.calls.some((call) => call.endsWith(':grade') || call.endsWith(':freeze')));
});
test('unfinished or absent request evidence is visible and cannot pass acceptance', async () => {
  for (const value of [null, { ...usage(), unfinished: 1, results: 1 }]) {
    const report = await runRegisteredTasks(spec(), effects({ usage: async () => value }));
    assert.equal(report.passed, false);
    assert.equal(report.scored, 4);
    assert.equal(report.usage.complete, false);
    if (value === null) assert.equal(report.usage.reportedTotals, null);
  }
});
test('out-of-range scores fail rather than entering the aggregate', async () => {
  const report = await runRegisteredTasks(
    spec(),
    effects({ grade: async () => ({ score: 20, metrics: {}, feedback: '' }) }),
  );
  assert.equal(report.scored, 0);
  assert.equal(report.quality.meanWithRegisteredFailureValue, 0);
});
test('registration denominator rejects a missing task row', () => {
  assert.throws(() => summarize([], spec()), /denominator/);
});
test('evidence write failure waits for other active tasks before surfacing', async () => {
  let completed = 0;
  const fx = effects({
    save: async (row) => {
      if (row.task === 'one') throw Error('disk failure');
    },
    execute: async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      completed++;
      return { ExitCode: 0 };
    },
  });
  await assert.rejects(runRegisteredTasks(spec(), fx), /persist task evidence/);
  assert.equal(completed, 3);
});
