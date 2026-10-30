import { DeepSeekHarness } from '@deepseek-ai/dsh-sdk-client';
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stringify } from 'yaml';
import type { ModelSpec } from './contracts.js';
import { prepareBundleProfile } from './bundle-profile.js';

export interface CompositionOptions {
  profile: 'sdk' | 'sdk-minimal';
  model: ModelSpec;
  patches: string[];
  bundle?: string;
  directory: string;
  processCwd: string;
  workspace: string;
  timeoutSeconds: number;
  behaviorModule?: string;
}

/** Exercise the same native profile and patch stack used by execution, without inference. */
export async function checkComposition(options: CompositionOptions): Promise<void> {
  const directory = path.resolve(options.directory);
  await mkdir(directory, { recursive: true });
  const report = path.join(directory, 'composition.json');
  const patch = path.join(directory, 'probe.yml');
  await writeFile(
    patch,
    stringify([
      {
        insert: [
          {
            id: 'evolution-composition-probe',
            name: fileURLToPath(new URL('./composition-probe.js', import.meta.url)),
            config: {
              report,
              workspace: options.workspace,
              ...(options.behaviorModule ? { behaviorModule: options.behaviorModule } : {}),
            },
          },
        ],
      },
    ]),
  );
  if (options.bundle)
    await prepareBundleProfile(options.profile, path.join(directory, 'dsh'), options.bundle);
  const runtime = new DeepSeekHarness({
    profile: options.profile,
    patches: [...options.patches, patch],
    dshHome: path.join(directory, 'dsh'),
    processCwd: options.processCwd,
    cwd: options.workspace,
    provider: options.model.provider,
    model: options.model.model,
    ...(options.model.reasoningEffort === null
      ? {}
      : { reasoningEffort: ReasoningEffortId(options.model.reasoningEffort) }),
    maxTokens: options.model.maxTokens,
    initializeTimeoutMs: options.timeoutSeconds * 1000,
    requestTimeoutMs: options.timeoutSeconds * 1000,
    env: { ...process.env, DSH_MAX_TOKENS_AS_SUCCESS: 'false' },
  });
  try {
    await runtime.start();
    await runtime.session().getWorkingDirectory();
    const result = JSON.parse(await readFile(report, 'utf8')) as { passed: boolean };
    if (result.passed !== true) throw new Error('Native composition QA did not pass');
  } finally {
    await runtime.close();
  }
}
