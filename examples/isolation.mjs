// Explicit local workstation policy. Inspect/edit before freezing an experiment.
import { Isolation } from '../dist/contracts.js';
import { Docker } from '../dist/docker.js';

const [runtime, egressPool] = process.argv.slice(2);
if (!runtime || !egressPool)
  throw new Error(
    'Usage: node examples/isolation.mjs <registered-docker-runtime> <reserved-private-IPv4-CIDR>',
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
    optimizer: 'controlled',
    executor: 'controlled',
    build: 'bridge',
    qa: 'none',
    evaluator: 'none',
  },
});
await new Docker().host(runtime);
console.log(JSON.stringify(policy, null, 2));
