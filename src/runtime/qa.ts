import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { Model } from '../contracts.js';
import { checkComposition } from '../composition.js';
import { command } from '../docker.js';

const config = z
  .strictObject({
    profile: z.enum(['sdk', 'sdk-minimal']),
    model: Model,
    patches: z.array(z.string()).min(1),
    command: z.array(z.string()).min(1),
    timeoutSeconds: z.number().positive(),
  })
  .parse(JSON.parse(await readFile(process.argv[2]!, 'utf8')));

await checkComposition({
  profile: config.profile,
  model: config.model,
  patches: config.patches,
  directory: '/workspace/native',
  processCwd: '/app',
  workspace: '/workspace',
  timeoutSeconds: config.timeoutSeconds,
});
// Domain QA remains a separate, explicit check of synthetic business behaviour.
process.stdout.write(
  await command(config.command[0]!, config.command.slice(1), {
    timeoutMs: config.timeoutSeconds * 1000,
  }),
);
