// Prepare an independent paired protocol from a completed search and fresh task inputs.
import { mkdir, readFile, writeFile, cp } from 'node:fs/promises';
import path from 'node:path';
import { treeDigest, confined } from '../../../dist/artifacts.js';
import { Experiment } from '../../../dist/contracts.js';
import { Store } from '../../../dist/store.js';

const [search, candidate, freshDataset, output, repeats] = process.argv.slice(2);
if (!search || !candidate || !freshDataset || !output || !repeats)
  throw new Error(
    'Usage: validation.mjs <search-root> <candidate-digest> <fresh-dataset> <new-plan-directory> <repetitions>',
  );
const original = Experiment.parse(JSON.parse(await readFile(path.join(search, 'experiment.json'), 'utf8')));
const store = new Store(path.join(search, 'experiment.sqlite'), original);
try {
  const baseline = store.candidates()[0];
  const selected = store.candidate(candidate);
  if (!baseline || baseline.digest === candidate)
    throw new Error('Select a distinct terminal candidate for paired validation');
  if ([baseline, selected].some((c) => !['champion', 'rejected'].includes(c.phase)))
    throw new Error('Both arms must have completed search results');
  await mkdir(output);
  const data = path.resolve(output, 'dataset');
  await cp(freshDataset, data, { recursive: true, force: false, errorOnExist: true });
  for (const ref of [
    original.runtime.environment,
    original.optimizerHarness.source,
    ...(original.optimizerHarness.kind === 'artifact'
      ? [
          {
            directory: original.optimizerHarness.artifact.directory,
            digest: original.optimizerHarness.artifact.identity.artifactDigest,
          },
        ]
      : []),
    original.candidate.qa,
  ].filter(Boolean)) {
    const source = confined(path.join(search, 'dataset'), ref.directory);
    if ((await treeDigest(source)) !== ref.digest)
      throw new Error(`Frozen dependency changed: ${ref.directory}`);
    await cp(source, confined(data, ref.directory), {
      recursive: true,
      force: false,
      errorOnExist: true,
    });
    if ((await treeDigest(confined(data, ref.directory))) !== ref.digest)
      throw new Error(`Copied dependency changed: ${ref.directory}`);
  }
  const tasks = JSON.parse(await readFile(path.join(data, 'tasks.json'), 'utf8'));
  for (const task of tasks) {
    task.inputDigest = await treeDigest(confined(data, task.input));
    task.evaluationDigest = await treeDigest(confined(data, task.evaluation));
  }
  const spec = Experiment.parse({
    ...original,
    name: 'spreadsheet-independent-validation',
    purpose: 'validation',
    tasks,
    repetitions: Number(repeats),
    budget: { ...original.budget, candidates: 1 },
    probes: null,
  });
  const arms = [baseline, selected].map((entry, i) => ({
    id: i ? 'candidate' : 'baseline',
    source: path.resolve(search, 'candidates', entry.digest),
    digest: entry.digest,
    artifact: path.resolve(search, 'artifacts', entry.digest),
    build: entry.build,
  }));
  await writeFile(path.join(output, 'spec.json'), JSON.stringify(spec, null, 2));
  await writeFile(path.join(output, 'arms.json'), JSON.stringify(arms, null, 2));
  console.log(
    JSON.stringify({
      plan: path.resolve(output),
      tasks: tasks.length,
      repetitions: spec.repetitions,
      arms: arms.map((a) => a.digest),
    }),
  );
} finally {
  store.close();
}
