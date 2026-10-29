import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, chmod, readdir, stat } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { channel } from 'node:diagnostics_channel';
import { writeFileSync } from 'node:fs';
import { specification } from './fixtures.js';
import { treeDigest } from '../src/artifacts.js';
import { initialize, prepareExperiment, evolve } from '../src/experiment.js';
import { Store } from '../src/store.js';
import { Controller } from '../src/controller.js';
import { Docker } from '../src/docker.js';

class NoExecution extends Docker {
  override async create(): Promise<void> {
    throw Error('Initialization must never create execution containers');
  }
  override async run(): Promise<never> {
    throw Error('Initialization must never build, grade or run a candidate');
  }
}

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'he-embedded-init-'));
  const dataset = path.join(root, 'input-dataset'),
    seed = path.join(root, 'seed');
  const spec = specification();
  for (const task of spec.tasks) {
    for (const directory of [task.input, task.evaluation]) {
      await mkdir(path.join(dataset, directory), { recursive: true });
      await writeFile(path.join(dataset, directory, 'value.txt'), task.id);
    }
    task.inputDigest = await treeDigest(path.join(dataset, task.input));
    task.evaluationDigest = await treeDigest(path.join(dataset, task.evaluation));
  }
  await mkdir(seed);
  await writeFile(
    path.join(seed, 'package.json'),
    JSON.stringify({
      name: '@sparkvolve/initialization-fixture',
      dsh: { bundle: { patch: './cordis.patch.yml' } },
    }),
  );
  await writeFile(path.join(seed, 'cordis.patch.yml'), '[]\n');
  await writeFile(path.join(seed, 'package-lock.json'), '{}\n');
  const cleanup = async () => {
    const writable = async (directory: string): Promise<void> => {
      await chmod(directory, 0o755);
      for (const entry of await readdir(directory, { withFileTypes: true }))
        if (entry.isDirectory()) await writable(path.join(directory, entry.name));
    };
    await writable(root);
    await rm(root, { recursive: true });
  };
  return { root, dataset, seed, spec, cleanup };
}

test('embedded initialization resumes the same baseline and refuses changed inputs or foreign directories', async () => {
  const f = await fixture(),
    root = path.join(f.root, 'experiment');
  try {
    await prepareExperiment(root, f.spec, f.dataset, f.seed, new NoExecution());
    await prepareExperiment(root, f.spec, f.dataset, f.seed, new NoExecution());
    const store = new Store(path.join(root, 'experiment.sqlite'), f.spec, 'read');
    try {
      assert.equal(store.candidates().length, 1);
      assert.equal(store.candidates()[0]!.digest, await treeDigest(f.seed));
      assert.equal(store.candidates()[0]!.phase, 'frozen');
      assert.equal(store.runs().length, 0);
      assert.equal(store.events().filter((event) => event.type === 'candidate.frozen').length, 1);
    } finally {
      store.close();
    }
    await assert.rejects(
      prepareExperiment(root, { ...f.spec, objective: 'different' }, f.dataset, f.seed),
      /contract changed/,
    );
    await writeFile(path.join(f.seed, 'new.txt'), 'changed');
    await assert.rejects(prepareExperiment(root, f.spec, f.dataset, f.seed), /contract changed/);
    await rm(path.join(f.seed, 'new.txt'));
    await writeFile(path.join(f.dataset, 'new.txt'), 'changed');
    await assert.rejects(prepareExperiment(root, f.spec, f.dataset, f.seed), /contract changed/);
    await rm(path.join(f.dataset, 'new.txt'));
    const foreign = path.join(f.root, 'foreign');
    await mkdir(foreign);
    await writeFile(path.join(foreign, 'other.txt'), 'keep');
    await assert.rejects(
      prepareExperiment(foreign, f.spec, f.dataset, f.seed),
      /no experiment initialization identity/,
    );
    assert.equal(await readFile(path.join(foreign, 'other.txt'), 'utf8'), 'keep');
    await assert.rejects(initialize(root, f.spec, f.dataset, f.seed), { code: 'EEXIST' });
    await rm(path.join(root, 'experiment.sqlite'));
    await assert.rejects(prepareExperiment(root, f.spec, f.dataset, f.seed), { code: 'ENOENT' });
  } finally {
    await f.cleanup();
  }
});

test('a status reader can hold its snapshot while initialization commits', async () => {
  const f = await fixture(),
    root = path.join(f.root, 'experiment');
  const observations = channel('sparkvolve:initialization');
  let reader: DatabaseSync | undefined;
  const holdSnapshot = (message: unknown) => {
    const event = message as { root: string; phase: string };
    if (event.root !== root || event.phase !== 'baseline_published') return;
    reader = new DatabaseSync(path.join(root, 'initialization.sqlite'), { readOnly: true, timeout: 0 });
    reader.exec('BEGIN;');
    assert.equal(reader.prepare('SELECT phase FROM initialization').get()!.phase, 'preparing');
  };
  observations.subscribe(holdSnapshot);
  try {
    await prepareExperiment(root, f.spec, f.dataset, f.seed, new NoExecution());
    assert.ok(reader);
    assert.equal(reader.prepare('SELECT phase FROM initialization').get()!.phase, 'preparing');
    reader.exec('COMMIT;');
    assert.equal(reader.prepare('SELECT phase FROM initialization').get()!.phase, 'prepared');
  } finally {
    observations.unsubscribe(holdSnapshot);
    reader?.close();
    await f.cleanup();
  }
});

test('SIGKILL at initialization publication boundaries resumes without duplicate baselines or task attempts', async (t) => {
  for (const phase of ['reserved', 'dataset_published', 'baseline_published', 'prepared']) {
    await t.test(phase, async () => {
      const f = await fixture(),
        root = path.join(f.root, 'experiment');
      try {
        const config = path.join(f.root, 'launch.json');
        await writeFile(config, JSON.stringify({ root, spec: f.spec, dataset: f.dataset, seed: f.seed }));
        const code = `import {channel} from 'node:diagnostics_channel';
          import {readFile} from 'node:fs/promises';
          import {prepareExperiment} from ${JSON.stringify(new URL('../src/experiment.ts', import.meta.url).href)};
          const launch=JSON.parse(await readFile(${JSON.stringify(config)},'utf8'));
          channel('sparkvolve:initialization').subscribe(event=>{if(event.phase===${JSON.stringify(phase)})process.kill(process.pid,'SIGKILL');});
          await prepareExperiment(launch.root,launch.spec,launch.dataset,launch.seed);`;
        const result = await new Promise<{
          code: number | null;
          signal: NodeJS.Signals | null;
          stderr: string;
        }>((resolve, reject) => {
          const child = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', code], {
            stdio: ['ignore', 'ignore', 'pipe'],
          });
          let stderr = '';
          child.stderr.on('data', (chunk) => {
            stderr += chunk;
          });
          child.on('error', reject);
          child.on('exit', (code, signal) => resolve({ code, signal, stderr }));
        });
        assert.equal(result.signal, 'SIGKILL', result.stderr);
        await prepareExperiment(root, f.spec, f.dataset, f.seed, new NoExecution());
        const store = new Store(path.join(root, 'experiment.sqlite'), f.spec, 'read');
        try {
          assert.equal(store.candidates().length, 1);
          assert.equal(store.candidates()[0]!.digest, await treeDigest(f.seed));
          assert.equal(store.pendingSubmissions().length, 0);
          assert.equal(store.runs().length, 0);
        } finally {
          store.close();
        }
        const db = new DatabaseSync(path.join(root, 'initialization.sqlite'), { readOnly: true });
        try {
          assert.equal(db.prepare('SELECT phase FROM initialization').get()!.phase, 'prepared');
        } finally {
          db.close();
        }
      } finally {
        await f.cleanup();
      }
    });
  }
});

test('an already interrupted parent cannot start an embedded coordinator or register process handlers', async () => {
  const f = await fixture(),
    root = path.join(f.root, 'experiment');
  try {
    await prepareExperiment(root, f.spec, f.dataset, f.seed, new NoExecution());
    const store = new Store(path.join(root, 'experiment.sqlite'), f.spec);
    const controller = new Controller(root, path.join(root, 'dataset'), f.spec, store, new NoExecution());
    const before = [process.listenerCount('SIGINT'), process.listenerCount('SIGTERM')];
    const parent = new AbortController(),
      reason = Error('Parent stopped waiting');
    parent.abort(reason);
    try {
      await assert.rejects(
        evolve(controller, {
          host: '127.0.0.1',
          port: 0,
          endpoint: 'http://127.0.0.1:0',
          signal: parent.signal,
        }),
        (error) => error === reason,
      );
      assert.deepEqual([process.listenerCount('SIGINT'), process.listenerCount('SIGTERM')], before);
      await assert.rejects(readFile(path.join(root, 'controller-token')), { code: 'ENOENT' });
      assert.equal(store.runs().length, 0);
    } finally {
      store.close();
    }
  } finally {
    await f.cleanup();
  }
});

test('prepared snapshots are verification-only and missing or damaged content is never recreated', async (t) => {
  for (const area of ['dataset', 'baseline'] as const) {
    for (const damage of ['missing', 'changed'] as const) {
      await t.test(`${area}-${damage}`, async () => {
        const f = await fixture(),
          root = path.join(f.root, 'experiment');
        try {
          await prepareExperiment(root, f.spec, f.dataset, f.seed, new NoExecution());
          const target =
            area === 'dataset'
              ? path.join(root, 'dataset')
              : path.join(root, 'candidates', await treeDigest(f.seed));
          const leaf =
            area === 'dataset'
              ? path.join(target, f.spec.tasks[0]!.input, 'value.txt')
              : path.join(target, 'package.json');
          if (damage === 'missing') {
            const remove = async (directory: string): Promise<void> => {
              await chmod(directory, 0o755);
              for (const entry of await readdir(directory, { withFileTypes: true }))
                if (entry.isDirectory()) await remove(path.join(directory, entry.name));
            };
            await remove(target);
            await rm(target, { recursive: true });
          } else {
            await chmod(leaf, 0o644);
            await writeFile(leaf, 'damaged snapshot');
          }
          await assert.rejects(prepareExperiment(root, f.spec, f.dataset, f.seed, new NoExecution()));
          if (damage === 'missing') await assert.rejects(stat(target), { code: 'ENOENT' });
          else assert.equal(await readFile(leaf, 'utf8'), 'damaged snapshot');
          const store = new Store(path.join(root, 'experiment.sqlite'), f.spec, 'read');
          try {
            assert.equal(store.candidates().length, 1);
            assert.equal(store.runs().length, 0);
          } finally {
            store.close();
          }
        } finally {
          await f.cleanup();
        }
      });
    }
  }
});

test('dataset changes after initialization identity is reserved cannot publish a prepared experiment', async () => {
  const f = await fixture(),
    root = path.join(f.root, 'experiment');
  const observations = channel('sparkvolve:initialization');
  const changeSource = (message: unknown) => {
    const event = message as { root: string; phase: string };
    if (event.root === root && event.phase === 'reserved')
      writeFileSync(path.join(f.dataset, 'changed-after-reservation.txt'), 'different dataset');
  };
  observations.subscribe(changeSource);
  try {
    await assert.rejects(
      prepareExperiment(root, f.spec, f.dataset, f.seed, new NoExecution()),
      /Dataset changed during preparation/,
    );
    const db = new DatabaseSync(path.join(root, 'initialization.sqlite'), { readOnly: true });
    try {
      assert.equal(db.prepare('SELECT phase FROM initialization').get()!.phase, 'preparing');
    } finally {
      db.close();
    }
    await assert.rejects(stat(path.join(root, 'experiment.sqlite')), { code: 'ENOENT' });
  } finally {
    observations.unsubscribe(changeSource);
    await f.cleanup();
  }
});
