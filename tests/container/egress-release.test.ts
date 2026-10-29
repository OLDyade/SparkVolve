import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { EgressSession } from '../../src/egress-session.js';
import {
  collectExecution,
  prepareExecution,
  ReclamationError,
  settleExecutionFailure,
} from '../../src/execution.js';
import { Docker, command, type ContainerSpec, type ContainerReference } from '../../src/docker.js';
import { containerSpecification } from '../fixtures.js';

test(
  'terminal archive precedes reclamation; interrupted removal resumes without any execution',
  { timeout: 60_000 },
  async () => {
    const image = process.env.SPARKVOLVE_TEST_IMAGE;
    assert.ok(image, 'SPARKVOLVE_TEST_IMAGE required');
    const root = await mkdtemp(path.join(os.tmpdir(), 'he-egress-release-'));
    console.log(`Egress reclamation evidence retained: ${root}`);
    const isolation = containerSpecification().isolation;
    const workerName = `he-release-${randomUUID()}`;
    class InterruptedRemoval extends Docker {
      interrupted = false;
      override async remove(reference: ContainerReference) {
        await super.remove(reference);
        if (!this.interrupted) {
          this.interrupted = true;
          throw Error('injected interruption after removing original worker');
        }
      }
    }
    const docker = new InterruptedRemoval();
    const sessionSpec = {
      root: path.join(root, 'egress'),
      execution: workerName,
      image,
      isolation,
      timeoutSeconds: 15,
      routes: [
        {
          id: 'fixture',
          method: 'GET' as const,
          path: '/fixture',
          upstream: 'https://example.org/',
          addresses: { kind: 'public' as const },
          credential: null,
          body: { kind: 'empty' as const },
          maxRequestBytes: 1,
          timeoutSeconds: 1,
        },
      ],
    };
    const gateway = new EgressSession(sessionSpec, docker);
    const makeSpec = async (): Promise<ContainerSpec> => ({
      name: workerName,
      image,
      isolation,
      timeoutSeconds: 15,
      network: await gateway.candidateNetwork(),
      env: {},
      mounts: [],
      command: ['node', '-e', 'console.log("one original execution")'],
    });
    const worker = await prepareExecution(root, { workerName }, docker, gateway, makeSpec, {});
    await assert.rejects(
      collectExecution(root, worker, path.join(root, 'logs'), docker, gateway),
      ReclamationError,
    );
    assert.equal(await docker.inspect(workerName), undefined);
    const completion = JSON.parse(await readFile(path.join(root, 'execution-completion.json'), 'utf8'));
    const release = JSON.parse(await readFile(path.join(root, 'egress/release.json'), 'utf8'));
    assert.equal(release.phase, 'releasing');
    const recoveredDocker = new Docker(),
      recovered = new EgressSession(sessionSpec, recoveredDocker);
    await prepareExecution(root, { workerName }, recoveredDocker, recovered, makeSpec, {});
    assert.equal(
      (await collectExecution(root, worker, path.join(root, 'logs'), recoveredDocker, recovered)).ExitCode,
      0,
    );
    assert.equal(
      JSON.parse(await readFile(path.join(root, 'egress/release.json'), 'utf8')).phase,
      'released',
    );
    for (const container of release.containers)
      assert.equal(await recoveredDocker.inspect(container.name), undefined);
    const remaining = (await command('docker', ['network', 'ls', '--format', '{{.ID}}'])).split('\n');
    for (const network of release.networks) assert.ok(!remaining.some((id) => network.id.startsWith(id)));
    assert.equal(
      (await readFile(path.join(root, 'logs/stdout.log'), 'utf8')).trim(),
      'one original execution',
    );
    assert.equal(
      (await collectExecution(root, worker, path.join(root, 'logs'), recoveredDocker, recovered)).ExitCode,
      0,
    );
    assert.deepEqual(
      JSON.parse(await readFile(path.join(root, 'execution-completion.json'), 'utf8')),
      completion,
    );
    await writeFile(path.join(root, 'logs/stdout.log'), 'tampered');
    await assert.rejects(
      collectExecution(root, worker, path.join(root, 'logs'), recoveredDocker, recovered),
      /Archived execution log changed/,
    );
  },
);

test(
  'recovery verification failure stops original running worker and resumes interrupted failure cleanup',
  { timeout: 60_000 },
  async () => {
    const image = process.env.SPARKVOLVE_TEST_IMAGE;
    assert.ok(image, 'SPARKVOLVE_TEST_IMAGE required');
    const root = await mkdtemp(path.join(os.tmpdir(), 'he-egress-failed-release-'));
    console.log(`Failure reclamation evidence retained: ${root}`);
    const workerName = `he-failure-${randomUUID()}`;
    const isolation = containerSpecification().isolation;
    class RemovalFault extends Docker {
      interrupted = false;
      override async remove(reference: ContainerReference) {
        await super.remove(reference);
        if (!this.interrupted) {
          this.interrupted = true;
          throw Error('injected failure cleanup interruption');
        }
      }
    }
    class VerificationFault extends EgressSession {
      fail = false;
      override async verify(active: boolean) {
        await super.verify(active);
        if (this.fail) throw Error('injected running worker recovery verification failure');
      }
    }
    const docker = new RemovalFault();
    const sessionSpec = {
      root: path.join(root, 'egress'),
      execution: workerName,
      image,
      isolation,
      timeoutSeconds: 30,
      routes: [
        {
          id: 'fixture',
          method: 'GET' as const,
          path: '/fixture',
          upstream: 'https://example.org/',
          addresses: { kind: 'public' as const },
          credential: null,
          body: { kind: 'empty' as const },
          maxRequestBytes: 1,
          timeoutSeconds: 1,
        },
      ],
    };
    const gateway = new VerificationFault(sessionSpec, docker);
    const makeSpec = async (): Promise<ContainerSpec> => ({
      name: workerName,
      image,
      isolation,
      timeoutSeconds: 30,
      network: await gateway.candidateNetwork(),
      env: {},
      mounts: [],
      command: ['node', '-e', 'console.log("original running worker");setInterval(()=>{},1000)'],
    });
    await prepareExecution(root, { workerName }, docker, gateway, makeSpec, {});
    await command('docker', ['start', workerName]);
    const workerID = (await docker.configuration(workerName)).Id;
    assert.equal((await docker.inspect(workerName))?.Running, true);
    gateway.fail = true;
    let failure: unknown;
    try {
      await prepareExecution(root, { workerName }, docker, gateway, makeSpec, {});
    } catch (error) {
      failure = error;
    }
    assert.match(String(failure), /injected running worker recovery verification failure/);
    // No returned worker spec is passed: cleanup resolves its persisted original contract.
    await assert.rejects(settleExecutionFailure(root, docker, gateway, failure), ReclamationError);
    assert.equal(await docker.inspect(workerName), undefined);
    const release = JSON.parse(await readFile(path.join(root, 'egress/release.json'), 'utf8'));
    assert.equal(release.phase, 'releasing');
    assert.equal(release.outcome, 'failed');
    assert.equal(release.containers.find((c: ContainerReference) => c.name === workerName).id, workerID);
    assert.equal(
      JSON.parse(await readFile(path.join(root, 'execution-failure.json'), 'utf8')).phase,
      'reclaiming',
    );
    const recoveredDocker = new Docker(),
      recovered = new EgressSession(sessionSpec, recoveredDocker);
    assert.match(
      (await settleExecutionFailure(root, recoveredDocker, recovered))!,
      /recovery verification failure/,
    );
    assert.equal(
      JSON.parse(await readFile(path.join(root, 'execution-failure.json'), 'utf8')).phase,
      'reclaimed',
    );
    assert.equal(
      JSON.parse(await readFile(path.join(root, 'egress/release.json'), 'utf8')).phase,
      'released',
    );
    for (const reference of release.containers)
      assert.equal(await recoveredDocker.inspect(reference.name), undefined);
    const networkIDs = (
      await command('docker', ['network', 'ls', '--no-trunc', '--format', '{{.ID}}'])
    ).split('\n');
    for (const network of release.networks) assert.ok(!networkIDs.includes(network.id));
    assert.match(
      await readFile(path.join(root, 'egress/failure-worker/stdout.log'), 'utf8'),
      /original running worker/,
    );
    assert.equal(
      JSON.parse(await readFile(path.join(root, 'egress/failure-worker/failure-observation.json'), 'utf8'))
        .reference.id,
      workerID,
    );
  },
);
