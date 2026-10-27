import assert from 'node:assert/strict';
import { isIP } from 'node:net';
import { command } from '../dist/docker.js';

// Resolve Docker's explicit host-gateway mapping before freezing the controller route.
// This helper discovers an address; it does not expose ports or modify host networking.
const image = process.argv[2];
assert.match(image ?? '', /^sha256:[a-f0-9]{64}$/, 'Pass the built immutable runtime image ID');
const output = await command('docker', ['run', '--rm', '--network=bridge',
  '--add-host=host.docker.internal:host-gateway', image, 'getent', 'ahostsv4', 'host.docker.internal']);
const addresses = [...new Set(output.split('\n').filter(Boolean).map(line => line.split(/\s+/)[0]))];
assert.equal(addresses.length, 1, 'Host-gateway mapping must identify one explicit IPv4 address');
assert.equal(isIP(addresses[0]), 4, 'Docker returned an invalid host address');
console.log(addresses[0]);
