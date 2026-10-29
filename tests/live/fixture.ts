import assert from 'node:assert/strict';
import { isIP } from 'node:net';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { ExperimentSpec } from '../../src/contracts.js';
import { treeDigest } from '../../src/artifacts.js';

export const liveBudgets = Object.freeze({
  optimizerSeconds: 600,
  buildSeconds: 120,
  probeBuildSeconds: 60,
  probeSeconds: 600,
  teardownSeconds: 60,
});

export function liveTestTimeout(withProbe = false): number {
  return (
    1000 *
    (liveBudgets.buildSeconds +
      liveBudgets.optimizerSeconds +
      liveBudgets.teardownSeconds +
      (withProbe ? liveBudgets.probeBuildSeconds + liveBudgets.probeSeconds : 0))
  );
}

/** Use the shipped provider recipe; freeze the environment only after routing is configured. */
export async function configureLiveModel(dataset: string, spec: ExperimentSpec): Promise<void> {
  const { configureEgress } = await import(new URL('../../examples/venus/egress.mjs', import.meta.url).href);
  spec.optimizer = JSON.parse(await readFile('examples/venus/model.json', 'utf8'));
  spec.executor = spec.optimizer;
  const directory = path.join(dataset, 'environment');
  spec.egress = await configureEgress(directory, spec.optimizer);
  spec.runtime.environment = {
    directory: 'environment',
    patch: 'cordis.patch.yml',
    digest: await treeDigest(directory),
  };
}

export function liveControllerEndpoint(port: number): string {
  const address = process.env.SPARKVOLVE_TEST_CONTROLLER_IP;
  assert.ok(
    address && isIP(address) === 4,
    'SPARKVOLVE_TEST_CONTROLLER_IP must be an explicit broker-reachable IPv4 address',
  );
  return `http://${address}:${port}`;
}
