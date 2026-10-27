import { mkdir, readFile, writeFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { atomicJSON, freeze } from './artifacts.js';
import type { ExperimentSpec } from './contracts.js';
import { Controller } from './controller.js';
import { Store } from './store.js';
import { serve } from './api.js';
import { optimize } from './optimizer.js';

export async function initialize(
  root: string,
  spec: ExperimentSpec,
  dataset: string,
  seed: string,
): Promise<void> {
  await mkdir(root);
  await atomicJSON(path.join(root, 'experiment.json'), spec);
  await freeze(await realpath(dataset), path.join(root, 'dataset'));
  const store = new Store(path.join(root, 'experiment.sqlite'), spec);
  const controller = new Controller(root, path.join(root, 'dataset'), spec, store);
  try {
    await controller.start();
    await controller.seed(path.resolve(seed));
  } finally {
    await controller.close();
    store.close();
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
  options: { host: string; port: number; endpoint: string },
): Promise<void> {
  const abort = new AbortController();
  const server = await serve(
    controller,
    await capability(controller.root),
    options.port,
    options.host,
    abort.signal,
  );
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Controller has no TCP address');
  const hostname =
    options.host === '0.0.0.0'
      ? '127.0.0.1'
      : options.host === '::'
        ? '[::1]'
        : options.host.includes(':')
          ? `[${options.host}]`
          : options.host;
  const interrupt = () =>
    abort.abort(new Error('Coordinator interrupted; original containers retained for resume'));
  process.once('SIGINT', interrupt);
  process.once('SIGTERM', interrupt);
  const completed = new Error('Optimizer completed');
  const pump = controller.watch(abort.signal).catch((error) => {
    if (error === completed) return;
    abort.abort(error);
    throw error;
  });
  const optimizer = optimize(
    controller.root,
    controller.spec,
    { endpoint: options.endpoint, controlEndpoint: `http://${hostname}:${address.port}` },
    controller.docker,
    abort.signal,
  ).then(
    () => abort.abort(completed),
    (error) => {
      abort.abort(error);
      throw error;
    },
  );
  // Either side failing cancels waiting, without rerunning or deleting original executions.
  const results = await Promise.allSettled([pump, optimizer]);
  try {
    const errors = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    if (errors.length)
      throw new AggregateError(
        errors.map((r) => r.reason),
        'Evolution stopped; artifacts retained',
      );
    await controller.pump();
    await atomicJSON(path.join(controller.root, 'completion.json'), controller.status());
  } finally {
    process.removeListener('SIGINT', interrupt);
    process.removeListener('SIGTERM', interrupt);
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}
