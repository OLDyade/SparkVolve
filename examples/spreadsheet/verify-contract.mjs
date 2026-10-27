import { mkdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Docker } from '../../dist/docker.js';
import { Image, Isolation, Model } from '../../dist/contracts.js';
import { atomicJSON, treeDigest } from '../../dist/artifacts.js';

const [image, isolationFile, modelFile, environmentDir, bundleDir, outputDir] = process.argv.slice(2);
if (!image || !isolationFile || !modelFile || !environmentDir || !bundleDir || !outputDir)
  throw new Error(
    'Usage: verify-contract.mjs <image-digest> <isolation.json> <model.json> <environment-directory> <bundle-directory> <new-output-directory>',
  );
Image.parse(image);
const isolation = Isolation.parse(JSON.parse(await readFile(isolationFile, 'utf8')));
const model = Model.parse(JSON.parse(await readFile(modelFile, 'utf8')));
const environment = path.resolve(environmentDir),
  bundle = path.resolve(bundleDir),
  output = path.resolve(outputDir);
const suite = fileURLToPath(new URL('./verification', import.meta.url));
await mkdir(output);
await mkdir(path.join(output, 'work'));
const launch = path.join(output, 'launch.json');
await atomicJSON(launch, {
  profile: 'sdk',
  model,
  patches: ['/environment/cordis.patch.yml', '/candidate/cordis.patch.yml'],
  command: null,
  behaviorModule: '/verification/check.mjs',
  timeoutSeconds: 60,
});
const identity = {
  image,
  isolation,
  model,
  environmentDigest: await treeDigest(environment),
  bundleDigest: await treeDigest(bundle),
  verificationDigest: await treeDigest(suite),
};
await atomicJSON(path.join(output, 'identity.json'), identity);
const result = await new Docker().run(
  {
    name: `he-spreadsheet-contract-${randomUUID()}`,
    image,
    command: ['node', '/app/dist/runtime/qa.js', '/launch.json'],
    mounts: [
      { source: environment, target: '/environment', writable: false },
      { source: bundle, target: '/candidate', writable: false },
      { source: suite, target: '/verification', writable: false },
      { source: launch, target: '/launch.json', writable: false },
      { source: path.join(output, 'work'), target: '/workspace', writable: true },
    ],
    env: {},
    network: 'none',
    isolation,
    timeoutSeconds: 60,
  },
  path.join(output, 'logs'),
);
await atomicJSON(path.join(output, 'result.json'), {
  ...identity,
  container: result,
  passed: result.ExitCode === 0,
});
if (result.ExitCode !== 0)
  throw new Error(`Spreadsheet contract failed; original evidence retained at ${output}`);
console.log(`Spreadsheet native contract passed: ${output}`);
