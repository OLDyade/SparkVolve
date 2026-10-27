import test from 'node:test';
import assert from 'node:assert/strict';
import { Experiment } from '../src/contracts.js';
import { controlPaths, controlRoutes } from '../src/control-routes.js';
import { specification } from './fixtures.js';

const route = {
  id: 'provider',
  path: '/v1/chat/completions',
  method: 'POST' as const,
  upstream: 'https://example.org/v1/chat/completions',
  addresses: { kind: 'public' as const },
  credential: { env: 'MODEL_KEY', header: 'authorization', prefix: 'Bearer ' },
  body: { kind: 'json' as const, equals: { model: 'frozen' }, maximum: { max_tokens: 1024 } },
  maxRequestBytes: 1024,
  timeoutSeconds: 30,
};

test('network contracts reject unrestricted agent access, offline routes and unbound credentials', () => {
  const spec = specification();
  assert.ok(Experiment.safeParse(spec).success);
  assert.ok(!Experiment.safeParse({ ...spec, egress: undefined }).success);
  assert.ok(
    !Experiment.safeParse({
      ...spec,
      isolation: { ...spec.isolation, network: { ...spec.isolation.network, executor: 'bridge' } },
    }).success,
  );
  assert.ok(!Experiment.safeParse({ ...spec, egress: { ...spec.egress, executor: [route] } }).success);
  spec.isolation.network.executor = 'controlled';
  assert.ok(!Experiment.safeParse(spec).success);
  spec.egress.executor = [route];
  spec.executor = { ...spec.executor, credentialEnv: ['MODEL_KEY'] };
  assert.ok(Experiment.safeParse(spec).success);
  assert.ok(
    !Experiment.safeParse({ ...spec, executor: { ...spec.executor, credentialEnv: ['UNBOUND'] } }).success,
  );
  assert.ok(!Experiment.safeParse({ ...spec, egress: { ...spec.egress, executor: [route, route] } }).success);
});

test('controller capability has exact pinned routes and cannot be shadowed by model routes', () => {
  const routes = controlRoutes('http://192.0.2.10:8787', 60);
  assert.deepEqual(
    routes.map((r) => r.path),
    [...controlPaths],
  );
  assert.ok(routes.every((r) => r.method === 'POST' && r.credential?.env === 'EVOLUTION_TOKEN'));
  for (const value of [
    'http://controller:8787',
    'http://192.0.2.10/base',
    'http://a:b@192.0.2.10',
    'http://192.0.2.10/?redirect=1',
  ])
    assert.throws(() => controlRoutes(value, 60), /explicit literal IP origin/);
  const spec = specification();
  for (const external of [
    { ...route, path: '/status' },
    { ...route, credential: { ...route.credential, env: 'EVOLUTION_TOKEN' } },
  ])
    assert.ok(!Experiment.safeParse({ ...spec, egress: { ...spec.egress, optimizer: [external] } }).success);
});
