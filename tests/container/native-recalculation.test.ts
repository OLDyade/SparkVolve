import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, cp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Docker } from '../../src/docker.js';
import { containerSpecification } from '../fixtures.js';

test(
  'native recalculation preserves formulas, typed errors and original bytes through real DSH tools',
  { timeout: 600000 },
  async () => {
    const image = process.env.SPARKVOLVE_SPREADSHEET_IMAGE;
    assert.ok(image, 'SPARKVOLVE_SPREADSHEET_IMAGE must identify the spreadsheet runtime');
    const root = await mkdtemp(path.join(os.tmpdir(), 'he-engine-semantics-'));
    console.log(`Native engine evidence: ${root}`);
    await mkdir(path.join(root, 'work'));
    await mkdir(path.join(root, 'probe'));
    for (const file of [
      'native-recalculation-fixture.mjs',
      'native-recalculation-fixture.py',
      'runtime-home-fixture.mjs',
    ]) {
      await cp(new URL(file, import.meta.url), path.join(root, 'probe', file));
    }
    await writeFile(
      path.join(root, 'probe/fixture.patch.yml'),
      '- insert:\n    - name: /probe/native-recalculation-fixture.mjs\n',
    );
    const docker = new Docker();
    const container = {
      name: `he-engine-semantics-${Date.now()}`,
      image,
      isolation: containerSpecification().isolation,
      network: 'none' as const,
      env: {},
      timeoutSeconds: 600,
      mounts: [
        { source: path.join(root, 'work'), target: '/workspace', writable: true },
        { source: path.join(root, 'probe'), target: '/probe', writable: false },
        { source: path.resolve('examples/spreadsheet/native-engine'), target: '/candidate', writable: false },
      ],
      command: [
        'node',
        '--input-type=module',
        '-e',
        `
      import {initializeRuntimeEnvironment} from '/app/dist/runtime-environment.js';
      import {checkComposition} from '/app/dist/composition.js';
      await initializeRuntimeEnvironment();
      await checkComposition({profile:'sdk',model:{provider:'fixture',model:'fixture',reasoningEffort:'off',maxTokens:1024,credentialEnv:[]},patches:['/probe/fixture.patch.yml','/candidate/cordis.patch.yml'],directory:'/workspace/native',processCwd:'/app',workspace:'/workspace',timeoutSeconds:600,behaviorModule:'/probe/native-recalculation-fixture.mjs'});
    `,
      ],
    };
    const result = await docker.run(container, path.join(root, 'execution'));
    assert.equal(result.ExitCode, 0, await readFile(path.join(root, 'execution/stderr.log'), 'utf8'));
    const observed = JSON.parse(await readFile(path.join(root, 'work/semantic-contract.json'), 'utf8'));
    assert.equal(observed.verified.formulaCount, 7);
    assert.equal(observed.failedOperationsAtomic, true);
    await docker.remove(await docker.executionReference(container));
  },
);
