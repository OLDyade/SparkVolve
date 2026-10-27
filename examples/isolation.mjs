// Explicit local workstation policy. Inspect/edit before freezing an experiment.
import { Isolation } from '../dist/contracts.js';
import { Docker } from '../dist/docker.js';

const [runtime, egressPool, dns] = process.argv.slice(2);
if (!runtime || !egressPool || !dns)
  throw new Error(
    'Usage: node examples/isolation.mjs <registered-docker-runtime> <reserved-private-IPv4-CIDR> <comma-separated-IPv4-DNS-servers>',
  );
const policy = Isolation.parse({
  runtime,
  user: { uid: process.getuid(), gid: process.getgid() },
  memoryMiB: 4096,
  cpus: 2,
  pids: 256,
  tmpMiB: 512,
  homeMiB: 128,
  network: {
    egressPool,
    egressDns: dns.split(','),
    optimizer: 'controlled',
    executor: 'controlled',
    build: 'bridge',
    qa: 'none',
    evaluator: 'none',
  },
});
await new Docker().host(runtime);
console.log(JSON.stringify(policy, null, 2));
