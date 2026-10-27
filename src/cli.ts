#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { mkdir, readFile, writeFile, realpath } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { Experiment } from './contracts.js';
import { atomicJSON, freeze, treeDigest } from './artifacts.js';
import { Store } from './store.js';
import { Controller } from './controller.js';
import { serve } from './api.js';
import { command } from './docker.js';
import { optimize } from './optimizer.js';
import { exportCandidate } from './export.js';

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    help: { type: 'boolean', short: 'h' },
    root: { type: 'string' },
    spec: { type: 'string' },
    dataset: { type: 'string' },
    seed: { type: 'string' },
    port: { type: 'string', default: '8787' },
    host: { type: 'string', default: '127.0.0.1' },
    run: { type: 'string' },
    endpoint: { type: 'string' },
    candidate: { type: 'string' },
    output: { type: 'string' },
  },
});
const action = positionals[0];
if (values.help || !action) {
  console.log(`Harness Evolution — native DSH plugin experiments

init      --root <new-directory> --spec <json> --dataset <directory> --seed <bundle>
serve     --root <directory> [--host 127.0.0.1] [--port 8787]
optimize  --root <directory> --endpoint <controller-url>
run       --root <directory>
status    --root <directory>
rescore   --root <directory> --run <run-id>
export    --root <directory> --candidate <digest> --output <new-directory>
digest    <artifact-directory>
doctor

Use Node --env-file with a private file for credentials. Existing experiments are immutable.
run reconciles original tasks; rescore reuses the original delivery; export does not publish.`);
} else if (action === 'digest') {
  if (!positionals[1]) throw new Error('digest requires an artifact directory');
  console.log(await treeDigest(path.resolve(positionals[1]!)));
} else if (action === 'doctor') {
  console.log(
    JSON.stringify({
      node: process.version,
      docker: await command('docker', ['version', '--format', '{{.Server.Version}}']),
      dsh: '0.2.1-rc.4',
    }),
  );
} else {
  if (!values.root) throw new Error('Required: --root <experiment directory>');
  const root = path.resolve(values.root);
  if (action === 'init') {
    if (!values.spec || !values.dataset || !values.seed)
      throw new Error('init requires --spec, --dataset and --seed');
    const spec = Experiment.parse(JSON.parse(await readFile(values.spec, 'utf8')));
    await mkdir(root); // Existing experiment directories are never replaced.
    await atomicJSON(path.join(root, 'experiment.json'), spec);
    await freeze(await realpath(values.dataset), path.join(root, 'dataset'));
    const store = new Store(path.join(root, 'experiment.sqlite'), spec);
    const controller = new Controller(root, path.join(root, 'dataset'), spec, store);
    try {
      await controller.start();
      console.log(JSON.stringify(await controller.seed(path.resolve(values.seed))));
    } finally {
      await controller.close();
      store.close();
    }
  } else {
    const spec = Experiment.parse(JSON.parse(await readFile(path.join(root, 'experiment.json'), 'utf8')));
    const store = new Store(path.join(root, 'experiment.sqlite'), spec);
    const controller = new Controller(root, path.join(root, 'dataset'), spec, store);
    if (action === 'status') {
      console.log(JSON.stringify(controller.status(), null, 2));
      store.close();
    } else if (action === 'optimize') {
      if (!values.endpoint)
        throw new Error('optimize requires --endpoint reachable from the optimizer container');
      try {
        await optimize(root, spec, values.endpoint);
      } finally {
        store.close();
      }
    } else {
      await controller.start();
      try {
        if (action === 'run') await controller.pump();
        else if (action === 'export') {
          if (!values.candidate || !values.output)
            throw new Error('export requires --candidate and --output');
          await exportCandidate(root, store, values.candidate, path.resolve(values.output));
        } else if (action === 'rescore') {
          if (!values.run) throw new Error('rescore requires --run');
          await controller.rescore(values.run);
          await controller.pump();
        } else if (action === 'serve') {
          if (spec.purpose !== 'search')
            throw new Error('Validation results cannot be served to an optimizer');
          let token: string;
          const tokenPath = path.join(root, 'controller-token');
          try {
            token = await readFile(tokenPath, 'utf8');
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
            token = randomBytes(32).toString('hex');
            await writeFile(tokenPath, token, { flag: 'wx', mode: 0o600 });
          }
          const server = await serve(controller, token, Number(values.port), values.host!);
          console.log(
            `Controller listening on ${values.host}:${values.port}; capability stored in ${root}/controller-token`,
          );
          let stop = false;
          process.once('SIGINT', () => {
            stop = true;
          });
          process.once('SIGTERM', () => {
            stop = true;
          });
          try {
            while (!stop) {
              await controller.pump();
              await new Promise((resolve) => setTimeout(resolve, 1000));
            }
          } finally {
            await new Promise<void>((resolve, reject) =>
              server.close((error) => (error ? reject(error) : resolve())),
            );
          }
        } else
          throw new Error('Commands: init, run, serve, optimize, export, status, rescore, digest, doctor');
      } finally {
        await controller.close();
        store.close();
      }
    }
  }
}
