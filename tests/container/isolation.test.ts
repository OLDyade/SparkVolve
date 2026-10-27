import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { Docker, command, type ContainerSpec } from '../../src/docker.js';
import { specification } from '../fixtures.js';

test(
  'real isolation: non-root, read-only source/root, offline network, bounded resources and refusal of drift',
  { timeout: 60_000 },
  async () => {
    const image = process.env.HE_TEST_IMAGE;
    assert.ok(image, 'HE_TEST_IMAGE is required; isolation acceptance never silently skips');
    const root = await mkdtemp(path.join(os.tmpdir(), 'he-isolation-'));
    console.log(`Isolation evidence retained: ${root}`);
    await mkdir(path.join(root, 'work'));
    await mkdir(path.join(root, 'source'));
    await writeFile(path.join(root, 'source/fact'), 'immutable');
    const docker = new Docker();
    const spec: ContainerSpec = {
      name: `he-isolation-${Date.now()}`,
      image,
      isolation: specification().isolation,
      network: 'none',
      env: { PROBE_SECRET: 'not-in-isolation-receipt' },
      timeoutSeconds: 20,
      mounts: [
        { source: path.join(root, 'work'), target: '/workspace', writable: true },
        { source: path.join(root, 'source'), target: '/source', writable: false },
      ],
      command: [
        'node',
        '--input-type=module',
        '-e',
        `
      import assert from 'node:assert/strict';
      import { readFile, writeFile } from 'node:fs/promises';
      import { networkInterfaces } from 'node:os';
      assert.notEqual(process.getuid(), 0);
      await assert.rejects(writeFile('/source/fact', 'changed'));
      await assert.rejects(writeFile('/rootfs-proof', 'changed'));
      assert.ok(Object.values(networkInterfaces()).flat().every(i => i.internal));
      const status = await readFile('/proc/self/status', 'utf8');
      assert.match(status, /NoNewPrivs:\\s+1/);
      assert.match(status, /CapEff:\\s+0+\\n/);
      await writeFile('/home/node/home-proof', 'writeable');
      await writeFile('/tmp/tmp-proof', 'writeable');
      await writeFile('/workspace/proof.json', JSON.stringify({uid:process.getuid(), status}));
    `,
      ],
    };
    const outcome = await docker.run(spec, path.join(root, 'log'));
    assert.equal(outcome.ExitCode, 0, await readFile(path.join(root, 'log/stderr.log'), 'utf8'));
    assert.equal(await readFile(path.join(root, 'source/fact'), 'utf8'), 'immutable');
    const receipt = await readFile(path.join(root, 'log/isolation-final.json'), 'utf8');
    assert.ok(!receipt.includes('not-in-isolation-receipt'));
    assert.equal(JSON.parse(receipt).observed.settings.Runtime, spec.isolation.runtime);
    await docker.run(spec, path.join(root, 'recovery'));
    const mismatch = { ...spec, isolation: { ...spec.isolation, cpus: 1 } };
    await assert.rejects(docker.run(mismatch, path.join(root, 'mismatch')), /isolation mismatch/);
    await command('docker', ['update', '--pids-limit', '128', spec.name]);
    await assert.rejects(docker.collect(spec, path.join(root, 'drift')), /isolation mismatch: pids/);
    const missing = {
      ...spec,
      name: `${spec.name}-unavailable`,
      isolation: { ...spec.isolation, runtime: 'he-unregistered-runtime' },
    };
    await assert.rejects(docker.create(missing), /runtime is unavailable/);
    assert.equal(await docker.inspect(missing.name), undefined);
  },
);
