// Explicit local workstation policy. Inspect/edit before freezing an experiment.
import { Isolation } from '../dist/contracts.js';
import { Docker } from '../dist/docker.js';

const [runtime] = process.argv.slice(2);
if (!runtime) throw new Error('Usage: node examples/isolation.mjs <registered-docker-runtime>');
const policy = Isolation.parse({
  runtime,
  user: { uid: process.getuid(), gid: process.getgid() },
  memoryMiB: 4096,
  cpus: 2,
  pids: 256,
  tmpMiB: 512,
  homeMiB: 128,
  network: { optimizer: 'bridge', executor: 'bridge', build: 'bridge', qa: 'none', evaluator: 'none' },
});
await new Docker().host(runtime);
console.log(JSON.stringify(policy, null, 2));
