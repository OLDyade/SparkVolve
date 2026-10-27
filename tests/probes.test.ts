import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, cp, readFile, access } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../src/store.js';
import { queueProbe, executeProbe } from '../src/probes.js';
import { Docker, type ContainerSpec } from '../src/docker.js';
import { atomicJSON, fileDigest, treeDigest, digest, freeze } from '../src/artifacts.js';
import { specification } from './fixtures.js';
import { experimentReport } from '../src/report.js';

test('isolated probes freeze both inputs, resume original execution and never affect candidate scores', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'he-probes-'));
  const spec = specification();
  spec.probes = { limit: 2, timeoutSeconds: 5 };
  const store = new Store(path.join(root, 'experiment.sqlite'), spec);
  for (const directory of ['draft', 'suite'])
    await mkdir(path.join(root, 'drafts', directory), { recursive: true });
  await writeFile(path.join(root, 'drafts/draft/package-lock.json'), '{}');
  await writeFile(path.join(root, 'drafts/draft/value.txt'), 'original');
  await writeFile(path.join(root, 'drafts/suite/check.mjs'), 'export async function probe() {}');
  const request = { draft: 'draft', suite: 'suite', entry: 'check.mjs', hypothesis: 'test actual behavior' };
  const exited = {
    Status: 'exited',
    Running: false,
    ExitCode: 1,
    StartedAt: '2026-10-28T00:00:00Z',
    FinishedAt: '2026-10-28T00:00:01Z',
  };
  const abort = new AbortController();
  let builds = 0;
  const executionNames: string[] = [];
  class Driver extends Docker {
    override async run(container: ContainerSpec) {
      if (container.name.startsWith('he-build-')) {
        builds++;
        const source = container.mounts.find((m) => m.target === '/source')!.source;
        const output = path.join(container.mounts.find((m) => m.target === '/workspace')!.source, 'output');
        await mkdir(output);
        await cp(source, path.join(output, 'bundle'), { recursive: true });
        await writeFile(path.join(output, 'bundle.tgz'), 'archive');
        await atomicJSON(path.join(output, 'receipt.json'), {
          sourceDigest: await treeDigest(source),
          lockDigest: await fileDigest(path.join(source, 'package-lock.json')),
          bundleDigest: await treeDigest(path.join(output, 'bundle')),
          tarballDigest: await fileDigest(path.join(output, 'bundle.tgz')),
        });
        return { ...exited, ExitCode: 0 };
      }
      executionNames.push(container.name);
      assert.equal(container.network, 'none');
      assert.deepEqual(container.env, {});
      assert.deepEqual(
        container.mounts.map((m) => m.target),
        ['/candidate', '/suite', '/workspace', '/probe-launch.json'],
      );
      assert.equal(await readFile(path.join(container.mounts[0]!.source, 'value.txt'), 'utf8'), 'original');
      if (executionNames.length === 1) {
        abort.abort(new Error('controller interrupted'));
        throw abort.signal.reason;
      }
      return exited;
    }
  }
  const docker = new Driver();
  try {
    const probe = await queueProbe(root, store, request);
    await assert.rejects(queueProbe(root, store, { ...request, hypothesis: 'reworded' }), /Identical probe/);
    await writeFile(path.join(root, 'drafts/draft/value.txt'), 'edited after freeze');
    const opts = { root, dataset: root, spec, store, docker, probe, assertOwner: () => {} };
    await assert.rejects(executeProbe({ ...opts, signal: abort.signal }), /controller interrupted/);
    assert.equal(store.probes()[0]!.phase, 'queued');
    assert.ok(store.probes()[0]!.build);
    await executeProbe({ ...opts, probe: store.probes()[0]! });
    assert.equal(builds, 1);
    assert.equal(new Set(executionNames).size, 1);
    assert.equal(store.probes()[0]!.phase, 'failed');
    assert.equal(store.probes()[0]!.executionMilliseconds, 1000);
    assert.deepEqual(store.candidates(), []);
    assert.deepEqual(store.runs(), []);
    assert.equal(store.getMeta('champion'), undefined);
    const report = await experimentReport(root, store);
    assert.equal(report.probes.consumed, 1);
    assert.equal(report.candidatesConsumed, 0);
    await queueProbe(root, store, request);
    await assert.rejects(queueProbe(root, store, request), /budget exhausted/);
    store.setMeta('searchConclusion', '{}');
    await assert.rejects(queueProbe(root, store, request), /not authorized/);
  } finally {
    store.close();
  }
});

test('disabled probes reject without creating an execution', async () => {
  const spec = specification(),
    store = new Store(':memory:', spec);
  try {
    await assert.rejects(queueProbe('/unused', store, {}), /not authorized/);
  } finally {
    store.close();
  }
});

test('invalid probe directories and literal entry paths fail before preparation or budget consumption', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'he-probe-input-'));
  const spec = specification();
  spec.probes = { limit: 1, timeoutSeconds: 5 };
  const store = new Store(':memory:', spec);
  await mkdir(path.join(root, 'drafts/draft'), { recursive: true });
  await mkdir(path.join(root, 'drafts/suite/nested'), { recursive: true });
  await writeFile(path.join(root, 'drafts/suite/nested/check.mjs'), 'export async function probe(){}');
  await writeFile(path.join(root, 'drafts/file'), 'not a directory');
  const request = { draft: 'draft', suite: 'suite', entry: 'nested/check.mjs', hypothesis: 'literal entry' };
  try {
    for (const invalid of [
      { ...request, draft: 'file' },
      { ...request, suite: 'file' },
      { ...request, entry: 'nested' },
      { ...request, entry: 'nested/check.mjs#probe' },
      { ...request, entry: 'missing.mjs' },
    ]) {
      await assert.rejects(queueProbe(root, store, invalid), /directory|regular file|ENOENT/);
      assert.deepEqual(store.probes(), []);
      await assert.rejects(access(path.join(root, 'probes')), { code: 'ENOENT' });
    }
    const probe = await queueProbe(root, store, request);
    assert.equal(probe.request.entry, 'nested/check.mjs');
    assert.equal(store.probes().length, 1);
  } finally {
    store.close();
  }
});

test('probe preparation resumes partial snapshots and an interrupted database registration', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'he-probe-prepare-'));
  const spec = specification();
  spec.probes = { limit: 1, timeoutSeconds: 5 };
  const store = new Store(':memory:', spec);
  const source = path.join(root, 'drafts/draft'),
    suite = path.join(root, 'drafts/suite');
  await mkdir(source, { recursive: true });
  await mkdir(suite, { recursive: true });
  await writeFile(path.join(source, 'module.mjs'), 'export const n=7;');
  await writeFile(path.join(suite, 'check.mjs'), 'export async function probe(){}');
  const sourceDigest = await treeDigest(source),
    suiteDigest = await treeDigest(suite);
  const id = digest({ sourceDigest, suiteDigest, entry: 'check.mjs' });
  await freeze(
    source,
    path.join(root, 'probes', id, 'candidates', sourceDigest),
    path.join(root, 'publications'),
  );
  const add = store.addProbe.bind(store);
  store.addProbe = () => {
    throw new Error('injected commit failure');
  };
  const request = { draft: 'draft', suite: 'suite', entry: 'check.mjs', hypothesis: 'original hypothesis' };
  try {
    await assert.rejects(queueProbe(root, store, request), /injected commit failure/);
    assert.equal(store.probes().length, 0);
    const intent = JSON.parse(await readFile(path.join(root, 'probes', id, 'intent.json'), 'utf8'));
    store.addProbe = add;
    const probe = await queueProbe(root, store, { ...request, hypothesis: 'new wording' });
    assert.deepEqual(probe, intent);
    assert.equal(probe.id, id);
    assert.equal(probe.request.hypothesis, 'original hypothesis');
    assert.equal(store.probes().length, 1);
    assert.equal(store.events().filter((event) => event.type === 'probe.queued').length, 1);
  } finally {
    store.close();
  }
});
