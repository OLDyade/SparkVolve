import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rename, cp, chmod, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../src/store.js';
import { exportCandidate, archiveIdentity } from '../src/export.js';
import { atomicJSON, treeDigest, fileDigest } from '../src/artifacts.js';
import { experimentReport } from '../src/report.js';
import { specification, candidate, runs } from './fixtures.js';

async function remove(directory: string) {
  await chmod(directory, 0o700);
  for (const entry of await readdir(directory, { withFileTypes: true }))
    if (entry.isDirectory()) await remove(path.join(directory, entry.name));
  await rm(directory, { recursive: true, force: true });
}

async function fixture(build: boolean) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'he-capability-card-'));
  const spec = specification();
  spec.objective = 'Declared objective | <img src=x onerror=alert(1)>\n````\n# injected heading';
  const store = new Store(path.join(root, 'state.sqlite'), spec);
  const temporary = path.join(root, 'seed');
  await mkdir(temporary);
  await atomicJSON(path.join(temporary, 'package.json'), {
    name: '@fixture/capability-card',
    version: '1.0.0',
    dsh: { bundle: { patch: './cordis.patch.yml' } },
  });
  await atomicJSON(path.join(temporary, 'package-lock.json'), { lockfileVersion: 3, packages: {} });
  await writeFile(path.join(temporary, 'cordis.patch.yml'), '[]');
  const id = await treeDigest(temporary);
  const source = path.join(root, 'candidates', id);
  await mkdir(path.dirname(source));
  await rename(temporary, source);
  const item = candidate(id);
  item.proposal.hypothesis = 'Model claim\n``````\n<script>alert(1)</script>\n# claim';
  if (build) {
    const artifact = path.join(root, 'artifacts', id);
    await mkdir(artifact, { recursive: true });
    await cp(source, path.join(artifact, 'bundle'), { recursive: true });
    // Transport fixture: this test verifies byte identity through the real export path, not installation.
    await writeFile(path.join(artifact, 'bundle.tgz'), Buffer.from([0, 1, 2, 128, 255, 3]));
    const receipt = {
      sourceDigest: id,
      lockDigest: await fileDigest(path.join(source, 'package-lock.json')),
      bundleDigest: await treeDigest(path.join(artifact, 'bundle')),
      tarballDigest: await fileDigest(path.join(artifact, 'bundle.tgz')),
    };
    await atomicJSON(path.join(artifact, 'receipt.json'), receipt);
    item.build = {
      artifactDigest: await treeDigest(artifact),
      bundleDigest: receipt.bundleDigest,
      tarballDigest: receipt.tarballDigest,
      lockDigest: receipt.lockDigest,
      image: spec.candidate.build.image,
    };
  }
  store.addCandidate(item);
  return { root, spec, store, item, output: path.join(root, 'export') };
}

test('actual export adds a literal, hash-bound card and ledger snapshot without changing the Bundle', async () => {
  const f = await fixture(true);
  try {
    f.store.admit(f.item, runs(f.item.digest));
    const [first, second] = f.store.runs();
    f.store.transition(first!.id, 'queued', 'executing');
    f.store.transition(first!.id, 'executing', 'delivered');
    f.store.transition(first!.id, 'delivered', 'scoring');
    f.store.transition(first!.id, 'scoring', 'scored', {
      grade: { score: 1, metrics: {}, feedback: 'Observed fixture result' },
    });
    f.store.transition(second!.id, 'queued', 'cancelled', { error: 'registered failure policy' });
    f.store.decide(f.item.digest);
    const originalTarball = await fileDigest(path.join(f.root, 'artifacts', f.item.digest, 'bundle.tgz'));
    await exportCandidate(f.root, f.store, f.item.digest, f.output);
    const card = await readFile(path.join(f.output, 'CAPABILITY.md'), 'utf8');
    const record = JSON.parse(await readFile(path.join(f.output, 'research-record.json'), 'utf8'));
    const report = JSON.parse(await readFile(path.join(f.output, 'experiment-report.json'), 'utf8'));
    assert.deepEqual(report, await experimentReport(f.root, f.store));
    assert.deepEqual(record.candidate, f.store.candidate(f.item.digest));
    assert.equal(record.archiveId, archiveIdentity(f.store, f.item.digest));
    assert.equal(await fileDigest(path.join(f.output, 'bundle.tgz')), originalTarball);
    assert.equal(
      await fileDigest(path.join(f.root, 'artifacts', f.item.digest, 'bundle.tgz')),
      originalTarball,
    );
    assert.equal(await treeDigest(path.join(f.output, 'source')), f.item.digest);
    assert.equal(await treeDigest(path.join(f.output, 'artifact')), f.item.build!.artifactDigest);
    assert.match(card, /Expected task executions \| 2/);
    assert.match(card, /Failed or cancelled executions \| 1/);
    assert.match(card, /registered metric \| 0.5/);
    assert.equal(report.candidates[0]!.usage.reportedTotals, null);
    assert.equal(report.candidates[0]!.usage.unavailableLedgers, 2);
    assert.equal(report.candidates[0]!.usage.complete, false);
    assert.equal(report.monetaryCost, null);
    assert.match(card, /Monetary cost: \*\*unknown\*\*/);
    assert.match(card, /usage was not observed/);
    assert.match(card, /export-time snapshot/);
    assert.match(card, /not necessarily the final search ledger/);
    assert.match(card, /No independent replication or transfer result/);
    assert.ok(card.includes(await fileDigest(path.join(f.output, 'research-record.json'))));
    assert.ok(card.includes(await fileDigest(path.join(f.output, 'experiment-report.json'))));

    // Every dynamic text block is literal JSON in a fence longer than any embedded backtick run.
    const blocks = [...card.matchAll(/^(`{3,})json\n([\s\S]*?)\n\1$/gm)];
    const values = blocks.map((block) => JSON.parse(block[2]!));
    assert.ok(values.some((value) => value === f.spec.objective));
    assert.ok(values.some((value) => value?.hypothesis === f.item.proposal.hypothesis));
    const prose = card.replace(/^(`{3,})json\n[\s\S]*?\n\1$/gm, '');
    assert.doesNotMatch(prose, /<script|<img|# injected heading/);
  } finally {
    f.store.close();
    await remove(f.root);
  }
});

test('build failure exports a source card with unknown score and no substitute Bundle', async () => {
  const f = await fixture(false);
  try {
    f.store.updateCandidate({ ...f.item, phase: 'build_failed', buildError: 'compiler rejected source' });
    await exportCandidate(f.root, f.store, f.item.digest, f.output);
    const card = await readFile(path.join(f.output, 'CAPABILITY.md'), 'utf8');
    const report = JSON.parse(await readFile(path.join(f.output, 'experiment-report.json'), 'utf8'));
    assert.ok(!(await readdir(f.output)).includes('bundle.tgz'));
    assert.match(card, /No Bundle was produced/);
    assert.match(card, /compiler rejected source/);
    assert.match(card, /unknown \(not scored completely\)/);
    assert.match(card, /null reportedTotals value means usage was not observed/);
    assert.equal(report.candidates[0].mean, null);
    assert.equal(report.candidates[0].expectedRuns, 2);
    assert.equal(report.candidates[0].observedRuns, 0);
    assert.equal(report.candidates[0].usage.reportedTotals, null);
    assert.doesNotMatch(card, /\[Exact Bundle\]/);
  } finally {
    f.store.close();
    await remove(f.root);
  }
});

test('QA-failed artifacts retain their original Bundle and failure without becoming an accepted capability', async () => {
  const f = await fixture(true);
  try {
    f.store.updateCandidate({ ...f.item, phase: 'qa_failed', qaError: 'native dependency unresolved' });
    await exportCandidate(f.root, f.store, f.item.digest, f.output);
    const card = await readFile(path.join(f.output, 'CAPABILITY.md'), 'utf8');
    assert.match(card, /Candidate state \| qa_failed/);
    assert.match(card, /native dependency unresolved/);
    assert.match(card, /QA-failed candidate remains a research artifact/);
    assert.equal(await fileDigest(path.join(f.output, 'bundle.tgz')), f.item.build!.tarballDigest);
  } finally {
    f.store.close();
    await remove(f.root);
  }
});
