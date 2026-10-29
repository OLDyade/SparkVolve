/** Build a static public tour exclusively from committed, inspectable evidence. */
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkLinks } from './check-links.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = path.join(root, '.site');
const evidencePath = 'docs/evidence/official-deepseek-20261028';
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const read = (file) => readFile(path.join(root, file));
const json = async (file) => JSON.parse(await read(file));
const evidence = await json(`${evidencePath}/autonomous.json`);
const installed = await json(`${evidencePath}/autonomous-installed.json`);
const escape = (value) =>
  String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
const percent = (value) => `${Number((value * 100).toFixed(2))}%`;
const manifest = [];
const published = [];
await rm(output, { recursive: true, force: true });
const put = async (file, bytes) => {
  await mkdir(path.dirname(path.join(output, file)), { recursive: true });
  await writeFile(path.join(output, file), bytes);
  published.push(file);
};
const copy = async (from, to) => {
  const bytes = await read(from);
  manifest.push({ source: from, published: to, sha256: hash(bytes), bytes: bytes.length });
  await put(to, bytes);
};

assert.equal(evidence.search.length, 3);
const tasks = evidence.search[0].samples.map((sample) => sample.task);
assert.equal(new Set(tasks).size, 4);
const arm = (label, candidate, mean, samples) => {
  assert.equal(samples.length, tasks.length, `${label}: denominator`);
  assert.deepEqual([...samples.map((sample) => sample.task)].sort(), [...tasks].sort());
  for (const sample of samples) {
    assert.equal(sample.phase, 'scored');
    assert.ok(Number.isFinite(sample.score) && sample.score >= 0 && sample.score <= 1);
  }
  assert.equal(samples.reduce((sum, sample) => sum + sample.score, 0) / tasks.length, mean, `${label}: mean`);
  return { label, candidate, mean, samples: samples.map(({ task, score }) => ({ task, score })) };
};
const search = evidence.search.map((row, i) => {
  assert.equal(row.expectedRuns, tasks.length);
  assert.equal(row.scoredRuns, tasks.length);
  assert.equal(row.failedRuns, 0);
  return arm(`H${i}`, row.digest, row.mean, row.samples);
});
const validation = evidence.validation.results.map((row) =>
  arm(row.id === 'h0' ? 'H0' : 'H2', row.candidate, row.mean, row.samples),
);
assert.equal(validation.length, 2);
assert.equal(validation[0].candidate, search[0].candidate);
assert.equal(validation[1].candidate, search[2].candidate);
assert.equal(installed.registration.sourceDigest, search[2].candidate);
assert.equal(installed.result.registered, tasks.length);
assert.equal(installed.result.scored, tasks.length);
const archiveHash = installed.registration.build.tarballDigest;
assert.equal(archiveHash, evidence.search[2].build.tarballDigest);
for (const row of installed.result.rows) {
  assert.equal(row.installation.tarballDigest, archiveHash);
  assert.equal(row.integrity.tarballDigest, archiveHash);
  assert.deepEqual(row.integrity.files, row.installation.files);
}
const reuse = arm(
  'Installed H2',
  search[2].candidate,
  installed.result.quality.meanWithRegisteredFailureValue,
  installed.result.rows.map((row) => ({ task: row.task, phase: row.phase, score: row.grade.score })),
);
const snapshots = [];
for (let i = 0; i < search.length; i++) {
  const mutation = evidence.mutations[i === 0 ? 0 : i - 1];
  assert.equal(i === 0 ? mutation.comparisonBase : mutation.candidate, search[i].candidate);
  const source = {};
  for (const name of ['index.mjs', 'workbook.py']) {
    const file = `${evidencePath}/source/h${i}/${name}`;
    const bytes = await read(file);
    assert.equal(
      hash(bytes),
      mutation.files.find((item) => item.file === name)[i === 0 ? 'before' : 'after'],
      file,
    );
    if (i === 2)
      for (const row of installed.result.rows)
        assert.equal(row.installation.files.find((item) => item.path === name).hash, hash(bytes));
    source[name] = bytes.toString();
    await copy(file, `evidence/source/h${i}/${name}`);
  }
  snapshots.push(source);
}
assert.equal(snapshots[1]['workbook.py'], snapshots[2]['workbook.py']);
const excerpts = {
  before:
    "      name: 'workbook_write',\n      description:\n        'Apply explicit caller-supplied values or formulas to a copy of an XLSX workbook. Preserve original input. Destination must be inside /workspace. Does not calculate formulas or certify correctness.',",
  after:
    "        converted, detail = convert_with_engine(\n            isolated, tmp_path / 'out', tmp_path / 'profile'\n        )\n        original_book = load_workbook(source)\n        # data_only reads the cached results the engine stored beside each formula.\n        calculated_book = load_workbook(converted, data_only=True)",
};
assert.ok(snapshots[0]['index.mjs'].includes(excerpts.before));
assert.ok(snapshots[1]['workbook.py'].includes(excerpts.after));
await copy(`${evidencePath}/autonomous.json`, 'evidence/autonomous.json');
await copy(`${evidencePath}/autonomous-installed.json`, 'evidence/installed.json');
await copy(`${evidencePath}/sources.json`, 'evidence/sources.json');
for (const [from, to] of [
  [0, 1],
  [1, 2],
]) {
  const name = `h${from}-to-h${to}.patch`;
  const diff = spawnSync(
    'git',
    [
      'diff',
      '--no-index',
      '--no-ext-diff',
      '--no-textconv',
      '--no-color',
      '--diff-algorithm=myers',
      '--abbrev=7',
      '--src-prefix=a/',
      '--dst-prefix=b/',
      '--unified=3',
      '--',
      `h${from}`,
      `h${to}`,
    ],
    {
      cwd: path.join(root, evidencePath, 'source'),
      encoding: 'utf8',
    },
  );
  assert.equal(diff.status, 1, diff.stderr);
  assert.equal(
    (await read(`${evidencePath}/source/${name}`)).toString(),
    diff.stdout,
    `${name}: patch differs from source snapshots`,
  );
  await copy(`${evidencePath}/source/${name}`, `evidence/source/${name}`);
}
const data = {
  schema: 'sparkvolve-public-case-v1',
  date: '2026-10-28',
  tasks,
  search,
  validation,
  reuse,
  archiveHash,
  boundary: evidence.boundary,
  sources: manifest,
};
await put('evidence/case.json', `${JSON.stringify(data, null, 2)}\n`);
const labels = ['Read + write', 'Add engine-backed calculation', 'Refine tool contracts'];
const lineage = search
  .map(
    (row, i) =>
      `<article class="version"><small>${row.label} · ${i === 0 ? 'Baseline' : 'Autonomous candidate'}</small><strong>${percent(row.mean)}</strong><span>${labels[i]}</span><div class="bar" style="width:${row.mean * 100}%" aria-hidden="true"></div></article>`,
  )
  .join('\n');
const scoreTable = `<thead><tr><th scope="col">Task</th>${search.map((row) => `<th scope="col">${row.label}</th>`).join('')}</tr></thead><tbody>${tasks.map((task) => `<tr><th scope="row">${escape(task)}</th>${search.map((row) => `<td>${percent(row.samples.find((sample) => sample.task === task).score)}</td>`).join('')}</tr>`).join('')}</tbody><tfoot><tr><th scope="row">Mean · full denominator</th>${search.map((row) => `<td>${percent(row.mean)}</td>`).join('')}</tr></tfoot>`;
const values = {
  lineage,
  scoreTable,
  before: escape(excerpts.before),
  after: escape(excerpts.after),
  patch01: escape((await read(`${evidencePath}/source/h0-to-h1.patch`)).toString()),
  patch12: escape((await read(`${evidencePath}/source/h1-to-h2.patch`)).toString()),
  reusePassed: reuse.samples.filter((sample) => sample.score === 1).length,
  reuseTotal: tasks.length,
  archiveHash,
  caseData: JSON.stringify(data).replaceAll('<', '\\u003c'),
};
const template = (await read('site/index.html')).toString();
const html = template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
  assert.ok(Object.hasOwn(values, key), `Unknown site field: ${key}`);
  return values[key];
});
await put('index.html', html);
await copy('site/style.css', 'style.css');
await copy('site/app.js', 'app.js');
for (const file of ['assets/brand/logo.png', 'assets/readme/hero.png', 'assets/readme/evolution-loop.png'])
  await copy(`docs/${file}`, file);
// Preserve the older negative experiment. Its documentation links point to the repository.
const historicalTour = (await read('docs/tour.html'))
  .toString()
  .replace(/href="([^"#]+)"/g, (match, href) => {
    if (/^[a-z]+:/i.test(href)) return match;
    const target = new URL(href, 'https://github.com/OLDyade/SparkVolve/blob/main/docs/').href;
    return `href="${target}"`;
  });
await put('tour.html', historicalTour);
await put('.nojekyll', '');
await put('evidence/manifest.json', `${JSON.stringify({ sources: manifest }, null, 2)}\n`);
const links = await checkLinks(output, published);
console.log(
  `Built .site: ${published.length} public files, ${links} local links, 6 source hashes and all 24 task scores verified.`,
);
