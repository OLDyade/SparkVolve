// Networked distribution acceptance, separate from unit and model-quality tests.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { parse, stringify } from 'yaml';
import { DeepSeekHarness } from '@deepseek-ai/dsh-sdk-client';
import { command } from '../dist/docker.js';
import { sdkPreset } from '../dist/preset.js';

test(
  'packed distribution installs through native DSH and executes its registered capability',
  { timeout: 300000 },
  async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'he-install-'));
    const env = {
      ...process.env,
      DSH_HOME: path.join(root, 'dsh'),
      PATH: path.resolve('node_modules/.bin') + path.delimiter + process.env.PATH,
    };
    let calls = 0;
    const server = createServer((_req, res) => {
      calls++;
      res.writeHead(200).end('{"champion":null}');
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    const patch = path.join(root, 'fixture.yml');
    let runtime;
    try {
      await command(
        path.resolve('node_modules/.bin/dsh'),
        ['--profile', 'sdk-minimal', '--dump-default-config'],
        { env, timeoutMs: 30000 },
      );
      const workspace = path.join(env.DSH_HOME, 'profiles/sdk-minimal/pnpm-workspace.yaml');
      const configuration = parse(await readFile(workspace, 'utf8'));
      configuration.allowBuilds = {
        '@deepseek-ai/dsh-subprocess-local@0.2.1-rc.4': true,
        '@google/genai@2.21.0': true,
        'koffi@3.1.1': true,
        'node-pty@1.2.0-beta.15': true,
        'protobufjs@7.6.6': true,
      };
      await writeFile(workspace, stringify(configuration));
      let archive;
      if (process.env.HE_INSTALL_PACKAGE) archive = path.resolve(process.env.HE_INSTALL_PACKAGE);
      else {
        const packed = JSON.parse(
          await command('npm', ['pack', '--ignore-scripts', '--pack-destination', root, '--json'], {
            timeoutMs: 60000,
          }),
        );
        archive = path.join(root, packed['@harness-evolution/dsh-bundle'].filename);
      }
      const originalArchive = createHash('sha256')
        .update(await readFile(archive))
        .digest('hex');
      await command(
        path.resolve('node_modules/.bin/dsh'),
        ['plugin', '--profile', 'sdk-minimal', 'add', archive],
        { env, timeoutMs: 180000 },
      );
      const profile = JSON.parse(
        await readFile(path.join(env.DSH_HOME, 'profiles/sdk-minimal/package.json'), 'utf8'),
      );
      assert.ok(profile.dsh.profile.bundles.includes('@harness-evolution/dsh-bundle'));
      assert.equal(
        createHash('sha256')
          .update(await readFile(archive))
          .digest('hex'),
        originalArchive,
      );
      console.log(`Installed exact package SHA256: ${originalArchive}`);
      const methodPack = JSON.parse(
        await command('npm', [
          'pack',
          './optimizers/evidence-driven',
          '--ignore-scripts',
          '--pack-destination',
          root,
          '--json',
        ]),
      );
      await command(
        path.resolve('node_modules/.bin/dsh'),
        [
          'plugin',
          '--profile',
          'sdk-minimal',
          'add',
          path.join(root, methodPack['@harness-evolution/optimizer-evidence-driven'].filename),
        ],
        { env, timeoutMs: 180000 },
      );
      // SDK host opts into the installed native preset; its declaration/tools come from the package.
      await writeFile(
        patch,
        stringify([
          {
            insert: [
              { id: 'fixture-provider', name: path.resolve('tests/native/fixture-provider.mjs') },
              ...sdkPreset('evolution', '@harness-evolution/dsh-bundle/sdk-preset'),
            ],
          },
        ]),
      );
      runtime = new DeepSeekHarness({
        profile: 'sdk-minimal',
        dshHome: env.DSH_HOME,
        cwd: root,
        provider: 'evolution-fixture',
        model: 'protocol-test',
        patches: [patch],
        initializeTimeoutMs: 30000,
        requestTimeoutMs: 30000,
        env: {
          ...env,
          EVOLUTION_ENDPOINT: `http://127.0.0.1:${address.port}`,
          EVOLUTION_TOKEN: 'installation-fixture',
          HE_FIXTURE_REQUESTS: path.join(root, 'requests.jsonl'),
        },
      });
      const result = await runtime.run('Call evolution_status once.');
      assert.equal(result.finalResponse, 'native-evolution-connected');
      assert.equal(calls, 1);
      const requests = (await readFile(path.join(root, 'requests.jsonl'), 'utf8'))
        .trim()
        .split('\n')
        .map(JSON.parse);
      const names = requests[0].tools.map((t) => t.name);
      assert.match(JSON.stringify(requests[0].messages), /Evolve the Harness, Not the Model/);
      for (const name of ['status', 'branch', 'submit', 'evidence', 'candidate', 'finish'])
        assert.ok(names.includes('evolution_' + name));
    } finally {
      await runtime?.close();
      await new Promise((resolve) => server.close(resolve));
      await rm(root, { recursive: true, force: true });
    }
  },
);
