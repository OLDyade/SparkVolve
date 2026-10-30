import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { stringify } from 'yaml';
import { checkComposition } from '../../dist/composition.js';
import { specification } from '../fixtures.js';

test(
  'spreadsheet native QA accepts joint plugin composition and rejects broken dependencies/schema',
  { timeout: 120_000 },
  async () => {
    // Native imports resolve through this repository, as packaged candidate imports do in the image.
    const directory = await mkdtemp(path.resolve('node_modules/.spreadsheet-composition-test-'));
    const seed = path.resolve('tests/fixtures/spreadsheet/seed/index.mjs');
    const patch = path.join(directory, 'candidate.yml');
    const fixture = { id: 'fixture', name: path.resolve('tests/native/fixture-provider.mjs') };
    const run = async (label: string) =>
      checkComposition({
        profile: 'sdk',
        model: {
          ...specification().executor,
          provider: 'evolution-fixture',
          model: 'protocol-test',
          reasoningEffort: null,
        },
        patches: [patch],
        directory: path.join(directory, label),
        processCwd: process.cwd(),
        workspace: directory,
        timeoutSeconds: 20,
      });
    const report = async (label: string) =>
      JSON.parse(await readFile(path.join(directory, label, 'composition.json'), 'utf8'));
    try {
      await writeFile(patch, stringify([{ insert: [fixture, { id: 'workbook', name: seed }] }]));
      await run('seed');
      assert.ok(
        (await report('seed')).tools.some((tool: { name: string }) => tool.name === 'workbook_write'),
      );

      // Configuration, implementation and assembly change together. There is deliberately no index.mjs.
      const entry = path.join(directory, 'workbook-tools.mjs');
      const provider = path.join(directory, 'settings.mjs');
      const original = await readFile(seed, 'utf8');
      const composed = original
        .replace("export const inject = ['tools'];", "export const inject = ['tools', 'workbookSettings'];")
        .replace(
          'export function apply(ctx) {',
          'export function apply(ctx) { if (ctx.workbookSettings.version !== 1) throw new Error("Wrong service configuration");',
        );
      await writeFile(entry, composed);
      await writeFile(
        provider,
        'import Schema from "@deepseek-ai/schemastery"; export const Config = Schema.object({version: Schema.number().required()}); export function apply(ctx, config) { ctx.provide("workbookSettings", config); }',
      );
      await writeFile(
        patch,
        stringify([
          {
            insert: [
              fixture,
              {
                id: 'workbook-composition',
                name: 'cordis:group',
                group: true,
                config: [
                  { id: 'workbook', name: entry },
                  { id: 'workbook-settings', name: provider, config: { version: 1 } },
                ],
              },
            ],
          },
        ]),
      );
      await run('composed');
      assert.equal((await report('composed')).passed, true);
      assert.ok(
        (await report('composed')).tools.some((tool: { name: string }) => tool.name === 'workbook_inspect'),
      );

      await writeFile(
        entry,
        composed.replace('additionalProperties: false,', "required: ['sheet', 'cell', 'value'],"),
      );
      await assert.rejects(run('invalid-schema'), /composition QA failed/);
      assert.match(JSON.stringify((await report('invalid-schema')).audit), /value schema DSL/);

      await writeFile(entry, composed);
      await writeFile(patch, stringify([{ insert: [fixture, { id: 'workbook', name: entry }] }]));
      await assert.rejects(run('missing-service'), /composition QA failed/);
      assert.match(JSON.stringify((await report('missing-service')).audit.pending), /workbookSettings/);
    } finally {
      console.log(`Spreadsheet composition evidence retained: ${directory}`);
    }
  },
);
