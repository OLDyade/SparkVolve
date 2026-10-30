import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { specification } from './fixtures.js';

for (const elapsed of [125_000, 600_000]) {
  test(`QA command shares the remaining budget after ${elapsed}ms of composition`, async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'he-qa-budget-'));
    try {
      const loader = path.join(root, 'clock-and-services.mjs');
      // Run the production entrypoint; replace only its services and clock, never budget arithmetic.
      await writeFile(
        loader,
        `import { registerHooks } from 'node:module';
globalThis.__qaClock = 1000;
Date.now = () => globalThis.__qaClock;
registerHooks({ load(url, context, next) {
  if (url.endsWith('/dist/runtime-environment.js')) return { format: 'module', shortCircuit: true,
    source: 'export async function initializeRuntimeEnvironment() {}' };
  if (url.endsWith('/dist/composition.js')) return { format: 'module', shortCircuit: true,
    source: 'export async function checkComposition() { globalThis.__qaClock += ${elapsed}; }' };
  if (url.endsWith('/dist/docker.js')) return { format: 'module', shortCircuit: true,
    source: 'export async function command(program, args, options) { return JSON.stringify({ commandStarted: true, timeoutMs: options.timeoutMs }); }' };
  return next(url, context);
}});
`,
      );
      const config = path.join(root, 'qa.json');
      await writeFile(
        config,
        JSON.stringify({
          profile: 'sdk',
          model: specification().executor,
          bundle: null,
          patches: ['/fixture.yml'],
          command: ['fixture'],
          behaviorModule: null,
          timeoutSeconds: 600,
        }),
      );
      const result = spawnSync(
        process.execPath,
        ['--import', loader, path.resolve('dist/runtime/qa.js'), config],
        { encoding: 'utf8', timeout: 10_000 },
      );
      assert.ifError(result.error);
      if (elapsed < 600_000) {
        assert.equal(result.status, 0, result.stderr);
        assert.deepEqual(JSON.parse(result.stdout), { commandStarted: true, timeoutMs: 475_000 });
      } else {
        assert.notEqual(result.status, 0);
        assert.equal(result.stdout, '');
        assert.match(result.stderr, /QA execution budget exhausted during native composition/);
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
}
