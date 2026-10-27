import { readFileSync, openSync, writeFileSync, fsyncSync, closeSync } from 'node:fs';
import { serveEgress } from '../egress.js';

const [configuration, ledger] = process.argv.slice(2);
if (!configuration || !ledger)
  throw new Error('Usage: egress <configuration.json> <new-request-ledger.jsonl>');
const descriptor = openSync(ledger, 'ax', 0o600);
const server = await serveEgress(JSON.parse(readFileSync(configuration, 'utf8')), {
  credentials: process.env,
  record: (event) => {
    writeFileSync(descriptor, JSON.stringify(event) + '\n');
    fsyncSync(descriptor);
  },
});
process.stdout.write(JSON.stringify({ event: 'egress.ready', address: server.address() }) + '\n');
let stopping: Promise<void> | undefined;
function stop(): Promise<void> {
  stopping ??= server.shutdown().then(() => {
    closeSync(descriptor);
  });
  return stopping;
}
server.on('error', () => {
  process.stderr.write('Egress broker failed; inspect its request ledger.\n');
  process.exitCode = 1;
  void stop();
});
for (const signal of ['SIGTERM', 'SIGINT'] as const)
  process.once(signal, () => {
    void stop();
  });
