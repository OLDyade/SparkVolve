import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parse, stringify } from 'yaml';
import { timeoutSeconds as parseTimeoutSeconds } from '../timeouts.mjs';

/** Example-specific provider configuration. Core routing is declared in the experiment contract. */
export async function configureEgress(directory, model, timeoutSeconds = undefined) {
  timeoutSeconds = parseTimeoutSeconds(timeoutSeconds);
  const file = path.join(directory, 'cordis.patch.yml');
  const patch = parse(await readFile(file, 'utf8'));
  const provider = patch.find((entry) => entry.id === 'llm-pi-ai').config.providers.venus;
  if (
    model.provider !== 'venus' ||
    model.credentialEnv.length !== 1 ||
    model.credentialEnv[0] !== provider.apiKeyEnv
  )
    throw Error('Venus example requires the declared provider and its single credential environment');
  const route = {
    id: 'venus',
    path: '/v1/chat/completions',
    method: 'POST',
    upstream: new URL('chat/completions', `${provider.baseURL.replace(/\/$/, '')}/`).href,
    addresses: { kind: 'public' },
    credential: { env: provider.apiKeyEnv, header: 'authorization', prefix: 'Bearer ' },
    body: { kind: 'json', equals: { model: model.model }, maximum: { max_tokens: model.maxTokens } },
    maxRequestBytes: 8 * 1024 * 1024,
    timeoutSeconds,
  };
  provider.baseURL = 'http://evolution-egress:8080/v1';
  provider.timeoutMs = timeoutSeconds * 1000;
  provider.streamIdleTimeoutMs = timeoutSeconds * 1000;
  await writeFile(file, stringify(patch));
  return { optimizer: [route], executor: [route] };
}
