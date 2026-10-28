import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, cp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Docker } from '../../src/docker.js';
import { containerSpecification } from '../fixtures.js';

test(
  'native sandbox can initialize default LibreOffice profile in quota-bound HOME',
  { timeout: 180000 },
  async () => {
    const image = process.env.HE_SPREADSHEET_IMAGE;
    assert.ok(image, 'HE_SPREADSHEET_IMAGE must identify the immutable spreadsheet runtime');
    const root = await mkdtemp(path.join(os.tmpdir(), 'he-native-home-'));
    console.log(`Native HOME evidence retained: ${root}`);
    await mkdir(path.join(root, 'work'));
    await mkdir(path.join(root, 'probe'));
    await cp(new URL('./runtime-home-fixture.mjs', import.meta.url), path.join(root, 'probe/fixture.mjs'));
    await writeFile(path.join(root, 'probe/patch.yml'), '- insert:\n    - name: /probe/fixture.mjs\n');
    const spec = containerSpecification();
    const docker = new Docker();
    const container = {
      name: `he-native-home-${Date.now()}`,
      image,
      isolation: spec.isolation,
      network: 'none' as const,
      env: {},
      timeoutSeconds: 120,
      mounts: [
        { source: path.join(root, 'work'), target: '/workspace', writable: true },
        { source: path.join(root, 'probe'), target: '/probe', writable: false },
      ],
      command: [
        'node',
        '--input-type=module',
        '-e',
        `
      import {initializeRuntimeEnvironment} from '/app/dist/runtime-environment.js';
      import {checkComposition} from '/app/dist/composition.js';
      import {execFileSync} from 'node:child_process';
      await initializeRuntimeEnvironment();
      execFileSync('python3',['-c',"import openpyxl;w=openpyxl.Workbook();w.active['A1']=7;w.active['B1']='=A1*6';w.save('/workspace/input.xlsx')"]);
      await checkComposition({profile:'sdk',model:{provider:'fixture',model:'fixture',reasoningEffort:'off',maxTokens:1024,credentialEnv:[]},patches:['/probe/patch.yml'],directory:'/workspace/native',processCwd:'/app',workspace:'/workspace',timeoutSeconds:90,behaviorModule:'/probe/fixture.mjs'});
    `,
      ],
    };
    const state = await docker.run(container, path.join(root, 'execution'));
    assert.equal(state.ExitCode, 0, await readFile(path.join(root, 'execution/stderr.log'), 'utf8'));
    const csv = await readFile(path.join(root, 'work/convert/input.csv'), 'utf8');
    assert.match(csv, /7,42/);
    await docker.remove(await docker.executionReference(container));
    assert.deepEqual(
      await readdir(path.join(root, 'work/.harness-home')),
      [],
      'HOME contents must remain ephemeral, never enter host delivery files',
    );
  },
);
