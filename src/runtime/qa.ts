import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { Model } from '../contracts.js';
import { checkComposition } from '../composition.js';
import { initializeRuntimeEnvironment } from '../runtime-environment.js';
await initializeRuntimeEnvironment();
import { command } from '../docker.js';

const config = z
  .strictObject({
    profile: z.enum(['sdk', 'sdk-minimal']),
    model: Model,
    patches: z.array(z.string()),
    bundle: z.string().nullable(),
    command: z.array(z.string()).min(1).nullable(),
    behaviorModule: z.string().nullable(),
    timeoutSeconds: z.number().positive(),
  })
  .parse(JSON.parse(await readFile(process.argv[2]!, 'utf8')));

const deadline = Date.now() + config.timeoutSeconds * 1000;

await checkComposition({
  profile: config.profile,
  model: config.model,
  patches: config.patches,
  ...(config.bundle ? { bundle: config.bundle } : {}),
  directory: '/workspace/native',
  processCwd: '/app',
  workspace: '/workspace',
  timeoutSeconds: config.timeoutSeconds,
  ...(config.behaviorModule ? { behaviorModule: config.behaviorModule } : {}),
});
// Domain QA remains a separate, explicit check of synthetic business behaviour.
if (config.command !== null) {
  const remainingMs = deadline - Date.now();
  if (remainingMs <= 0) throw new Error('QA execution budget exhausted during native composition');
  process.stdout.write(
    await command(config.command[0]!, config.command.slice(1), {
      timeoutMs: remainingMs,
    }),
  );
}
