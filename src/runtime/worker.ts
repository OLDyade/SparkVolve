import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { DeepSeekHarness } from '@deepseek-ai/dsh-sdk-client';
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm';
import { z } from 'zod';
import { Model } from '../contracts.js';
import { stringify } from 'yaml';
import { requestMetrics } from '../metrics.js';

const config = z
  .strictObject({
    profile: z.enum(['sdk', 'sdk-minimal']),
    model: Model,
    patch: z.string(),
    environmentPatch: z.string().nullable(),
    methodPatch: z.string().optional(),
    prompt: z.string(),
    timeoutSeconds: z.number().positive(),
  })
  .parse(JSON.parse(readFileSync(process.argv[2]!, 'utf8')));
mkdirSync('/trace', { recursive: true });
const startedAt = new Date().toISOString();
writeFileSync('/trace/requests.jsonl', '', { mode: 0o600 });
writeFileSync(
  '/tmp/evolution-observer.yml',
  stringify([
    {
      insert: [
        {
          id: 'evolution-observer',
          name: '/app/dist/telemetry.js',
          config: {
            file: '/trace/requests.jsonl',
            provider: config.model.provider,
            model: config.model.model,
            startedAt: Date.parse(startedAt),
            timeoutSeconds: config.timeoutSeconds,
          },
        },
      ],
    },
  ]),
);
const runtime = new DeepSeekHarness({
  profile: config.profile,
  patches: [
    ...(config.environmentPatch ? [config.environmentPatch] : []),
    ...(config.methodPatch ? [config.methodPatch] : []),
    config.patch,
    '/tmp/evolution-observer.yml',
  ],
  dshHome: '/trace/dsh',
  processCwd: '/app',
  cwd: '/workspace',
  provider: config.model.provider,
  model: config.model.model,
  ...(config.model.reasoningEffort === null
    ? {}
    : { reasoningEffort: ReasoningEffortId(config.model.reasoningEffort) }),
  maxTokens: config.model.maxTokens,
  requestTimeoutMs: config.timeoutSeconds * 1000,
  initializeTimeoutMs: 60_000,
  env: { ...process.env, DSH_MAX_TOKENS_AS_SUCCESS: 'false' },
});
try {
  const result = await runtime.run(config.prompt, {
    onNotification(notification) {
      appendFileSync('/trace/notifications.jsonl', `${JSON.stringify(notification)}\n`, { mode: 0o600 });
    },
  });
  writeFileSync('/trace/result.json', JSON.stringify(result), { mode: 0o600 });
  const endings = result.events.filter((event) => event.type === 'turn/end');
  if (!endings.length || endings.some((event) => event.data.reason.kind !== 'completed'))
    throw new Error(`Native turn did not complete: ${JSON.stringify(endings)}`);
  writeFileSync(
    '/trace/receipt.json',
    JSON.stringify({
      startedAt,
      endedAt: new Date().toISOString(),
      sessionId: result.sessionId,
      status: 'completed',
    }),
  );
} catch (error) {
  writeFileSync(
    '/trace/receipt.json',
    JSON.stringify({ startedAt, endedAt: new Date().toISOString(), status: 'failed', error: String(error) }),
  );
  process.exitCode = 1;
} finally {
  await runtime.close();
  writeFileSync('/trace/metrics.json', JSON.stringify(await requestMetrics('/trace/requests.jsonl')));
}
