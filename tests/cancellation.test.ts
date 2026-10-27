import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { Docker, type ContainerReference, type ContainerSpec } from '../src/docker.js';
import { prepareExecution } from '../src/execution.js';
import { cancelExperiment, cancelExecutionTree } from '../src/cancellation.js';
import { atomicJSON } from '../src/artifacts.js';
import { containerIdentity } from '../src/isolation.js';
import { specification, hash } from './fixtures.js';
import { Store } from '../src/store.js';

const state = {
  Status: 'running',
  Running: true,
  ExitCode: 0,
  StartedAt: '2026-10-28T00:00:00Z',
  FinishedAt: '',
};
class Driver extends Docker {
  containers = new Map<string, { spec: ContainerSpec; reference: ContainerReference; running: boolean }>();
  creates = 0;
  removals = 0;
  stops = 0;
  interruptRemoval = false;
  override async create(spec: ContainerSpec) {
    const id = String(++this.creates);
    this.containers.set(spec.name, {
      spec,
      reference: { name: spec.name, id, intent: containerIdentity(spec) },
      running: true,
    });
  }
  override async inspect(name: string) {
    const item = this.containers.get(name);
    return item
      ? { ...state, Running: item.running, Status: item.running ? 'running' : 'exited' }
      : undefined;
  }
  override async executionReference(spec: ContainerSpec) {
    const item = this.containers.get(spec.name);
    assert.ok(item);
    assert.equal(item.reference.intent, containerIdentity(spec));
    return item.reference;
  }
  override async collect() {
    return { ...state, Running: false, Status: 'exited' };
  }
  override async failureEvidence(spec: ContainerSpec, directory: string) {
    const item = this.containers.get(spec.name);
    assert.ok(item);
    assert.equal(item.reference.intent, containerIdentity(spec));
    item.running = false;
    this.stops++;
    await mkdir(directory, { recursive: true });
    await atomicJSON(path.join(directory, 'failure-observation.json'), item.reference);
    return item.reference;
  }
  override async remove(reference: ContainerReference) {
    const item = this.containers.get(reference.name);
    if (!item) return;
    assert.deepEqual(item.reference, reference);
    assert.equal(item.running, false);
    this.containers.delete(reference.name);
    this.removals++;
    if (this.interruptRemoval) {
      this.interruptRemoval = false;
      throw Error('interrupted after original removal');
    }
  }
}
function spec(name: string): ContainerSpec {
  return {
    name,
    image: specification().runtime.image,
    command: ['node', '-e', 'setInterval(()=>{},1000)'],
    mounts: [],
    network: 'none',
    env: {},
    timeoutSeconds: 60,
    isolation: specification().isolation,
  };
}
async function register(
  root: string,
  directory: string,
  driver: Driver,
  input = spec(directory.replaceAll('/', '-')),
) {
  const home = path.join(root, directory);
  await mkdir(home, { recursive: true });
  await prepareExecution(home, { directory }, driver, null, async () => input, {});
  return input;
}

test('explicit cancellation persists original IDs, resumes removal and never restarts any role', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'he-cancellation-'));
  try {
    const driver = new Driver();
    const roles = ['build', 'qa', 'optimizer', 'executor', 'scorer', 'probe'] as const;
    const registrations = roles.map((role) => ({ directory: `roles/${role}`, role }));
    for (const entry of registrations) await register(root, entry.directory, driver);
    const original = await readFile(path.join(root, 'roles/build/execution-record.json'), 'utf8');
    driver.interruptRemoval = true;
    await assert.rejects(
      cancelExecutionTree(root, registrations, driver),
      /interrupted after original removal/,
    );
    assert.equal(driver.removals, 1);
    const receipt = await cancelExecutionTree(root, registrations, driver);
    assert.equal(receipt.outcome, 'cancelled');
    assert.equal(receipt.executions.length, 6);
    assert.equal(driver.creates, 6);
    assert.equal(driver.removals, 6);
    assert.equal(driver.containers.size, 0);
    assert.equal(await readFile(path.join(root, 'roles/build/execution-record.json'), 'utf8'), original);
    assert.deepEqual(await cancelExecutionTree(root, registrations, driver), receipt);
    await assert.rejects(register(root, 'roles/build', driver), /explicitly cancelled/);
    await assert.rejects(cancelExecutionTree(root, registrations.slice(1), driver), /registration changed/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('identity damage and missing authorization fail before any execution is stopped', async (t) => {
  for (const damage of ['replacement', 'missing-record', 'missing-container', 'changed-spec'] as const) {
    await t.test(damage, async () => {
      const root = await mkdtemp(path.join(os.tmpdir(), 'he-cancel-identity-'));
      try {
        const driver = new Driver();
        const first = await register(root, 'first', driver),
          second = await register(root, 'second', driver);
        if (damage === 'replacement') driver.containers.get(second.name)!.reference.id = 'replacement';
        if (damage === 'missing-record') await rm(path.join(root, 'second/execution-record.json'));
        if (damage === 'missing-container') driver.containers.delete(second.name);
        if (damage === 'changed-spec')
          await atomicJSON(path.join(root, 'second/execution-spec.json'), {
            ...second,
            command: ['different'],
          });
        await assert.rejects(
          cancelExecutionTree(
            root,
            [
              { directory: 'first', role: 'executor' },
              { directory: 'second', role: 'qa' },
            ],
            driver,
          ),
        );
        assert.equal(driver.stops, 0);
        assert.equal(driver.containers.get(first.name)!.running, true);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });
  }
});

test('Docker.run keeps original attempt identity and does not persist environment secrets', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'he-run-intent-'));
  try {
    const driver = new Driver(),
      input = { ...spec('secret-run'), env: { TEST_PRIVATE_KEY: 'secret-for-test' } };
    await driver.run(input, root);
    assert.equal(
      (await readFile(path.join(root, 'execution-spec.json'), 'utf8')).includes('secret-for-test'),
      false,
    );
    await driver.run(input, root);
    assert.equal(driver.creates, 1);
    driver.containers.delete(input.name);
    await assert.rejects(driver.run(input, root), /Original execution container missing/);
    assert.equal(driver.creates, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('experiment cancellation ignores forged execution files inside candidate-writable directories', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'he-cancel-registered-'));
  try {
    const contract = specification();
    await atomicJSON(path.join(root, 'experiment.json'), contract);
    const store = new Store(path.join(root, 'experiment.sqlite'), contract);
    store.reserveSubmission({
      digest: hash,
      phase: 'frozen',
      proposal: {
        draft: 'baseline',
        parents: [],
        actions: ['compose'],
        evidence: ['fixture'],
        hypothesis: 'fixture',
        expectedChange: 'fixture',
      },
    });
    store.commitSubmission(hash);
    store.close();
    const driver = new Driver();
    await register(root, `builds/${hash}`, driver);
    const untrusted = await register(root, `builds/${hash}/work/forged`, driver);
    const receipt = await cancelExperiment(root, driver);
    assert.equal(receipt.executions.filter((item) => item.reference !== null).length, 1);
    assert.equal(driver.containers.get(untrusted.name)!.running, true);
    assert.equal(driver.stops, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('cancellation refuses registrations escaping through symbolic links', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'he-cancel-symlink-'));
  try {
    await mkdir(path.join(root, 'outside'));
    await symlink(path.join(root, 'outside'), path.join(root, 'alias'));
    await assert.rejects(
      cancelExecutionTree(root, [{ directory: 'alias/run', role: 'executor' }], new Driver()),
      /symbolic link/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('legacy or orphaned run evidence is never silently assigned a new execution attempt', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'he-orphan-execution-'));
  try {
    await writeFile(path.join(root, 'isolation.json'), JSON.stringify({ original: true }));
    const driver = new Driver();
    await assert.rejects(driver.run(spec('orphan'), root), /without its original intent/);
    assert.equal(driver.creates, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('missing controlled-egress authority cannot be reported as complete cleanup', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'he-cancel-egress-authority-'));
  try {
    const driver = new Driver();
    const input = {
      ...spec('controlled'),
      network: {
        interfaces: [{ name: 'controlled-network', ipv4: null, gatewayPriority: 0 }],
        dns: [],
        hosts: [],
      },
    };
    await register(root, 'execution', driver, input);
    await assert.rejects(
      cancelExecutionTree(root, [{ directory: 'execution', role: 'executor' }], driver),
      /no persisted egress contract/,
    );
    assert.equal(driver.stops, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('recovery verifies evidence for already removed entries before declaring cancellation complete', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'he-cancel-removed-evidence-'));
  try {
    class SecondRemovalInterruption extends Driver {
      override async remove(reference: ContainerReference) {
        await super.remove(reference);
        if (this.removals === 2) throw Error('interrupt second removal');
      }
    }
    const driver = new SecondRemovalInterruption();
    for (const name of ['a', 'b']) await register(root, name, driver);
    const registrations = [
      { directory: 'a', role: 'build' as const },
      { directory: 'b', role: 'executor' as const },
    ];
    await assert.rejects(cancelExecutionTree(root, registrations, driver), /interrupt second/);
    await writeFile(path.join(root, 'a/cancellation-evidence/failure-observation.json'), 'changed');
    await assert.rejects(
      cancelExecutionTree(root, registrations, driver),
      /Removed execution cancellation evidence changed/,
    );
    assert.equal(
      JSON.parse(await readFile(path.join(root, 'cancellation.json'), 'utf8')).outcome,
      'cancelling',
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('orphan evidence never counts as an unstarted execution during cancellation', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'he-cancel-orphan-'));
  try {
    await mkdir(path.join(root, 'execution'));
    await writeFile(path.join(root, 'execution/stdout.log'), 'original execution');
    await assert.rejects(
      cancelExecutionTree(root, [{ directory: 'execution', role: 'executor' }], new Driver()),
      /without its original cancellation authority/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
