import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { stringify } from 'yaml';
import { checkComposition } from '../../dist/composition.js';
import { specification } from '../fixtures.js';

test(
  'full native composition activates nested dependencies and rejects broken patch members',
  { timeout: 120_000 },
  async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'he-composition-'));
    const provider = path.join(root, 'provider.mjs');
    const consumer = path.join(root, 'consumer.mjs');
    await writeFile(provider, 'export function apply(ctx) { ctx.provide("qaEvidence", { value: 7 }); }');
    await writeFile(
      consumer,
      'export const inject=["qaEvidence"]; export function apply(ctx) { if(ctx.qaEvidence.value !== 7) throw new Error("Bad service binding"); }',
    );
    const fixture = { id: 'fixture', name: path.resolve('tests/native/fixture-provider.mjs') };
    const patch = path.join(root, 'candidate.yml');
    const run = async (label: string, profile: 'sdk' | 'sdk-minimal' = 'sdk-minimal') =>
      await checkComposition({
        profile,
        model: {
          ...specification().executor,
          provider: 'evolution-fixture',
          model: 'protocol-test',
          reasoningEffort: null,
        },
        patches: [patch],
        directory: path.join(root, label),
        processCwd: process.cwd(),
        workspace: root,
        timeoutSeconds: 20,
      });
    await writeFile(
      patch,
      stringify([
        {
          insert: [
            fixture,
            {
              id: 'capabilities',
              name: 'cordis:group',
              group: true,
              config: [
                { id: 'consumer', name: consumer },
                { id: 'provider', name: provider },
              ],
            },
          ],
        },
      ]),
    );
    await run('valid');
    const report = JSON.parse(await readFile(path.join(root, 'valid/composition.json'), 'utf8'));
    assert.equal(report.passed, true);
    assert.ok(
      report.entries.some(
        (entry: { module: string; state: number }) =>
          entry.module === pathToFileURL(consumer).href && entry.state === 2,
      ),
    );
    await run('standard', 'sdk');

    const suite = path.join(root, 'suite.mjs');
    await writeFile(
      suite,
      `import assert from 'node:assert/strict';
export async function probe({ctx, call}) {
  assert.equal(ctx.get('qaEvidence').value, 7);
  const result = await call('nonexistent_probe_tool', {});
  assert.equal(result.isError, true);
}`,
    );
    const behavioral = (directory: string) =>
      checkComposition({
        profile: 'sdk-minimal',
        model: {
          ...specification().executor,
          provider: 'evolution-fixture',
          model: 'protocol-test',
          reasoningEffort: null,
        },
        patches: [patch],
        directory: path.join(root, directory),
        processCwd: process.cwd(),
        workspace: root,
        timeoutSeconds: 20,
        behaviorModule: suite,
      });
    await behavioral('observed');
    const observed = JSON.parse(await readFile(path.join(root, 'observed/behavior.json'), 'utf8'));
    assert.equal(observed.status, 'passed');
    assert.equal(observed.observations[0].result.isError, true);
    await writeFile(
      suite,
      `import assert from 'node:assert/strict'; export async function probe({ctx}) { assert.equal(ctx.get('qaEvidence').value, 8); }`,
    );
    await assert.rejects(behavioral('refuted'), /7 !== 8/);
    const refuted = JSON.parse(await readFile(path.join(root, 'refuted/behavior.json'), 'utf8'));
    assert.equal(refuted.status, 'failed');

    await writeFile(patch, stringify([{ insert: [fixture, { id: 'consumer', name: consumer }] }]));
    await assert.rejects(run('missing-service'), /composition QA failed/);
    const failed = JSON.parse(await readFile(path.join(root, 'missing-service/composition.json'), 'utf8'));
    assert.equal(failed.passed, false);
    assert.ok(failed.audit.pending.some((line: string) => line.includes('qaEvidence')));

    await writeFile(
      patch,
      stringify([{ insert: [fixture, { id: 'missing', name: path.join(root, 'absent.mjs') }] }]),
    );
    await assert.rejects(run('missing-module'), /composition QA failed/);
  },
);
