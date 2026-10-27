import test from 'node:test';
import assert from 'node:assert/strict';
import { availableSubnets, EgressPool, poolCapacity } from '../src/ip-pool.js';
import { Experiment } from '../src/contracts.js';
import { specification } from './fixtures.js';

test('bounded IPv4 pool subtracts exact overlapping CIDRs without address guessing', () => {
  assert.equal(poolCapacity('10.230.0.0/23'), 64);
  assert.deepEqual(availableSubnets('10.230.0.0/27', ['10.230.0.0/29', '10.230.0.16/28']), ['10.230.0.8/29']);
  assert.deepEqual(availableSubnets('10.230.0.0/24', ['10.0.0.0/8']), []);
  assert.equal(availableSubnets('10.230.0.0/24', ['fd00::/64', '192.168.0.0/16']).length, 32);
  for (const invalid of [
    '10.230.0.1/24',
    '0.0.0.0/16',
    '8.8.0.0/16',
    '127.0.0.0/16',
    '10.0.0.0/8',
    '10.230.0.0/30',
    'fd00::/64',
  ])
    assert.equal(EgressPool.safeParse(invalid).success, false, invalid);
});
test('experiment capacity includes concurrent executors and one optimizer, each with two leases', () => {
  const spec = specification();
  spec.concurrency = 30;
  spec.isolation.network.executor = 'controlled';
  spec.egress.executor = [
    {
      id: 'fixture',
      path: '/fixture',
      method: 'GET',
      upstream: 'https://example.org/',
      addresses: { kind: 'public' },
      credential: null,
      body: { kind: 'empty' },
      maxRequestBytes: 1,
      timeoutSeconds: 1,
    },
  ];
  spec.isolation.network.egressPool = '10.230.0.0/24';
  assert.equal(Experiment.safeParse(spec).success, false);
  spec.isolation.network.egressPool = '10.230.0.0/23';
  assert.equal(Experiment.safeParse(spec).success, true);
});
