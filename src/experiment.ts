import { mkdir, readFile, writeFile, realpath, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { channel } from 'node:diagnostics_channel';
import { atomicJSON, digest, freeze, treeDigest } from './artifacts.js';
import { Experiment, type ExperimentSpec } from './contracts.js';
import { Controller } from './controller.js';
import { Store } from './store.js';
import { serve } from './api.js';
import { optimize } from './optimizer.js';
import { Docker } from './docker.js';
import { listenControlTransport, closeControlServer } from './control-transport.js';
import type { Server } from 'node:http';

const preparations = channel('sparkvolve:initialization');

export async function initialize(
  root: string,
  spec: ExperimentSpec,
  dataset: string,
  seed: string,
): Promise<void> {
  await mkdir(root);
  await prepareExperiment(root, spec, dataset, seed);
}

/** Resume only the registered initialization; this never builds or executes a candidate. */
export async function prepareExperiment(
  root: string,
  raw: ExperimentSpec,
  dataset: string,
  seed: string,
  docker = new Docker(),
): Promise<void> {
  const spec = Experiment.parse(raw);
  const sourceDataset = await realpath(dataset),
    sourceSeed = await realpath(seed);
  const identity = {
    specification: digest(spec),
    dataset: await treeDigest(sourceDataset),
    seed: await treeDigest(sourceSeed),
  };
  await mkdir(root, { recursive: true });
  const files = await readdir(root);
  if (files.length && !files.includes('initialization.sqlite'))
    throw new Error('Existing directory has no experiment initialization identity');
  const db = new DatabaseSync(path.join(root, 'initialization.sqlite'), { timeout: 0 });
  try {
    // Status observers must not block publication; competing writers still fail immediately.
    db.exec(`PRAGMA journal_mode=WAL;
      PRAGMA synchronous=FULL;
      CREATE TABLE IF NOT EXISTS initialization (
        id INTEGER PRIMARY KEY CHECK(id=1), identity TEXT NOT NULL,
        phase TEXT NOT NULL CHECK(phase IN ('preparing','prepared'))
      ) STRICT;
      BEGIN IMMEDIATE;`);
    db.prepare('INSERT OR IGNORE INTO initialization VALUES (1,?,?)').run(digest(identity), 'preparing');
    db.exec('COMMIT; BEGIN IMMEDIATE;');
    const saved = db.prepare('SELECT identity,phase FROM initialization WHERE id=1').get() as {
      identity: string;
      phase: 'preparing' | 'prepared';
    };
    if (saved.identity !== digest(identity)) throw new Error('Experiment initialization contract changed');
    const observe = (phase: string) => preparations.publish({ root, identity, phase });
    observe('reserved');
    try {
      const existing = JSON.parse(await readFile(path.join(root, 'experiment.json'), 'utf8'));
      if (digest(existing) !== identity.specification) throw new Error('Experiment specification changed');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      if (saved.phase === 'prepared') throw new Error('Prepared experiment specification is missing');
      await atomicJSON(path.join(root, 'experiment.json'), spec);
    }
    if (saved.phase === 'prepared') {
      if ((await treeDigest(path.join(root, 'dataset'))) !== identity.dataset)
        throw new Error('Prepared experiment dataset changed');
    } else {
      const frozen = await freeze(sourceDataset, path.join(root, 'dataset'), path.join(root, 'publications'));
      if (frozen !== identity.dataset) throw new Error('Dataset changed during preparation');
    }
    observe('dataset_published');
    if (saved.phase === 'prepared') await stat(path.join(root, 'experiment.sqlite'));
    const store = new Store(path.join(root, 'experiment.sqlite'), spec);
    const controller = new Controller(root, path.join(root, 'dataset'), spec, store, docker);
    try {
      if (saved.phase === 'prepared' && store.candidates()[0]?.digest !== identity.seed)
        throw new Error('Prepared experiment baseline is missing or changed');
      await controller.start();
      const candidate = await controller.prepareSeed(sourceSeed);
      if (candidate.digest !== identity.seed) throw new Error('Initial harness changed during preparation');
    } finally {
      await controller.close();
      store.close();
    }
    observe('baseline_published');
    db.exec("UPDATE initialization SET phase='prepared' WHERE id=1; COMMIT;");
    observe('prepared');
  } finally {
    if (db.isTransaction) db.exec('ROLLBACK');
    db.close();
  }
}

export async function capability(root: string): Promise<string> {
  const file = path.join(root, 'controller-token');
  try {
    return await readFile(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const token = randomBytes(32).toString('hex');
  await writeFile(file, token, { flag: 'wx', mode: 0o600 });
  return token;
}

/** A single owner drives the experiment to a terminal state; DSH owns all agent loops. */
export async function evolve(
  controller: Controller,
  options: { host: string; port: number; endpoint: string; signal: AbortSignal },
): Promise<void> {
  options.signal.throwIfAborted();
  const abort = new AbortController();
  const signal = AbortSignal.any([options.signal, abort.signal]);
  let server: Server | undefined;
  try {
    const token = await capability(controller.root);
    const transport = await listenControlTransport(
      controller.root,
      { host: options.host, port: options.port, endpoint: options.endpoint },
      (port) => serve(controller, token, port, options.host, signal),
      signal,
    );
    server = transport.server;
    const completed = new Error('Optimizer completed');
    const pump = controller.watch(signal).catch((error) => {
      if (error === completed) return;
      abort.abort(error);
      throw error;
    });
    const optimizer = optimize(
      controller.root,
      controller.spec,
      { endpoint: transport.record.endpoint },
      controller.docker,
      signal,
    ).then(
      () => abort.abort(completed),
      (error) => {
        abort.abort(error);
        throw error;
      },
    );
    // Either side failing cancels waiting, without rerunning or deleting original executions.
    const results = await Promise.allSettled([pump, optimizer]);
    const errors = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    if (errors.length)
      throw new AggregateError(
        errors.map((r) => r.reason),
        'Evolution stopped; artifacts retained',
      );
    options.signal.throwIfAborted();
    await controller.pump(options.signal);
    await atomicJSON(path.join(controller.root, 'completion.json'), controller.status());
  } finally {
    if (!abort.signal.aborted) abort.abort(new Error('Evolution scope closed'));
    if (server) await closeControlServer(server);
  }
}
