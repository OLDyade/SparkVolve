#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { readFile, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { Experiment } from './contracts.js';
import { treeDigest } from './artifacts.js';
import { Store } from './store.js';
import { Controller } from './controller.js';
import { serve } from './api.js';
import { command } from './docker.js';
import { optimize } from './optimizer.js';
import { exportCandidate, archiveIdentity } from './export.js';
import { initialize, evolve } from './experiment.js';
import { validateStudy } from './validation.js';
import { catalog, importArchive } from './library.js';
import { experimentReport } from './report.js';
import { EventCursor } from './events.js';
import { prepareOptimizerStudy, OptimizerStudyCoordinator } from './optimizer-study.js';
import { OptimizerStudyStore } from './optimizer-study-store.js';
import { RegisteredOptimizerStudy, isFixedComparison } from './optimizer-study-contracts.js';
import { evolveOptimizerStudy, runFixedOptimizerComparison } from './optimizer-study-runner.js';
import { optimizerStudyReport } from './optimizer-study-report.js';
import { cancelOptimizerStudy } from './optimizer-study-cancel.js';
import { cancelExperiment } from './cancellation.js';
import { cancelValidationStudy } from './validation-cancel.js';

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
    'child-endpoint': { type: 'string' },
    'child-host': { type: 'string' },
    candidate: { type: 'string' },
    output: { type: 'string' },
    arms: { type: 'string' },
    library: { type: 'string' },
    query: { type: 'string' },
    archive: { type: 'string' },
    draft: { type: 'string' },
    cursor: { type: 'string' },
    follow: { type: 'boolean' },
  },
});
const action = positionals[0];
if (values.help || !action) {
  console.log(`Harness Evolution — native DSH plugin experiments

init      --root <new-directory> --spec <json> --dataset <directory> --seed <bundle>
serve     --root <directory> [--host 127.0.0.1] [--port 8787]
evolve    --root <directory> --endpoint <container-reachable-url> [--host 127.0.0.1] [--port 8787]
validate  --root <study-directory> --spec <validation.json> --dataset <directory> --arms <arms.json>
cancel-validation --root <study-directory>
optimize  --root <directory> --endpoint <container-reachable-url>
run       --root <directory>
status    --root <directory>
cancel    --root <directory>
report    --root <directory> [--output <new-file>]
events    --root <directory> [--cursor <cursor.json>] [--follow]
rescore   --root <directory> --run <run-id>
export    --root <directory> --candidate <digest> --output <new-directory>
remember  --root <directory> --candidate <digest> --library <directory>
library   --library <directory> [--query <literal-text>]
import    --root <directory> --archive <research-archive> --draft <new-name>
digest    <artifact-directory>
doctor
study-init   --root <new-study> --spec <study.json> --dataset <trusted-input-root>
study-run    --root <study> --child-endpoint <literal-ip-origin:0> [--endpoint <meta-container-reachable-url>] [--host 127.0.0.1] [--port 8787] [--child-host <bind-address>]
             --endpoint is required for development selection; fixed-comparison starts no meta service.
study-status --root <study>
study-report --root <study> [--output <new-file>]
study-cancel --root <study>

Use Node --env-file with a private file for credentials. Existing experiments are immutable.
run reconciles original tasks; rescore reuses the original delivery; export does not publish.`);
} else if (action === 'library') {
  if (!values.library) throw new Error('library requires --library');
  console.log(JSON.stringify(await catalog(path.resolve(values.library), values.query), null, 2));
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
  if (action === 'cancel' || action === 'study-cancel' || action === 'cancel-validation') {
    console.log(
      JSON.stringify(
        await (action === 'cancel'
          ? cancelExperiment(root)
          : action === 'cancel-validation'
            ? cancelValidationStudy(root)
            : cancelOptimizerStudy(root)),
        null,
        2,
      ),
    );
  } else if (action === 'study-init') {
    if (!values.spec || !values.dataset) throw new Error('study-init requires --spec and --dataset');
    const spec = RegisteredOptimizerStudy.parse(JSON.parse(await readFile(values.spec, 'utf8')));
    await prepareOptimizerStudy(root, spec, path.resolve(values.dataset));
    console.log(
      JSON.stringify({ root, status: 'registered', methods: isFixedComparison(spec) ? spec.arms.length : 1 }),
    );
  } else if (['study-run', 'study-status', 'study-report'].includes(action!)) {
    const spec = RegisteredOptimizerStudy.parse(
      JSON.parse(await readFile(path.join(root, 'registration.json'), 'utf8')),
    );
    const store = new OptimizerStudyStore(
      path.join(root, 'study.sqlite'),
      spec,
      action === 'study-run' ? 'write' : 'read',
    );
    const coordinator = new OptimizerStudyCoordinator(root, store);
    try {
      if (action === 'study-run') {
        if (!values['child-endpoint'] || (!isFixedComparison(spec) && !values.endpoint))
          throw new Error(
            'study-run requires --child-endpoint; development selection also requires --endpoint',
          );
        if (new URL(values['child-endpoint']).port !== '0')
          throw new Error(
            '--child-endpoint requires explicit port 0 for separately persisted child transports',
          );
        const abort = new AbortController();
        const interrupt = () =>
          abort.abort(new Error('Study observer interrupted; original descendant attempts retained'));
        process.once('SIGINT', interrupt);
        process.once('SIGTERM', interrupt);
        try {
          const common = {
            childTransport: {
              host: values['child-host'] ?? values.host!,
              port: 0,
              endpoint: values['child-endpoint'],
            },
            signal: abort.signal,
          };
          if (isFixedComparison(spec)) await runFixedOptimizerComparison(coordinator, common);
          else
            await evolveOptimizerStudy(coordinator, {
              ...common,
              host: values.host!,
              port: Number(values.port),
              endpoint: values.endpoint!,
            });
        } finally {
          process.removeListener('SIGINT', interrupt);
          process.removeListener('SIGTERM', interrupt);
        }
      }
      const result = JSON.stringify(
        action === 'study-status' ? coordinator.status() : await optimizerStudyReport(root, store),
        null,
        2,
      );
      if (action === 'study-report' && values.output)
        await writeFile(values.output, result + '\n', { flag: 'wx', mode: 0o600 });
      else console.log(result);
    } finally {
      store.close();
    }
  } else if (action === 'init') {
    if (!values.spec || !values.dataset || !values.seed)
      throw new Error('init requires --spec, --dataset and --seed');
    const spec = Experiment.parse(JSON.parse(await readFile(values.spec, 'utf8')));
    await initialize(root, spec, values.dataset, values.seed);
    console.log(JSON.stringify({ root, status: 'initialized' }));
  } else if (action === 'validate') {
    if (!values.spec || !values.dataset || !values.arms)
      throw new Error('validate requires --spec, --dataset and --arms');
    const abort = new AbortController();
    const interrupt = () =>
      abort.abort(
        new Error(
          'Validation observer interrupted; original attempts retained for resume or explicit cancel-validation',
        ),
      );
    process.once('SIGINT', interrupt);
    process.once('SIGTERM', interrupt);
    try {
      await validateStudy(
        root,
        Experiment.parse(JSON.parse(await readFile(values.spec, 'utf8'))),
        path.resolve(values.dataset),
        JSON.parse(await readFile(values.arms, 'utf8')),
        undefined,
        abort.signal,
      );
      console.log(await readFile(path.join(root, 'comparison.json'), 'utf8'));
    } finally {
      process.removeListener('SIGINT', interrupt);
      process.removeListener('SIGTERM', interrupt);
    }
  } else {
    const spec = Experiment.parse(JSON.parse(await readFile(path.join(root, 'experiment.json'), 'utf8')));
    const store = new Store(
      path.join(root, 'experiment.sqlite'),
      spec,
      ['status', 'report', 'events'].includes(action) ? 'read' : 'write',
    );
    const controller = new Controller(root, path.join(root, 'dataset'), spec, store);
    if (action === 'events') {
      const stop = new AbortController();
      const interrupted = new Error('Event observer interrupted');
      const interrupt = () => stop.abort(interrupted);
      process.once('SIGINT', interrupt);
      process.once('SIGTERM', interrupt);
      try {
        let cursor = values.cursor
          ? EventCursor.parse(JSON.parse(await readFile(values.cursor, 'utf8')))
          : { ...store.cursor(), sequence: 0 };
        for (;;) {
          const page = await store.wait(cursor, {
            timeoutMs: values.follow ? 30_000 : 0,
            signal: stop.signal,
          });
          for (const event of page.events) {
            const entry = {
              cursor: { experimentId: page.cursor.experimentId, sequence: event.sequence },
              event,
            };
            await new Promise<void>((resolve, reject) =>
              process.stdout.write(JSON.stringify(entry) + '\n', (error) =>
                error ? reject(error) : resolve(),
              ),
            );
          }
          cursor = page.cursor;
          if (!page.hasMore && !values.follow) break;
        }
      } catch (error) {
        if (error !== interrupted) throw error;
      } finally {
        process.removeListener('SIGINT', interrupt);
        process.removeListener('SIGTERM', interrupt);
        store.close();
      }
    } else if (action === 'status' || action === 'report') {
      try {
        const result = JSON.stringify(
          action === 'report' ? await experimentReport(root, store) : controller.status(),
          null,
          2,
        );
        if (action === 'report' && values.output)
          await writeFile(values.output, result + '\n', { flag: 'wx', mode: 0o600 });
        else console.log(result);
      } finally {
        store.close();
      }
    } else if (action === 'optimize') {
      if (!values.endpoint) throw new Error('optimize requires container --endpoint');
      try {
        await optimize(root, spec, {
          endpoint: values.endpoint,
        });
      } finally {
        store.close();
      }
    } else if (action === 'export' || action === 'remember') {
      try {
        const output =
          action === 'remember' && values.library && values.candidate
            ? path.join(values.library, archiveIdentity(store, values.candidate))
            : values.output;
        if (!values.candidate || !output)
          throw new Error(
            'export requires --candidate and --output; remember requires --candidate and --library',
          );
        if (action === 'remember')
          await import('node:fs/promises').then((fs) =>
            fs.mkdir(path.dirname(path.resolve(output)), { recursive: true }),
          );
        await exportCandidate(root, store, values.candidate, path.resolve(output));
      } finally {
        store.close();
      }
    } else {
      await controller.start();
      try {
        if (action === 'run') await controller.pump();
        else if (action === 'import') {
          if (!values.archive || !values.draft) throw new Error('import requires --archive and --draft');
          await importArchive(root, store, path.resolve(values.archive), values.draft);
        } else if (action === 'evolve') {
          if (!values.endpoint) throw new Error('evolve requires --endpoint reachable from containers');
          const abort = new AbortController();
          const interrupt = () =>
            abort.abort(new Error('Coordinator interrupted; original containers retained for resume'));
          process.once('SIGINT', interrupt);
          process.once('SIGTERM', interrupt);
          try {
            await evolve(controller, {
              endpoint: values.endpoint,
              host: values.host!,
              port: Number(values.port),
              signal: abort.signal,
            });
          } finally {
            process.removeListener('SIGINT', interrupt);
            process.removeListener('SIGTERM', interrupt);
          }
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
          const abort = new AbortController();
          const server = await serve(controller, token, Number(values.port), values.host!, abort.signal);
          console.log(
            `Controller listening on ${values.host}:${values.port}; capability stored in ${root}/controller-token`,
          );
          const interrupted = new Error('Controller interrupted; original containers retained');
          const stop = () => abort.abort(interrupted);
          process.once('SIGINT', stop);
          process.once('SIGTERM', stop);
          try {
            await controller.watch(abort.signal);
          } catch (error) {
            if (!abort.signal.aborted || abort.signal.reason !== interrupted) throw error;
          } finally {
            abort.abort(interrupted);
            process.removeListener('SIGINT', stop);
            process.removeListener('SIGTERM', stop);
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
