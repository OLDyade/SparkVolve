// Deployment discovery only: the controlled broker network still needs its own DNS acceptance.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { EgressDns, Image, Id } from '../dist/contracts.js';

const [image, runtime] = process.argv.slice(2);
if (!image || !runtime)
  throw Error('Usage: node scripts/egress-dns.mjs <immutable-image-id> <registered-docker-runtime>');
Image.parse(image);
Id.parse(runtime);
const uid = process.getuid(),
  gid = process.getgid();
if (uid === 0) throw Error('Run DNS discovery as a non-root user');
const execute = promisify(execFile);
const name = `he-dns-discovery-${randomUUID()}`;
let resolvConf;
try {
  const result = await execute(
    'docker',
    [
      'run',
      '--rm',
      '--name',
      name,
      '--pull=never',
      '--runtime',
      runtime,
      '--network=bridge',
      '--entrypoint=node',
      '--user',
      `${uid}:${gid}`,
      '--read-only',
      '--cap-drop=ALL',
      '--security-opt=no-new-privileges',
      '--pids-limit=32',
      '--memory=128m',
      '--memory-swap=128m',
      '--cpus=1',
      image,
      '-e',
      'process.stdout.write(require("node:fs").readFileSync("/etc/resolv.conf","utf8"))',
    ],
    { timeout: 30000, maxBuffer: 65536 },
  );
  resolvConf = result.stdout;
} finally {
  const { stdout } = await execute('docker', [
    'container',
    'ls',
    '-a',
    '--filter',
    `name=^/${name}$`,
    '--format',
    '{{.ID}}',
  ]);
  if (stdout.trim()) await execute('docker', ['rm', '--force', name], { timeout: 10000 });
}
const servers = EgressDns.parse(
  resolvConf.split('\n').flatMap((line) => {
    const match = line.match(/^\s*nameserver\s+(\S+)(?:\s|$)/);
    return match ? [match[1]] : [];
  }),
);
console.log(
  JSON.stringify(
    {
      discoveredAt: new Date().toISOString(),
      image,
      runtime,
      network: 'bridge',
      servers,
      resolvConf,
      scope:
        'Candidate IPv4 resolvers observed on the declared image/runtime default bridge. This does not verify reachability or resolution on the final controlled broker network; freeze the operator-approved list and verify that network separately.',
    },
    null,
    2,
  ),
);
