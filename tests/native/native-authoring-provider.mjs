// Deterministic protocol fixture: real SDK tools and lifecycle, no model quality claim.
import assert from 'node:assert/strict';
import { appendFileSync } from 'node:fs';
import { LlmAdapter, ToolCallId } from '@deepseek-ai/dsh-llm';
import Schema from '@deepseek-ai/schemastery';
import { createScope, scopeOf } from '@deepseek-ai/dsh-scope';
import * as NativeAuthoring from '../../dist/native-authoring.js';

export const Config = Schema.object({ secret: Schema.string().required() });
export const inject = ['llm', 'agentPresets', 'skills', 'tools', 'systemPrompt', 'cordisInspect'];
const text = (message) =>
  message.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n');
const result = (messages, id) => {
  const message = messages.find((message) => message.role === 'tool' && message.toolCallId === id);
  assert.ok(message, `Missing actual native result: ${id}`);
  assert.equal(message.isError, false, text(message));
  return text(message);
};
const query = (provider, method, input) => ({
  name: 'cordis_inspect_query',
  args: { platform: 'host', provider, method, input },
});

export function apply(ctx) {
  const record = (kind, value) =>
    appendFileSync(process.env.SPARKVOLVE_AUTHORING_RECORDS, JSON.stringify({ kind, value }) + '\n');
  ctx.on('agent/created', async ({ agent }) => {
    if (agent.id === 'ordinary-session') await ctx.agentPresets.select(agent, 'ordinary');
    let observed = false;
    agent.ctx.on('agent/pre-step', async (_payload, next) => {
      if (observed) return next();
      observed = true;
      const scope = scopeOf(agent.ctx);
      const skills = await ctx.skills.list({ scope, cwd: process.cwd() });
      record('scope', {
        id: agent.id,
        skills: skills.map(({ name, provider, path }) => ({ name, provider, path })),
        globalSkills: await ctx.skills.list({ cwd: process.cwd() }),
        tools: ctx.tools.schemas(scope).map(({ name }) => name),
        globalTools: ctx.tools.schemas().map(({ name }) => name),
      });
      if (agent.id !== 'ordinary-session') {
        const key = {};
        const temporary = createScope(ctx, key);
        const mount = temporary.ctx.plugin(NativeAuthoring);
        await mount;
        const before = await ctx.skills.list({ scope: key, cwd: process.cwd() });
        assert.ok(before.some((skill) => skill.provider === NativeAuthoring.name));
        assert.ok(ctx.tools.schemas(key).some((tool) => tool.name === 'cordis_inspect_query'));
        await temporary.dispose();
        const after = await ctx.skills.list({ scope: key, cwd: process.cwd() });
        assert.ok(!after.some((skill) => skill.provider === NativeAuthoring.name));
        assert.ok(!ctx.tools.schemas(key).some((tool) => tool.name === 'cordis_inspect_query'));
        record('disposal', { before: before.length, after: after.length, disposed: mount.uid === null });
      }
      return next();
    });
  });
  class Fixture extends LlmAdapter {
    calls = 0;
    configReceipt = 'config-list';
    async resolveModel(provider, id) {
      return { provider, id, name: 'Native authoring protocol fixture', context: { contextWindow: 262144 } };
    }
    async *stream(options) {
      record('request', { tools: options.tools, messages: options.messages });
      const ordinary = JSON.stringify(options.messages).includes('ordinary-session');
      let calls = [];
      if (!ordinary) {
        const step = this.calls++;
        if (step === 0) calls = [{ id: 'inspect-list', name: 'cordis_inspect_list', args: {} }];
        if (step === 1) {
          const manifests = JSON.parse(result(options.messages, 'inspect-list')).providers;
          assert.ok(manifests.some((provider) => provider.id === 'Service'));
          calls = [
            { id: 'service', ...query('Service', 'listService', { service: 'tools' }) },
            { id: 'event', ...query('Event', 'listEvents', { event: 'agent/created' }) },
            { id: 'config-list', ...query('Config', 'listConfigs', { limit: 100 }) },
            { id: 'tools', ...query('Tool', 'listTools', {}) },
            { id: 'skill-plugin', name: 'skill', args: { name: 'cordis-plugin-development' } },
            { id: 'skill-composition', name: 'skill', args: { name: 'editing-cordis-compositions' } },
          ];
        }
        if (step === 2) {
          for (const id of ['service', 'event', 'tools', 'skill-plugin', 'skill-composition'])
            result(options.messages, id);
          const page = JSON.parse(result(options.messages, this.configReceipt)).data;
          const entries = page.entries.filter((entry) => entry.patchId === 'authoring-fixture');
          if (entries.length === 0 && page.nextOffset !== null) {
            this.calls--;
            this.configReceipt = `config-list-${page.nextOffset}`;
            calls = [
              {
                id: this.configReceipt,
                ...query('Config', 'listConfigs', { offset: page.nextOffset, limit: 100 }),
              },
            ];
          } else {
            assert.equal(entries.length, 1);
            const source = await NativeAuthoring.authoringSources();
            const tools = source.packages.find((entry) => entry.name === '@deepseek-ai/dsh-tools');
            const file = tools.sources.directory + '/types/index.d.ts';
            calls = [
              { id: 'config', ...query('Config', 'listConfigs', { entry: entries[0].id }) },
              {
                id: 'source',
                name: 'bash',
                args: {
                  description: 'Read installed native tool type declarations',
                  timeoutMs: 10000,
                  command: `sed -n '1,60p' '${file.replaceAll("'", "'\\''")}'`,
                },
              },
            ];
          }
        }
        if (step === 3) {
          result(options.messages, 'config');
          result(options.messages, 'source');
        }
      }
      if (calls.length) {
        for (const [index, call] of calls.entries()) {
          yield { type: 'block-start', index, blockType: 'tool-call' };
          yield {
            type: 'block-end',
            index,
            block: {
              type: 'tool-call',
              id: ToolCallId(call.id),
              name: call.name,
              arguments: JSON.stringify(call.args),
            },
          };
        }
        yield { type: 'finish', reason: 'tool-calls' };
      } else {
        yield { type: 'block-start', index: 0, blockType: 'text' };
        yield {
          type: 'block-end',
          index: 0,
          block: { type: 'text', text: ordinary ? 'ordinary-connected' : 'native-authoring-connected' },
        };
        yield { type: 'finish', reason: 'stop' };
      }
    }
  }
  ctx.llm.registerAdapter(['native-authoring-fixture'], new Fixture());
}
