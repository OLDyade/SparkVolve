import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parse, stringify } from 'yaml';
import { timeoutSeconds as parseTimeoutSeconds } from '../timeouts.mjs';

/** Explicit native Messages route: no provider fallback or hidden catalog request. */
export async function configureEgress(directory, model, seconds) {
  const timeoutSeconds = parseTimeoutSeconds(seconds);
  const file = path.join(directory, 'cordis.patch.yml');
  const patch = parse(await readFile(file, 'utf8'));
  const provider = patch.find((entry) => entry.id === 'llm-deepseek').config;
  assert.equal(model.provider, 'deepseek-official');
  assert.deepEqual(model.credentialEnv, [provider.apiKeyEnv]);
  assert.ok(
    provider.models.some((entry) => entry.id === model.model),
    'Model absent from frozen catalog',
  );
  const route = {
    id: 'deepseek-official',
    path: '/anthropic/v1/messages',
    method: 'POST',
    upstream: `${provider.baseURL.replace(/\/$/, '')}/v1/messages`,
    addresses: { kind: 'public' },
    credential: { env: provider.apiKeyEnv, header: 'x-api-key', prefix: '' },
    body: { kind: 'json', equals: { model: model.model }, maximum: { max_tokens: model.maxTokens } },
    maxRequestBytes: 8 * 1024 * 1024,
    timeoutSeconds,
    forwardHeaders: ['anthropic-version', 'anthropic-beta', 'accept'],
  };
  provider.baseURL = 'http://evolution-egress:8080/anthropic';
  provider.streamIdleTimeoutMs = timeoutSeconds * 1000;
  provider.maxTokens = model.maxTokens;
  await writeFile(file, stringify(patch));
  return { optimizer: [route], executor: [route] };
}
