import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, chmod, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { buildCandidate, bundlePath, verifyBuild } from '../../src/build.js';
import { freeze, treeDigest, fileDigest, digest } from '../../src/artifacts.js';
import { Docker, command } from '../../src/docker.js';
import { candidate, containerSpecification as specification } from '../fixtures.js';

test(
  'locked TypeScript build bundles runtime dependencies; recovery reuses original container; tampering fails',
  { timeout: 180_000 },
  async () => {
    const image = process.env.HE_TEST_IMAGE;
    assert.ok(image, 'HE_TEST_IMAGE is required; no skipped container acceptance');
    const root = await mkdtemp(path.join(os.tmpdir(), 'he-compiled-build-'));
    console.log(`Compiled build evidence retained: ${root}`);
    const source = path.join(import.meta.dirname, 'build-fixture');
    const hash = await treeDigest(source);
    await freeze(source, path.join(root, 'candidates', hash), path.join(root, 'publications'));
    const spec = specification();
    spec.candidate.build = { image, timeoutSeconds: 120 };
    spec.isolation.network.build = 'bridge';
    const record = candidate(hash),
      docker = new Docker();
    record.build = await buildCandidate(root, root, spec, record, docker);
    const container = `he-build-${digest([root, hash]).slice(0, 32)}`;
    const identity = await command('docker', ['inspect', '--format', '{{.Id}}', container]);
    const same = await buildCandidate(root, root, spec, record, docker);
    assert.deepEqual(same, record.build);
    assert.equal(await command('docker', ['inspect', '--format', '{{.Id}}', container]), identity);
    await verifyBuild(root, record);
    const bundle = bundlePath(root, record);
    assert.equal(
      JSON.parse(await readFile(path.join(bundle, 'node_modules/is-number/package.json'), 'utf8')).version,
      '7.0.0',
    );
    assert.equal(
      await fileDigest(path.join(root, 'artifacts', hash, 'bundle.tgz')),
      record.build.tarballDigest,
    );
    const work = path.join(root, 'consume');
    await mkdir(work);
    const result = await docker.run(
      {
        name: `he-consume-${hash.slice(0, 24)}-${Date.now()}`,
        isolation: spec.isolation,
        image,
        command: [
          'node',
          '--input-type=module',
          '-e',
          "import { numeric } from '/candidate/dist/index.js'; if (!numeric('42') || numeric('x')) throw Error('Bundled dependency failed');",
        ],
        mounts: [
          { source: bundle, target: '/candidate', writable: false },
          { source: work, target: '/workspace', writable: true },
        ],
        network: 'none',
        env: {},
        timeoutSeconds: 30,
      },
      path.join(root, 'consume-log'),
    );
    assert.equal(result.ExitCode, 0, await readFile(path.join(root, 'consume-log/stderr.log'), 'utf8'));
    const installed = path.join(root, 'installed');
    await mkdir(installed);
    await writeFile(
      path.join(installed, 'package.json'),
      JSON.stringify({ name: 'clean-consumer', private: true, type: 'module' }),
    );
    const install = await docker.run(
      {
        name: `he-install-built-${hash.slice(0, 24)}-${Date.now()}`,
        isolation: spec.isolation,
        image,
        command: [
          'npm',
          'install',
          '--prefix',
          '/workspace',
          '--offline',
          '--ignore-scripts',
          '--omit=dev',
          '--omit=peer',
          '--no-audit',
          '--no-fund',
          '/bundle.tgz',
        ],
        mounts: [
          {
            source: path.join(root, 'artifacts', hash, 'bundle.tgz'),
            target: '/bundle.tgz',
            writable: false,
          },
          { source: installed, target: '/workspace', writable: true },
        ],
        network: 'none',
        env: { npm_config_cache: '/tmp/npm-cache' },
        timeoutSeconds: 30,
      },
      path.join(root, 'install-log'),
    );
    assert.equal(install.ExitCode, 0, await readFile(path.join(root, 'install-log/stderr.log'), 'utf8'));
    const installedRun = await docker.run(
      {
        name: `he-run-installed-${hash.slice(0, 24)}-${Date.now()}`,
        isolation: spec.isolation,
        image,
        command: [
          'node',
          '--input-type=module',
          '-e',
          "import { numeric } from '/workspace/node_modules/@harness-evolution/compiled-fixture/dist/index.js'; if (!numeric(42) || numeric('x')) throw Error('Installed package failed');",
        ],
        mounts: [{ source: installed, target: '/workspace', writable: false }],
        network: 'none',
        env: {},
        timeoutSeconds: 30,
      },
      path.join(root, 'installed-run-log'),
    );
    assert.equal(
      installedRun.ExitCode,
      0,
      await readFile(path.join(root, 'installed-run-log/stderr.log'), 'utf8'),
    );
    const compiled = path.join(bundle, 'dist/index.js');
    await chmod(compiled, 0o644);
    await writeFile(compiled, 'tampered');
    await assert.rejects(verifyBuild(root, record), /integrity mismatch/);
  },
);
