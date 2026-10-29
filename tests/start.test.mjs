import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Recipe, main } from '../scripts/start.mjs';

test('startup recipes replace task generation, contract and seed without launcher branches', async () => {
  for (const name of ['structured-data', 'spreadsheet']) {
    const recipe = Recipe.parse(
      JSON.parse(await readFile(new URL(`../examples/${name}/recipe.json`, import.meta.url), 'utf8')),
    );
    assert.equal(recipe.name, name);
    for (const file of [recipe.prepare, `${recipe.seed}/package.json`, recipe.preflight].filter(Boolean))
      assert.ok((await readFile(new URL(`../examples/${name}/${file}`, import.meta.url))).length > 0);
  }
  assert.throws(() =>
    Recipe.parse({
      name: 'x',
      dockerfile: null,
      generate: ['python3'],
      prepare: '../outside',
      seed: 'seed',
      preflight: null,
    }),
  );
});

test('startup refuses missing deployment pool before commands or model calls', async () => {
  await assert.rejects(main([]), /reserved private IPv4 CIDR/);
});
