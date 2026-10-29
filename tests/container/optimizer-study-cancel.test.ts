import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { atomicJSON, digest } from '../../src/artifacts.js';
import { Docker, type ContainerReference, type ContainerSpec } from '../../src/docker.js';
import { prepareExecution } from '../../src/execution.js';
import { OptimizerStudy } from '../../src/optimizer-study-contracts.js';
import { OptimizerStudyStore } from '../../src/optimizer-study-store.js';
import { cancelOptimizerStudy } from '../../src/optimizer-study-cancel.js';
import { containerSpecification, hash } from '../fixtures.js';

test(
  'real parent study cancellation reclaims completed method and meta workers across interruption',
  { timeout: 120_000 },
  async () => {
    const image = process.env.SPARKVOLVE_TEST_IMAGE;
    assert.ok(image, 'SPARKVOLVE_TEST_IMAGE required');
    const base = containerSpecification(),
      root = await mkdtemp(path.join(os.tmpdir(), 'he-real-study-cancel-'));
    console.log(`Study cancellation evidence retained: ${root}`);
    const method = (name: string) => ({
      source: { directory: `${name}/source`, digest: digest(name) },
      artifact: {
        directory: `${name}/artifact`,
        identity: {
          artifactDigest: hash,
          bundleDigest: hash,
          tarballDigest: hash,
          lockDigest: hash,
          image: base.runtime.image,
        },
      },
      composition: 'plugins.yml',
    });
    const item = (id: string) => ({
      id,
      seed: { source: method('h').source, artifact: method('h').artifact },
      search: { specification: base, dataset: { directory: `${id}/search`, digest: hash } },
      assessment: {
        specification: { ...base, purpose: 'validation', budget: { ...base.budget, candidates: 1 } },
        dataset: { directory: `${id}/assessment`, digest: hash },
      },
    });
    const spec = OptimizerStudy.parse({
      name: 'real-cancel',
      objective: 'Real resource cancellation boundary; synthetic method identities do not certify a build',
      baseline: method('g0'),
      metaOptimizer: method('meta'),
      metaRuntime: { runtime: base.runtime, model: base.optimizer, isolation: base.isolation, egress: [] },
      methodBuild: base.candidate.build,
      methodQA: null,
      developmentCases: [item('development')],
      validationCases: [item('sealed')],
      repetitions: 1,
      budget: { methodCandidates: 2, metaOptimizerSeconds: 60, concurrentSearches: 1 },
      selection: { failureLimit: 0 },
    });
    await atomicJSON(path.join(root, 'registration.json'), spec);
    const store = new OptimizerStudyStore(path.join(root, 'study.sqlite'), spec),
      owner = 'container-fixture';
    store.acquire(owner, Date.now(), 60_000);
    class Interrupted extends Docker {
      interrupt = true;
      override async remove(reference: ContainerReference) {
        await super.remove(reference);
        if (this.interrupt) {
          this.interrupt = false;
          throw Error('injected parent cleanup interruption');
        }
      }
    }
    const docker = new Interrupted(),
      references: ContainerReference[] = [];
    try {
      const value = method('g1'),
        candidate = store.reserveMethod(owner, {
          source: value.source,
          composition: value.composition,
          proposal: {
            draft: 'fixture',
            parents: [spec.baseline.source.digest],
            actions: ['author'],
            evidence: ['cancellation fixture only'],
            hypothesis: 'Reclaim terminal parent roles',
            expectedChange: 'No model-quality claim',
          },
        });
      store.publishMethod(owner, candidate.id, value);
      store.reserveMetaEpisode(owner, 0, 60);
      store.startMetaEpisode(owner, 0);
      for (const directory of [`methods/${candidate.id}/optimizer-harness/qa`, 'meta-optimizer/0']) {
        const home = path.join(root, directory);
        await mkdir(home, { recursive: true });
        const worker: ContainerSpec = {
          name: `he-study-cancel-${randomUUID()}`,
          image,
          isolation: base.isolation,
          timeoutSeconds: 60,
          env: {},
          mounts: [],
          network: 'none',
          command: ['node', '-e', 'console.log("original terminal study worker")'],
        };
        await prepareExecution(home, { directory }, docker, null, async () => worker, {});
        references.push(await docker.executionReference(worker));
        const result = await docker.collect(worker, path.join(home, 'original-logs'));
        assert.equal(result.ExitCode, 0);
        if (directory === 'meta-optimizer/0') {
          const seconds = (Date.parse(result.FinishedAt) - Date.parse(result.StartedAt)) / 1000;
          await atomicJSON(path.join(home, 'receipt.json'), result);
          store.finishMetaEpisode(owner, 0, 'complete', seconds, digest(result));
        }
      }
      store.release(owner);
      await assert.rejects(cancelOptimizerStudy(root, docker), /injected parent cleanup interruption/);
      assert.equal(store.state().phase, 'cancelling');
      const receipt = await cancelOptimizerStudy(root, new Docker());
      assert.equal(store.state().phase, 'cancelled');
      for (const reference of references) {
        assert.equal(await docker.inspect(reference.name), undefined);
        assert.ok(receipt.resources.executions.some((entry) => entry.reference?.id === reference.id));
      }
      assert.equal(store.method(candidate.id).phase, 'ready');
      assert.equal(store.metaEpisodes()[0]!.phase, 'complete');
      assert.deepEqual(await cancelOptimizerStudy(root, new Docker()), receipt);
    } finally {
      store.release(owner);
      store.close();
      for (const reference of references) await new Docker().remove(reference);
    }
  },
);
