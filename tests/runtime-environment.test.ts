import test from 'node:test';
import assert from 'node:assert/strict';
import { command, Docker } from '../src/docker.js';
import { runtimeEnvironment } from '../src/runtime-environment.js';
import { temporaryFilesystems } from '../src/isolation.js';
import { specification } from './fixtures.js';

test('runtime HOME has its own quota inside the native writable /tmp boundary', () => {
  const spec = specification();
  const mounts = temporaryFilesystems({ isolation: spec.isolation } as Parameters<
    typeof temporaryFilesystems
  >[0]);
  assert.match(mounts[runtimeEnvironment.HOME]!, new RegExp(`size=${spec.isolation.homeMiB}m`));
  assert.ok(Object.values(runtimeEnvironment).every((directory) => directory.startsWith('/tmp/')));
  assert.ok(!('/home/node' in mounts));
});

test('runtime initialization exposes conflicting environment before touching the filesystem', async () => {
  await assert.rejects(
    command(
      process.execPath,
      [
        '--import',
        'tsx',
        '--input-type=module',
        '-e',
        "await import('./src/runtime-environment.ts').then(m=>m.initializeRuntimeEnvironment())",
      ],
      { env: { ...process.env, ...runtimeEnvironment, HOME: '/invalid-runtime-home' } },
    ),
    /Invalid managed runtime environment: HOME/,
  );
});

test('container launch rejects conflicting HOME rather than weakening the native sandbox', async () => {
  const spec = specification();
  await assert.rejects(
    new Docker().create({
      name: 'never-created',
      image: spec.runtime.image,
      command: ['true'],
      mounts: [],
      isolation: spec.isolation,
      timeoutSeconds: 600,
      network: 'none',
      env: { HOME: '/home/node' },
    }),
    /Managed runtime environment conflict: HOME/,
  );
});
