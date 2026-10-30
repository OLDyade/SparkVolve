import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import { stringify } from 'yaml';
import { DeepSeekHarness } from '@deepseek-ai/dsh-sdk-client';
import { authoringSources } from '../../src/native-authoring.js';
import { evolutionPreset, sdkPreset } from '../../src/preset.js';

const digest = (text: string | Uint8Array) => createHash('sha256').update(text).digest('hex');

for (const profile of ['sdk', 'sdk-minimal'] as const) {
  test(
    `native authoring uses real ${profile} inspect, skill, source reads and scoped disposal`,
    { timeout: 60_000 },
    async () => {
      const root = await mkdtemp(path.join(os.tmpdir(), 'he-native-authoring-'));
      const patch = path.join(root, 'patch.yml');
      const records = path.join(root, 'records.jsonl');
      const nativeSources = await authoringSources();
      const secret = 'unpublished-native-authoring-test-secret';
      await writeFile(
        patch,
        stringify([
          {
            insert: [
              {
                id: 'authoring-fixture',
                name: path.resolve('tests/native/native-authoring-provider.mjs'),
                config: { secret },
              },
              ...sdkPreset('evolution', path.resolve('dist/sdk-preset.js'), profile),
              evolutionPreset({
                plugin: path.resolve('dist/plugin.js'),
                endpoint: 'http://127.0.0.1:1',
                tokenEnv: 'SPARKVOLVE_AUTHORING_TOKEN',
              }),
              {
                id: 'preset-ordinary',
                name: '@deepseek-ai/dsh-agent-preset',
                config: { id: 'ordinary', plugins: [] },
              },
            ],
          },
        ]),
      );
      const runtime = new DeepSeekHarness({
        profile,
        patches: [patch],
        dshHome: path.join(root, 'home'),
        cwd: root,
        provider: 'native-authoring-fixture',
        model: 'protocol-fixture',
        env: {
          ...process.env,
          HOME: root,
          SPARKVOLVE_AUTHORING_RECORDS: records,
          SPARKVOLVE_AUTHORING_TOKEN: 'test-only',
        },
      });
      let passed = false;
      try {
        const run = await runtime.run('Read native authoring contracts and their source.');
        assert.equal(
          run.finalResponse,
          'native-authoring-connected',
          JSON.stringify(run.events.filter((event) => event.type === 'turn/end')),
        );
        assert.equal(
          (await runtime.run('ordinary-session', { sessionId: 'ordinary-session' })).finalResponse,
          'ordinary-connected',
        );
        const raw = await readFile(records, 'utf8');
        assert.ok(!raw.includes(secret), 'Config inspection must not expose configured values');
        const observations = raw
          .trim()
          .split('\n')
          .map((line) => JSON.parse(line));
        const requests = observations.filter((row) => row.kind === 'request').map((row) => row.value);
        assert.ok(requests.length >= 5);
        const receipt = (id: string) => {
          const message = requests
            .at(-2)
            .messages.find(
              (item: { role: string; toolCallId?: string }) => item.role === 'tool' && item.toolCallId === id,
            );
          assert.ok(message, `No actual native receipt for ${id}`);
          assert.equal(message.isError, false);
          return message.content
            .filter((block: { type: string }) => block.type === 'text')
            .map((block: { text: string }) => block.text)
            .join('\n');
        };
        const service = JSON.parse(receipt('service')).data;
        assert.equal(service.service.key, 'tools');
        assert.ok(
          service.service.methods.some((method: { signature: string }) =>
            method.signature.includes('register'),
          ),
        );
        assert.ok(service.referencedTypes.length > 0);
        assert.equal(JSON.parse(receipt('event')).data.event.name, 'agent/created');
        const visibleTools = JSON.parse(receipt('tools')).data.tools.map(
          (tool: { name: string }) => tool.name,
        );
        assert.ok(visibleTools.includes('bash'));
        assert.ok(visibleTools.includes('cordis_inspect_query'));
        assert.ok(!visibleTools.includes('plugin_manager'));
        const config = JSON.parse(receipt('config')).data;
        assert.equal(config.status, 'schema');
        assert.ok(JSON.stringify(config.schema).includes('secret'));
        for (const [id, name] of [
          ['skill-plugin', 'cordis-plugin-development'],
          ['skill-composition', 'editing-cordis-compositions'],
        ]) {
          const relative = `${name}/SKILL.md`;
          const source = await readFile(path.join(nativeSources.skills.directory, relative), 'utf8');
          assert.equal(
            nativeSources.skills.files.find((file) => file.file === relative)?.sha256,
            digest(source),
          );
          const body = source.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '').trim();
          assert.ok(receipt(id!).includes(body), 'Native skill must return its complete original body');
          assert.ok(receipt(id!).includes(path.join(nativeSources.skills.directory, name!)));
        }
        const toolsPackage = nativeSources.packages.find((entry) => entry.name === '@deepseek-ai/dsh-tools')!;
        const declaration = await readFile(
          path.join(toolsPackage.sources.directory, 'types/index.d.ts'),
          'utf8',
        );
        // Encode exact source bytes before the shell's human-readable result framing.
        const sourceReceipt = receipt('source').split('\n[Command finished')[0]!.trim();
        assert.equal(JSON.parse(sourceReceipt), declaration.split('\n').slice(0, 60).join('\n') + '\n');
        const firstPrompt = JSON.stringify(requests[0].messages);
        for (const source of nativeSources.packages) {
          assert.ok(firstPrompt.includes(source.version));
          assert.ok(firstPrompt.includes(source.sources.sha256));
        }
        assert.ok(firstPrompt.includes(nativeSources.skills.sha256));
        const scopes = observations.filter((row) => row.kind === 'scope').map((row) => row.value);
        for (const scope of scopes) {
          const evolved = scope.id !== 'ordinary-session';
          assert.equal(scope.tools.includes('cordis_inspect_query'), evolved);
          assert.equal(
            scope.skills.some(
              (skill: { provider: string }) => skill.provider === 'evolution-native-authoring',
            ),
            evolved,
          );
          assert.ok(!scope.globalTools.includes('cordis_inspect_query'));
          assert.ok(
            !scope.globalSkills.some(
              (skill: { provider: string }) => skill.provider === 'evolution-native-authoring',
            ),
          );
        }
        const ordinaryPrompt = JSON.stringify(requests.at(-1).messages);
        assert.ok(!ordinaryPrompt.includes('Native authoring sources:'));
        assert.ok(!ordinaryPrompt.includes('cordis-plugin-development'));
        assert.equal(observations.filter((row) => row.kind === 'disposal' && row.value.disposed).length, 1);
        passed = true;
      } finally {
        await runtime.close();
        if (passed) await rm(root, { recursive: true, force: true });
        else console.log(`Failed native authoring evidence retained: ${root}`);
      }
    },
  );
}
