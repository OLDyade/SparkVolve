import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, readdir, mkdir, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  assertTerminalStudyReport,
  main,
  writeCommandResult,
  installationConfiguration,
  collectInstallations,
} from '../scripts/verify-optimizer-study.mjs';

test('command telemetry cannot overwrite the authoritative report with the same label', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'he-driver-log-'));
  const report = {
    state: { phase: 'complete' },
    methods: [
      { id: 'g0', ordinal: 0 },
      { id: 'g1', ordinal: 1 },
    ],
    jobs: [],
    metaEpisodes: [],
  };
  const file = path.join(root, 'study-report.json'),
    bytes = JSON.stringify(report);
  await writeFile(file, bytes);
  const log = await writeCommandResult(root, 'study-report', { code: 0, stdout: '', stderr: '' });
  assert.equal(log, path.join(root, 'command-logs/study-report.json'));
  assert.equal(await readFile(file, 'utf8'), bytes);
  assertTerminalStudyReport(JSON.parse(await readFile(file, 'utf8')));
  assert.throws(
    () => assertTerminalStudyReport(JSON.parse('{"code":0,"stdout":"","stderr":""}')),
    /terminal complete/,
  );
  await assert.rejects(writeCommandResult(root, 'study-report', { code: 1 }), { code: 'EEXIST' });
  assert.equal(await readFile(file, 'utf8'), bytes);
});

test('completed verification rejects runtime overrides before creating output or dispatching work', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'he-driver-readonly-'));
  await writeFile(path.join(root, 'original.txt'), 'preserved');
  await assert.rejects(
    main(['--verify-completed', root, '--root', root + '-new', '--image', 'sha256:' + 'a'.repeat(64)]),
    /overrides are forbidden/,
  );
  assert.deepEqual(await readdir(root), ['original.txt']);
  assert.equal(await readFile(path.join(root, 'original.txt'), 'utf8'), 'preserved');
});

test('terminal evidence accepts negative scores without converting them to an engineering failure', () => {
  const report = {
    state: { phase: 'complete' },
    methods: [
      { id: 'g0', ordinal: 0 },
      { id: 'g1', ordinal: 1 },
    ],
    jobs: [{ phase: 'failed', result: null }],
    metaEpisodes: [{ phase: 'complete' }],
    development: [{ mean: 0 }],
    validation: [{ mean: 0 }],
  };
  assertTerminalStudyReport(report);
  assert.throws(
    () => assertTerminalStudyReport({ ...report, state: { phase: 'developing' } }),
    /terminal complete/,
  );
  assert.throws(
    () => assertTerminalStudyReport({ ...report, methods: [{ name: 'guessed' }] }),
    /authoritative study methods/,
  );
});

test('completed output rejects direct and symlink descendants before writing original evidence', async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'he-driver-boundary-')),
    original = path.join(home, 'original');
  await mkdir(original);
  await writeFile(path.join(original, 'original.txt'), 'preserved');
  const alias = path.join(home, 'alias');
  await symlink(original, alias);
  for (const output of [path.join(original, 'nested', 'new'), path.join(alias, 'nested', 'new')]) {
    await assert.rejects(
      main(['--verify-completed', original, '--root', output]),
      /outside original evidence tree/,
    );
    assert.deepEqual(await readdir(original), ['original.txt']);
  }
});

test('installation keeps the registered profile and model without choosing a replacement', () => {
  const model = {
    provider: 'venus',
    model: 'registered',
    maxTokens: 32768,
    reasoningEffort: 'off',
    credentialEnv: ['VENUS_API_KEY'],
  };
  for (const profile of ['sdk', 'sdk-minimal']) {
    const config = installationConfiguration(model, { artifactDigest: 'original' }, 'plugins.yml', {
      profile,
    });
    assert.equal(config.profile, profile);
    assert.equal(config.model, model);
    assert.equal(config.composition, 'plugins.yml');
  }
  assert.throws(() => installationConfiguration(model, {}, null, {}), /registered native profile/);
});

test('one installation failure is retained while independent packages are still checked', async () => {
  const visited = [];
  const results = await collectInstallations(
    [{ name: 'g1' }, { name: 'g0' }, { name: 'h0' }],
    async (item) => {
      visited.push(item.name);
      if (item.name === 'g1') throw Error('candidate failed');
      return { installed: true };
    },
  );
  assert.deepEqual(visited, ['g1', 'g0', 'h0']);
  assert.deepEqual(
    results.map((item) => item.status),
    ['failed', 'passed', 'passed'],
  );
  assert.match(results[0].error, /candidate failed/);
});
