// Execute the documented public journey once; preserve every command and failure.
// This is an engineering acceptance driver, not a search policy or release gate.
import { parseArgs } from 'node:util';
import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { finished } from 'node:stream/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const { values } = parseArgs({
  options: Object.fromEntries(
    ['root', 'image', 'runtime', 'pool', 'dns', 'endpoint'].map((key) => [key, { type: 'string' }]),
  ),
});
for (const key of ['root', 'image', 'runtime', 'pool', 'dns', 'endpoint'])
  if (!values[key]) throw new Error(`Required --${key}`);
if (!process.env.VENUS_API_KEY) throw new Error('Set VENUS_API_KEY through a private Node --env-file');
if (!/^sha256:[a-f0-9]{64}$/.test(values.image)) throw new Error('Pass an immutable image ID');
const endpoint = new URL(values.endpoint);
if (
  endpoint.protocol !== 'http:' ||
  !endpoint.port ||
  endpoint.pathname !== '/' ||
  endpoint.username ||
  endpoint.password ||
  endpoint.search ||
  endpoint.hash
)
  throw new Error('Pass an explicit http://container-reachable-IP:port endpoint');
const checkout = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = path.resolve(values.root);
await mkdir(path.dirname(root), { recursive: true });
await mkdir(root);
await mkdir(path.join(root, 'commands'));
let sequence = 0;
const journal = [];
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
async function record(name, data) {
  await writeFile(path.join(root, name), JSON.stringify(data, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
}
async function step(label, executable, args) {
  const id = `${String(++sequence).padStart(2, '0')}-${label}`;
  const stdoutPath = path.join(root, 'commands', `${id}.stdout`);
  const stderrPath = path.join(root, 'commands', `${id}.stderr`);
  const stdout = createWriteStream(stdoutPath, { flags: 'wx', mode: 0o600 });
  const stderr = createWriteStream(stderrPath, { flags: 'wx', mode: 0o600 });
  const startedAt = new Date().toISOString();
  console.log(`${id} started`);
  const child = spawn(executable, args, {
    cwd: checkout,
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.pipe(stdout);
  child.stderr.pipe(stderr);
  const outcome = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => resolve({ code, signal }));
  });
  await Promise.all([finished(stdout), finished(stderr)]);
  const bytes = await readFile(stdoutPath);
  const entry = {
    id,
    executable,
    args,
    cwd: checkout,
    startedAt,
    finishedAt: new Date().toISOString(),
    ...outcome,
    stdout: { file: path.relative(root, stdoutPath), sha256: hash(bytes) },
    stderr: { file: path.relative(root, stderrPath), sha256: hash(await readFile(stderrPath)) },
  };
  journal.push(entry);
  await record(`commands/${id}.json`, entry);
  console.log(`${id} exit=${outcome.code} signal=${outcome.signal}`);
  if (outcome.code !== 0) throw new Error(`Command ${id} failed; inspect preserved command logs`);
  return bytes.toString();
}
const node = (label, args) => step(label, process.execPath, args);
const cli = (label, args) => node(label, ['dist/cli.js', ...args]);
const image = values.image;
const exampleMount = [
  '--mount',
  `type=bind,src=${path.join(checkout, 'examples/spreadsheet')},dst=/example,readonly`,
];
const workspaceMount = ['--mount', `type=bind,src=${root},dst=/workspace`];
const python = (label, script, ...args) =>
  step(label, 'docker', [
    'run',
    '--rm',
    '--user',
    `${process.getuid()}:${process.getgid()}`,
    ...exampleMount,
    ...workspaceMount,
    image,
    'python3',
    `/example/${script}`,
    ...args,
  ]);
try {
  const revision = (await step('revision', 'git', ['rev-parse', 'HEAD'])).trim();
  const changes = await step('working-tree', 'git', ['status', '--short']);
  const isolation = await node('isolation', [
    'examples/isolation.mjs',
    values.runtime,
    values.pool,
    values.dns,
  ]);
  await writeFile(path.join(root, 'isolation.json'), isolation, { flag: 'wx' });
  await node('image-check', [
    'examples/spreadsheet/verify-image.mjs',
    image,
    path.join(root, 'isolation.json'),
    path.join(root, 'image-check'),
  ]);
  await python('public-inputs', 'generate.py', '/workspace/dataset');
  await node('contract', [
    'examples/spreadsheet/prepare.mjs',
    path.join(root, 'dataset'),
    image,
    'examples/venus/model.json',
    path.join(root, 'spec.json'),
    path.join(root, 'isolation.json'),
  ]);
  const specBytes = await readFile(path.join(root, 'spec.json'));
  await record('registration.json', {
    purpose: 'Public-command engineering acceptance, not a quality benchmark or release approval',
    revision,
    changes,
    image,
    specificationSha256: hash(specBytes),
    scriptSha256: hash(await readFile(fileURLToPath(import.meta.url))),
    selection:
      'Highest full-denominator mean among distinct terminal mutations, earliest ordinal on ties, including negative results. No eligible mutation ends this journey without resampling.',
    validation:
      'Public research.py validation family, one repetition per task per arm; previously used in repository development, not unseen heldout data.',
    release:
      'Export is a research archive. Installation requires separate explicit source/semantic review; no automatic distribution.',
  });
  const search = path.join(root, 'search');
  await cli('initialize', [
    'init',
    '--root',
    search,
    '--spec',
    path.join(root, 'spec.json'),
    '--dataset',
    path.join(root, 'dataset'),
    '--seed',
    'examples/spreadsheet/seed',
  ]);
  await cli('evolve', [
    'evolve',
    '--root',
    search,
    '--host',
    '0.0.0.0',
    '--port',
    endpoint.port,
    '--endpoint',
    values.endpoint,
  ]);
  const reportFile = path.join(root, 'search-report.json');
  await cli('report', ['report', '--root', search, '--output', reportFile]);
  const report = JSON.parse(await readFile(reportFile, 'utf8'));
  const selected = report.candidates
    .filter(
      (c) =>
        c.ordinal > 0 && c.complete && Number.isFinite(c.mean) && ['champion', 'rejected'].includes(c.phase),
    )
    .sort((a, b) => b.mean - a.mean || a.ordinal - b.ordinal)[0];
  if (!selected) {
    await record('outcome.json', { status: 'no-eligible-mutation', reportFile, journal });
  } else {
    await record('selection.json', {
      candidate: selected.digest,
      ordinal: selected.ordinal,
      mean: selected.mean,
      reportSha256: hash(await readFile(reportFile)),
    });
    await python('validation-inputs', 'research.py', '/workspace/validation-inputs', 'validation');
    const plan = path.join(root, 'validation-plan');
    await node('validation-plan', [
      'examples/spreadsheet/validation.mjs',
      search,
      selected.digest,
      path.join(root, 'validation-inputs'),
      plan,
      '1',
    ]);
    await cli('validate', [
      'validate',
      '--root',
      path.join(root, 'validation-study'),
      '--spec',
      path.join(plan, 'spec.json'),
      '--dataset',
      path.join(plan, 'dataset'),
      '--arms',
      path.join(plan, 'arms.json'),
    ]);
    await cli('research-export', [
      'export',
      '--root',
      search,
      '--candidate',
      selected.digest,
      '--output',
      path.join(root, 'research-export'),
    ]);
    await record('outcome.json', {
      status: 'completed-awaiting-capability-review',
      selected: selected.digest,
      comparison: 'validation-study/comparison.json',
      journal,
    });
  }
} catch (error) {
  await record('failure.json', { error: String(error), journal });
  throw error;
}
