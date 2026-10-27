import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { stringify } from 'yaml';
import { checkComposition } from '../../dist/composition.js';
import { specification } from '../fixtures.js';

test(
  'native behavioral evidence preserves service replacement, isolated scopes and asynchronous disposal',
  { timeout: 120_000 },
  async (t) => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'he-service-scope-'));
    t.diagnostic(`Native service lifecycle evidence: ${root}`);
    const files: Record<string, string> = {
      'provider-v1.mjs': `export function apply(ctx, config) {
  ctx.provide('scopeArithmetic', { version: 'v1', apply: value => value * config.factor });
  ctx.effect(() => () => { config.events.push('provider-v1-disposed:' + config.label); });
}`,
      'consumer-v1.mjs': `export const inject = ['scopeArithmetic'];
export function apply(ctx, config) {
  const service = ctx.get('scopeArithmetic');
  if (service.version !== 'v1') throw new Error('Expected v1 service interface');
  ctx.provide('scopeOutput', { version: service.version, value: service.apply(2) });
  ctx.effect(() => () => { config.events.push('consumer-v1-disposed:' + config.label); });
}`,
      'provider-v2.mjs': `export function apply(ctx, config) {
  ctx.provide('scopeArithmetic', {
    version: 'v2',
    evaluate: ({operand}) => ({value: operand * config.factor + config.bias}),
  });
  ctx.effect(() => async () => {
    config.events.push('provider-v2-cleanup-started');
    config.started.resolve();
    await config.release.promise;
    config.events.push('provider-v2-cleanup-finished');
  });
}`,
      'consumer-v2.mjs': `export const inject = ['scopeArithmetic'];
export function apply(ctx) {
  const service = ctx.get('scopeArithmetic');
  if (service.version !== 'v2') throw new Error('Expected v2 service interface');
  ctx.provide('scopeOutput', { version: service.version, ...service.evaluate({operand: 2}) });
}`,
      'topology.mjs': `import * as provider from './provider-v1.mjs';
import * as consumer from './consumer-v1.mjs';
export async function apply(ctx) {
  const events = [];
  const rootProvider = await ctx.plugin(provider, { factor: 2, label: 'root', events });
  const rootConsumer = await ctx.plugin(consumer, { label: 'root', events });
  const branches = {};
  for (const [label, factor] of [['left', 3], ['right', 5]]) {
    const branch = {};
    branch.owner = await ctx.plugin(async function branchOwner(owner) {
      branch.ctx = owner.isolate('scopeArithmetic').isolate('scopeOutput');
      branch.consumer = branch.ctx.plugin(consumer, { label, events });
      branch.pendingBeforeProvider = branch.consumer.state;
      branch.provider = await branch.ctx.plugin(provider, { factor, label, events });
      await branch.consumer;
    });
    branches[label] = branch;
  }
  ctx.provide('serviceScopeFixture', { ctx, branches, events, rootProvider, rootConsumer });
}`,
      'suite.mjs': `import assert from 'node:assert/strict';
import * as providerV2 from './provider-v2.mjs';
import * as consumerV2 from './consumer-v2.mjs';
export async function probe({ctx, observe}) {
  const fixture = ctx.get('serviceScopeFixture');
  const {left, right} = fixture.branches;
  const read = scope => scope.get('scopeOutput') ?? null;
  const snapshot = () => ({root: read(fixture.ctx), left: read(left.ctx), right: read(right.ctx)});

  // Cordis 4.0.5 PENDING=0: the consumer has no provider in its own scope yet.
  assert.equal(left.pendingBeforeProvider, 0);
  assert.equal(right.pendingBeforeProvider, 0);
  await observe('three-independent-service-scopes', snapshot());
  assert.deepEqual(snapshot(), {
    root: {version: 'v1', value: 4},
    left: {version: 'v1', value: 6},
    right: {version: 'v1', value: 10},
  });

  await left.provider.dispose();
  await left.consumer.await();
  await observe('provider-unloaded-consumer-pending', {
    ...snapshot(), consumerState: left.consumer.state, events: fixture.events,
  });
  assert.equal(left.consumer.state, 0);
  assert.equal(left.ctx.get('scopeArithmetic'), undefined);
  assert.equal(read(left.ctx), null);
  assert.deepEqual(read(fixture.ctx), {version: 'v1', value: 4});
  assert.deepEqual(read(right.ctx), {version: 'v1', value: 10});
  assert.ok(fixture.events.includes('consumer-v1-disposed:left'));

  // The v2 interface changes both provider and consumer; no compatibility adapter is used.
  await left.consumer.dispose();
  const started = Promise.withResolvers();
  const release = Promise.withResolvers();
  left.provider = await left.ctx.plugin(providerV2, {
    factor: 7, bias: 11, events: fixture.events, started, release,
  });
  left.consumer = await left.ctx.plugin(consumerV2);
  await observe('new-interface-and-config', snapshot());
  assert.deepEqual(snapshot(), {
    root: {version: 'v1', value: 4},
    left: {version: 'v2', value: 25},
    right: {version: 'v1', value: 10},
  });

  let disposed = false;
  const disposing = left.owner.dispose().then(() => { disposed = true; });
  try {
    await started.promise;
    await observe('asynchronous-cleanup-in-progress', {disposed, events: fixture.events});
    assert.equal(disposed, false);
    assert.ok(!fixture.events.includes('provider-v2-cleanup-finished'));
    assert.deepEqual(read(right.ctx), {version: 'v1', value: 10});
  } finally {
    release.resolve();
    await disposing;
  }
  await observe('branch-and-children-fully-disposed', {
    ...snapshot(), disposed, providerUid: left.provider.uid, consumerUid: left.consumer.uid,
    events: fixture.events,
  });
  assert.equal(disposed, true);
  assert.equal(left.provider.uid, null);
  assert.equal(left.consumer.uid, null);
  assert.equal(left.ctx.get('scopeArithmetic'), undefined);
  assert.equal(read(left.ctx), null);
  assert.ok(fixture.events.includes('provider-v2-cleanup-finished'));
  assert.deepEqual(read(fixture.ctx), {version: 'v1', value: 4});
  assert.deepEqual(read(right.ctx), {version: 'v1', value: 10});
}`,
    };
    for (const [name, content] of Object.entries(files)) {
      await writeFile(path.join(root, name), content);
    }
    const patch = path.join(root, 'candidate.yml');
    await writeFile(
      patch,
      stringify([
        {
          insert: [
            { id: 'fixture', name: path.resolve('tests/native/fixture-provider.mjs') },
            { id: 'service-topology', name: path.join(root, 'topology.mjs') },
          ],
        },
      ]),
    );
    const directory = path.join(root, 'native');
    await checkComposition({
      profile: 'sdk-minimal',
      model: {
        ...specification().executor,
        provider: 'evolution-fixture',
        model: 'protocol-test',
        reasoningEffort: null,
      },
      patches: [patch],
      directory,
      processCwd: process.cwd(),
      workspace: root,
      timeoutSeconds: 30,
      behaviorModule: path.join(root, 'suite.mjs'),
    });
    const composition = JSON.parse(await readFile(path.join(directory, 'composition.json'), 'utf8'));
    assert.equal(composition.passed, true);
    const behavior = JSON.parse(await readFile(path.join(directory, 'behavior.json'), 'utf8'));
    assert.equal(behavior.status, 'passed');
    assert.deepEqual(
      behavior.observations.map((observation: { sequence: number; kind: string; label: string }) => ({
        sequence: observation.sequence,
        kind: observation.kind,
        label: observation.label,
      })),
      [
        'three-independent-service-scopes',
        'provider-unloaded-consumer-pending',
        'new-interface-and-config',
        'asynchronous-cleanup-in-progress',
        'branch-and-children-fully-disposed',
      ].map((label, index) => ({ sequence: index + 1, kind: 'value', label })),
    );
    // Saved observations must be snapshots, not aliases of the subsequently mutated event array.
    assert.deepEqual(behavior.observations[1].value.events.sort(), [
      'consumer-v1-disposed:left',
      'provider-v1-disposed:left',
    ]);
    assert.ok(!behavior.observations[3].value.events.includes('provider-v2-cleanup-finished'));
    assert.equal(behavior.observations[4].value.disposed, true);
  },
);
