import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';

const destination = process.argv[2];
if (!destination) throw new Error('Usage: npm run package:artifacts -- <new-output-directory>');
const output = path.resolve(destination);
await mkdir(output);
const run = (program, args) => execFileSync(program, args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const manifest = JSON.parse(await readFile('package.json', 'utf8'));
const commit = run('git', ['rev-parse', 'HEAD']).trim();
const status = run('git', ['status', '--porcelain']);
const packed = JSON.parse(run('npm', ['pack', '--json', '--pack-destination', output]))[manifest.name];
const archive = await readFile(path.join(output, packed.filename));
const actualIntegrity = 'sha512-' + createHash('sha512').update(archive).digest('base64');
if (packed.integrity !== actualIntegrity) throw new Error('Packed archive does not match npm integrity');
const paths = packed.files.map((item) => item.path);
for (const required of [
  'dist/plugin.js',
  'dist/cli.js',
  'dist/preset.js',
  'cordis.patch.yml',
  '11.md',
  'LICENSE',
])
  if (!paths.includes(required)) throw new Error(`Required distribution entry is missing: ${required}`);
for (const file of paths)
  if (/(^|\/)(\.env(?:\..*)?|\.evolution|\.dsh|__pycache__|node_modules|\.git)(\/|$)|\.py[co]$/.test(file))
    throw new Error(`Unexpected distribution entry: ${file}`);
const sbom = JSON.parse(run('npm', ['sbom', '--sbom-format=cyclonedx', '--package-lock-only', '--omit=dev']));
if (sbom.bomFormat !== 'CycloneDX' || sbom.metadata.component.name !== manifest.name)
  throw new Error('SBOM project identity mismatch');
const sbomBytes = Buffer.from(JSON.stringify(sbom, null, 2) + '\n');
await writeFile(path.join(output, 'dependencies.cdx.json'), sbomBytes, { flag: 'wx' });
const lock = await readFile('package-lock.json');
await writeFile(path.join(output, 'package-lock.json'), lock, { flag: 'wx' });
const receipt = {
  status: 'unpublished-artifact',
  name: manifest.name,
  version: manifest.version,
  commit,
  workingTreeDirty: status.length !== 0,
  workingTreeStatus: status.trim().split('\n').filter(Boolean),
  node: process.version,
  npm: run('npm', ['--version']).trim(),
  platform: process.platform,
  architecture: process.arch,
  archive: {
    file: packed.filename,
    sha256: sha256(archive),
    integrity: actualIntegrity,
    files: packed.files,
  },
  sbom: { file: 'dependencies.cdx.json', sha256: sha256(sbomBytes), components: sbom.components.length },
  lock: { file: 'package-lock.json', sha256: sha256(lock) },
  boundary:
    'Local build inventory, not a signature or public release. SBOM describes this repository lock before installation and excludes dev-only dependencies. Consumer Profile resolution can differ. Dirty working trees are explicitly recorded. Packaging does not substitute for native installation, real-model acceptance, or independent quality results.',
};
const receiptBytes = Buffer.from(JSON.stringify(receipt, null, 2) + '\n');
await writeFile(path.join(output, 'artifact.json'), receiptBytes, { flag: 'wx' });
await writeFile(
  path.join(output, 'SHA256SUMS'),
  [
    `${sha256(archive)}  ${packed.filename}`,
    `${sha256(sbomBytes)}  dependencies.cdx.json`,
    `${sha256(lock)}  package-lock.json`,
    `${sha256(receiptBytes)}  artifact.json`,
  ].join('\n') + '\n',
  { flag: 'wx' },
);
console.log(
  JSON.stringify({
    output,
    commit,
    dirty: receipt.workingTreeDirty,
    files: paths.length,
    dependencies: sbom.components.length,
    sha256: receipt.archive.sha256,
  }),
);
