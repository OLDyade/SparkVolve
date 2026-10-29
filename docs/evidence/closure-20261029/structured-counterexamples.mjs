/** Native, network-disabled observations of the frozen rejected candidate.
 * These checks do not alter the registered task scores or candidate source.
 */
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';

export async function probe({ call, observe }) {
  await writeFile('/workspace/array.json', JSON.stringify([{ amount: 7 }]));
  const array = await call('data_verify', {
    file: '/workspace/array.json', format: 'json',
    shape: { kind: 'object', properties: { amount: 'integer' } },
  });
  assert.equal(array.isError, false);
  const arrayFacts = JSON.parse(array.value);
  observe('array-accepted-as-object', { input: [{ amount: 7 }], observed: arrayFacts });
  assert.equal(arrayFacts.valid, true);
  assert.equal(arrayFacts.rootType, 'object');

  await writeFile('/workspace/object.json', JSON.stringify({ amount: 7 }));
  const keys = await call('data_verify', {
    file: '/workspace/object.json', format: 'json',
    shape: { kind: 'object', properties: { amount: 'integer' } },
    expect_keys: ['different'],
  });
  assert.equal(keys.isError, false);
  const keyFacts = JSON.parse(keys.value);
  observe('key-mismatch-still-valid', keyFacts);
  assert.equal(keyFacts.keySetMatches, false);
  assert.equal(keyFacts.valid, true);
}
