import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Experiment } from '../../dist/contracts.js';
import { atomicJSON, freeze, treeDigest, confined } from '../../dist/artifacts.js';
import { prepareCapabilities } from '../../dist/capabilities.js';
import { prepareProvider } from '../../examples/provider-runtime.mjs';
import { optimizerSecondsForPlan } from '../../examples/timeouts.mjs';

export const directory = fileURLToPath(new URL('.', import.meta.url));
export const benchmark = {
  name: 'spreadsheetbench2-mixed36',
  dockerfile: path.join(directory, 'Dockerfile'),
  seed: path.join(directory, 'seed'),
  mutationSpaces: [
    { id: 'prompt', editableFiles: ['guidance.md'] },
    { id: 'single-plugin', editableFiles: ['guidance.md', 'index.mjs', 'workbook.py'] },
    { id: 'open-plugins' },
  ],
};

/** Community assets remain private to the host; only each task's input reaches H or G. */
export async function prepare({ root, inputs, image, isolation, model, provider, method, run, taskSeconds }) {
  const assets = path.join(root, 'upstream');
  await run('acquire-community-assets', 'python3', [path.join(directory, 'acquire.py'), assets]);
  const roster = JSON.parse(await readFile(path.join(directory, 'mixed36.json'), 'utf8'));
  const catalogDirectory = path.join(root, 'catalog');
  const catalog = await prepareCapabilities(
    JSON.parse(await readFile(path.join(directory, 'capabilities.json'), 'utf8')),
    directory,
    catalogDirectory,
  );
  const result = {};
  for (const split of ['development', 'validation', 'test']) {
    const relative = 'cases/' + split;
    const dataset = path.join(inputs, relative);
    await mkdir(path.dirname(dataset), { recursive: true });
    await run('materialize-' + split, 'docker', [
      'run',
      '--rm',
      '--network=none',
      '--user',
      isolation.user.uid + ':' + isolation.user.gid,
      '--tmpfs',
      `/workspace:rw,uid=${isolation.user.uid},gid=${isolation.user.gid},mode=700`,
      '--mount',
      'type=bind,src=' + directory + ',dst=/adapter,readonly',
      '--mount',
      'type=bind,src=' + assets + ',dst=/upstream,readonly',
      '--mount',
      'type=bind,src=' + inputs + ',dst=/datasets',
      image,
      'python3',
      '-B',
      '/adapter/materialize.py',
      '/upstream',
      '/adapter/mixed36.json',
      '/datasets/' + relative,
      split,
    ]);
    const egress = await prepareProvider(provider, path.join(dataset, 'runtime'), model, taskSeconds);
    for (const part of ['source', 'artifact'])
      await freeze(
        confined(inputs, method[part].directory),
        path.join(dataset, 'method', part),
        path.join(root, 'publications'),
      );
    const tasks = JSON.parse(await readFile(path.join(dataset, 'tasks.json'), 'utf8'));
    for (const task of tasks) {
      task.inputDigest = await treeDigest(confined(dataset, task.input));
      task.evaluationDigest = await treeDigest(confined(dataset, task.evaluation));
    }
    const search = split === 'development';
    if (search)
      await freeze(catalogDirectory, path.join(dataset, 'capabilities'), path.join(root, 'publications'));
    const specification = Experiment.parse({
      name: 'sb2-' + split,
      purpose: search ? 'search' : 'validation',
      objective:
        'Improve reusable spreadsheet capabilities from source inputs, execution traces and authorized aggregate feedback. Choose discovery, reuse, adaptation, composition or native plugin authoring from evidence. Follow the host mutation scope. Inherit a useful prior candidate when justified; retain valid negative results. Do not encode benchmark task IDs, answers, coordinates or task-specific rules in plugins. Do not change the evaluator or repeat unchanged candidates.',
      hostSearchProtocol: {
        ancestry: 'unrestricted',
        feedback: 'full',
        ...(search ? { screening: { tasks: roster.smoke, minimumBaselineDelta: 0 } } : {}),
      },
      isolation,
      egress,
      runtime: {
        image,
        dshVersion: '0.2.1-rc.4',
        profile: 'sdk',
        environment: {
          directory: 'runtime',
          patch: 'cordis.patch.yml',
          digest: await treeDigest(path.join(dataset, 'runtime')),
        },
      },
      executor: model,
      optimizer: model,
      researchLibrary: null,
      capabilities: search ? { directory: 'capabilities', digest: catalog.digest, resolutionLimit: 3 } : null,
      optimizerHarness: {
        kind: 'artifact',
        source: { ...method.source, directory: 'method/source' },
        artifact: { ...method.artifact, directory: 'method/artifact' },
        composition: method.composition,
      },
      candidate: { patch: 'cordis.patch.yml', build: { image, timeoutSeconds: 600 }, qa: null },
      evaluator: { image, command: ['python3', '/evaluation/grade.py'], timeoutSeconds: 600 },
      tasks,
      repetitions: 1,
      concurrency: 4,
      timeoutSeconds: taskSeconds,
      failureLimit: Math.floor(tasks.length * 0.2),
      budget: { candidates: search ? 4 : 1, optimizerSeconds: search ? 1800 : 1 },
      probes: search ? { limit: 3, timeoutSeconds: 600 } : null,
      metric: {
        name: 'official_modification_accuracy',
        direction: 'maximize',
        minimum: 0,
        maximum: 1,
        failure: 0,
      },
      constraints: [],
    });
    if (search)
      specification.budget.optimizerSeconds = optimizerSecondsForPlan(specification, 1800) + 3 * 600;
    await atomicJSON(path.join(root, split + '-spec.json'), specification);
    result[split] = { specification, dataset: { directory: relative, digest: await treeDigest(dataset) } };
  }
  return {
    splits: result,
    provenance: roster,
    boundary:
      'Public community benchmark subset, family-separated for this study; historical project exposure is possible. This is not an official leaderboard score or a claim of never-seen test data.',
  };
}
