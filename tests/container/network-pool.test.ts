import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { allocateNetwork } from '../../src/network-pool.js';
import { command } from '../../src/docker.js';
import { availableSubnets } from '../../src/ip-pool.js';

test(
  'explicit pool supplies 62 distinct leases without consuming Docker default /24 pools',
  { timeout: 120_000 },
  async () => {
    const prefix = `he-pool-${randomUUID().slice(0, 8)}`,
      pool = '10.231.0.0/23';
    const root = await mkdtemp(path.join(os.tmpdir(), 'he-pool-'));
    console.log(`Network capacity evidence retained: ${root}`);
    const names = Array.from({ length: 62 }, (_, i) => `${prefix}-${i}`);
    try {
      await Promise.all(
        names.map(async (name) => {
          await allocateNetwork(
            pool,
            name,
            ['--internal', '--label', `he-test=${prefix}`],
            async (subnet) => {
              await writeFile(path.join(root, `${name}.json`), JSON.stringify({ subnet }));
            },
          );
        }),
      );
      const networks = JSON.parse(await command('docker', ['network', 'inspect', ...names]));
      const subnets = networks.map(
        (network: { IPAM: { Config: Array<{ Subnet: string }> } }) => network.IPAM.Config[0]!.Subnet,
      );
      assert.equal(new Set(subnets).size, 62);
      assert.equal(availableSubnets(pool, subnets).length, 2);
      for (let i = 0; i < names.length; i++)
        assert.equal(
          JSON.parse(await readFile(path.join(root, `${names[i]}.json`), 'utf8')).subnet,
          subnets[i],
        );
      await writeFile(
        path.join(root, 'acceptance.json'),
        JSON.stringify({ passed: true, pool, leases: subnets }, null, 2),
      );
    } finally {
      const ids = (
        await command('docker', [
          'network',
          'ls',
          '--filter',
          `label=he-test=${prefix}`,
          '--format',
          '{{.ID}}',
        ])
      )
        .split('\n')
        .filter(Boolean);
      if (ids.length) await command('docker', ['network', 'rm', ...ids]);
    }
  },
);

test(
  'independent allocators contend for the same lease and reclaim the full finite pool',
  { timeout: 60_000 },
  async () => {
    const prefix = `he-race-${randomUUID().slice(0, 8)}`;
    const root = await mkdtemp(path.join(os.tmpdir(), 'he-pool-race-'));
    const pool = '10.232.0.0/26';
    const names = Array.from({ length: 8 }, (_, i) => `${prefix}-${i}`);
    const allocator = new URL('../../src/network-pool.ts', import.meta.url).href;
    const loader = import.meta.resolve('tsx');
    const script = path.join(root, 'allocate.mjs');
    await writeFile(
      script,
      `
import {allocateNetwork} from ${JSON.stringify(allocator)};
import {writeFile,access} from 'node:fs/promises';
const [root,name,pool,prefix] = process.argv.slice(2);
let attempts=0;
await allocateNetwork(pool,name,['--internal','--label','he-test='+prefix],async subnet=>{
  await writeFile(root+'/'+name+'.json',JSON.stringify({subnet,attempts:++attempts}));
  if(attempts===1) {
    await writeFile(root+'/'+name+'.ready','');
    const deadline=Date.now()+20000;
    while(true){
      try {await access(root+'/go');break;} catch(error){if(error.code!=='ENOENT')throw error;}
      if(Date.now()>deadline)throw Error('Allocation barrier expired');
      await new Promise(resolve=>setTimeout(resolve,20));
    }
  }
});
`,
    );
    let childFailure: unknown;
    const jobs = names.map((name) =>
      command(process.execPath, ['--import', loader, script, root, name, pool, prefix]).catch((error) => {
        childFailure ??= error;
        throw error;
      }),
    );
    const settled = Promise.allSettled(jobs);
    try {
      const deadline = Date.now() + 20000;
      while (true) {
        if (childFailure) throw childFailure;
        const ready = await Promise.all(
          names.map(async (name) => {
            try {
              await readFile(path.join(root, `${name}.ready`));
              return true;
            } catch (error) {
              if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
              return false;
            }
          }),
        );
        if (ready.every(Boolean)) break;
        if (Date.now() > deadline) throw Error('Independent processes did not reach allocation barrier');
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      const initial = await Promise.all(
        names.map(async (name) => JSON.parse(await readFile(path.join(root, `${name}.json`), 'utf8'))),
      );
      assert.equal(new Set(initial.map((record) => record.subnet)).size, 1);
      await writeFile(path.join(root, 'go'), '');
      const outcomes = await settled;
      assert.deepEqual(
        outcomes.filter((result) => result.status === 'rejected'),
        [],
      );
      const networks = JSON.parse(await command('docker', ['network', 'inspect', ...names]));
      const subnets = networks.map(
        (network: { IPAM: { Config: Array<{ Subnet: string }> } }) => network.IPAM.Config[0]!.Subnet,
      );
      assert.equal(new Set(subnets).size, 8);
      assert.equal(availableSubnets(pool, subnets).length, 0);
      await assert.rejects(
        allocateNetwork(pool, `${prefix}-overflow`, [], async () => {}),
        /pool exhausted/,
      );
      await writeFile(
        path.join(root, 'acceptance.json'),
        JSON.stringify({ passed: true, pool, subnets, initial }, null, 2),
      );
      console.log(`Cross-process contention evidence retained: ${root}`);
    } finally {
      await writeFile(path.join(root, 'go'), '');
      const outcomes = await settled;
      await writeFile(
        path.join(root, 'children.json'),
        JSON.stringify(
          outcomes.map((result) =>
            result.status === 'fulfilled'
              ? { status: result.status, output: result.value }
              : { status: result.status, error: String(result.reason) },
          ),
          null,
          2,
        ),
      );
      const ids = (
        await command('docker', [
          'network',
          'ls',
          '--filter',
          `label=he-test=${prefix}`,
          '--format',
          '{{.ID}}',
        ])
      )
        .split('\n')
        .filter(Boolean);
      if (ids.length) await command('docker', ['network', 'rm', ...ids]);
      assert.equal(
        (
          await command('docker', [
            'network',
            'ls',
            '--filter',
            `label=he-test=${prefix}`,
            '--format',
            '{{.ID}}',
          ])
        ).trim(),
        '',
      );
    }
  },
);
