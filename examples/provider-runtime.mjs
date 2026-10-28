import assert from 'node:assert/strict';
import { cp, realpath } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/** Researcher-selected host preparation module; frozen output is the runtime contract. */
export async function prepareProvider(source, destination, model, timeoutSeconds) {
  assert.ok(source, 'An explicit provider runtime directory is required');
  const directory = await realpath(source);
  const { configureEgress } = await import(pathToFileURL(path.join(directory, 'egress.mjs')).href);
  assert.equal(typeof configureEgress, 'function', 'Provider must export configureEgress');
  await cp(directory, destination, { recursive: true, force: false, errorOnExist: true });
  return configureEgress(destination, model, timeoutSeconds);
}
