import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { access, mkdir, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { parseArgs, promisify } from 'node:util';

// Installation/capability preflight only. No VM, model, service or network is started.
// Runtime acceptance is deliberately UNKNOWN until the separate native tests run.
const { values, positionals } = parseArgs({
  options: { install: { type: 'boolean', default: false } },
  allowPositionals: true,
});
assert.equal(
  positionals.length,
  1,
  'Usage: node scripts/probe-apple-isolation.mjs [--install] <new-evidence-directory>',
);
const root = path.resolve(positionals[0]);
await mkdir(root, { mode: 0o700 }); // Never overwrite an earlier probe.
const exec = promisify(execFile);
const release = {
  version: '1.6.1',
  commit: 'aa8d76b44a834eee3ebf6a0bc577e376f65f6361',
  url: 'https://github.com/apple/container/releases/download/1.6.1/container-1.6.1-installer-signed.pkg',
  sha256: 'cd47846819f06478d067060efe21e516b562ac0a9af8eecad6d5fea0b556b200',
};
const unknown = () => ({ status: 'unknown', reason: 'Native runtime test has not executed.' });
const receipt = {
  schema: 'apple-isolation-preflight/v1',
  startedAt: new Date().toISOString(),
  purpose: 'Discover installation and native isolation prerequisites; never certify unexecuted VM tests.',
  release,
  installRequested: values.install,
  commands: [],
  runtimeAcceptance: {
    independentLinuxKernels: unknown(),
    noNetworkAttachments: unknown(),
    persistentVolumeENOSPC: unknown(),
    hostLogHardLimit: unknown(),
    controllerReattachment: unknown(),
    resourceEnforcement: unknown(),
    recoveryAndArchive: unknown(),
  },
  createdResources: { containers: [], volumes: [], networks: [], services: [] },
  acceptedAsExecutionBackend: false,
};
const env = Object.fromEntries(
  ['PATH', 'HOME', 'TMPDIR', 'USER', 'LOGNAME']
    .filter((key) => process.env[key] !== undefined)
    .map((key) => [key, process.env[key]]),
);
env.LC_ALL = 'C';
async function persist() {
  await writeFile(path.join(root, 'receipt.json'), `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 });
}
async function command(file, args, required = true) {
  const observation = { file, args, startedAt: new Date().toISOString() };
  try {
    const output = await exec(file, args, { env, timeout: 60_000, maxBuffer: 256 * 1024 });
    Object.assign(observation, output, { exitCode: 0 });
  } catch (error) {
    Object.assign(observation, {
      stdout: error.stdout ?? '',
      stderr: error.stderr ?? '',
      exitCode: typeof error.code === 'number' ? error.code : null,
      error: String(error.code ?? error.message),
      signal: error.signal ?? null,
    });
  }
  observation.finishedAt = new Date().toISOString();
  receipt.commands.push(observation);
  await persist();
  if (required && observation.exitCode !== 0)
    throw new Error(`Command failed: ${file} ${args.join(' ')}; see receipt.json`);
  return observation;
}
async function findCLI() {
  const candidates = [
    ...new Set(
      (env.PATH ?? '')
        .split(path.delimiter)
        .filter(Boolean)
        .map((directory) => path.join(directory, 'container'))
        .concat('/usr/local/bin/container', '/opt/homebrew/bin/container'),
    ),
  ];
  for (const file of candidates) {
    try {
      await access(file, constants.X_OK);
      return file;
    } catch (error) {
      if (!['ENOENT', 'ENOTDIR', 'EACCES'].includes(error.code)) throw error;
    }
  }
  return null;
}
async function officialInstaller() {
  const file = path.join(root, 'container-1.6.1-installer-signed.pkg');
  const response = await fetch(release.url, { signal: AbortSignal.timeout(120_000) });
  assert.ok(response.ok && response.body, `Official asset download failed: HTTP ${response.status}`);
  const hash = createHash('sha256');
  let bytes = 0;
  const digestStream = new Transform({
    transform(chunk, _encoding, callback) {
      bytes += chunk.length;
      if (bytes > 512 * 1024 * 1024) return callback(new Error('Installer exceeds the probe download limit'));
      hash.update(chunk);
      callback(null, chunk);
    },
  });
  await pipeline(
    Readable.fromWeb(response.body),
    digestStream,
    createWriteStream(file, { flags: 'wx', mode: 0o600 }),
  );
  const resolved = new URL(response.url);
  receipt.installer = {
    file,
    bytes,
    sha256: hash.digest('hex'),
    finalURL: `${resolved.origin}${resolved.pathname}`,
  };
  await persist();
  assert.equal(receipt.installer.sha256, release.sha256, 'Official release asset digest mismatch');
  await command('/usr/sbin/pkgutil', ['--check-signature', file]);
  await command('/usr/sbin/spctl', ['--assess', '--type', 'install', '--verbose=2', file]);
  // Official system package installation only. Never unpack into a private prefix to evade auth.
  const install = await command(
    '/usr/bin/sudo',
    ['-n', '/usr/sbin/installer', '-pkg', file, '-target', '/'],
    false,
  );
  receipt.installation = {
    status: install.exitCode === 0 ? 'installed' : 'failed',
    reason: install.exitCode === 0 ? 'Official signed package installed.' : install.stderr.trim(),
  };
  await persist();
  assert.equal(install.exitCode, 0, 'Official installation did not complete; no VM tests can be claimed.');
}
try {
  assert.equal(process.platform, 'darwin', 'Apple native backend requires macOS');
  const os = await command('/usr/bin/sw_vers', []);
  const arch = await command('/usr/bin/uname', ['-m']);
  const hv = await command('/usr/sbin/sysctl', ['-n', 'kern.hv_support']);
  const cpu = await command('/usr/sbin/sysctl', ['-n', 'machdep.cpu.brand_string']);
  receipt.host = {
    os: os.stdout.trim(),
    arch: arch.stdout.trim(),
    hypervisor: hv.stdout.trim(),
    cpu: cpu.stdout.trim(),
  };
  assert.equal(receipt.host.arch, 'arm64');
  assert.equal(receipt.host.hypervisor, '1');
  assert.match(
    receipt.host.os,
    /ProductVersion:\s+26\./,
    'This probe is researched against officially supported macOS 26.',
  );
  let cli = await findCLI();
  receipt.cliBefore = cli;
  await persist();
  if (!cli && values.install) {
    await officialInstaller();
    cli = await findCLI();
    assert.ok(cli, 'Package installation returned success but container CLI is absent');
  }
  if (!cli) throw new Error('container CLI is absent; use --install for the official signed installer.');
  receipt.cli = cli;
  const version = await command(cli, ['--version']);
  const identity = /^container CLI version (\S+) \(build: (\w+), commit: (\w+)\)$/.exec(
    version.stdout.trim(),
  );
  assert.ok(identity, 'Unrecognized official CLI version format; investigate before proceeding');
  receipt.cliIdentity = { version: identity[1], build: identity[2], commit: identity[3] };
  await persist();
  assert.equal(receipt.cliIdentity.version, release.version, 'CLI differs from the researched release');
  assert.equal(receipt.cliIdentity.build, 'release', 'This probe targets the official release build');
  assert.equal(receipt.cliIdentity.commit, release.commit.slice(0, 7), 'CLI source identity mismatch');
  await command(cli, ['create', '--help']);
  await command(cli, ['volume', 'create', '--help']);
  await command(cli, ['system', 'start', '--help']);
  receipt.status = 'preflight-complete-runtime-unverified';
  process.exitCode = 2; // Successful preflight never certifies the full isolation contract.
} catch (error) {
  receipt.status = 'blocked';
  receipt.error = String(error);
  process.exitCode = 1;
} finally {
  receipt.finishedAt = new Date().toISOString();
  await persist();
  console.log(
    JSON.stringify({
      status: receipt.status,
      acceptedAsExecutionBackend: false,
      evidence: path.join(root, 'receipt.json'),
    }),
  );
}
