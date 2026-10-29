import { isIP } from 'node:net';
import type { Route } from './egress.js';

export const controlPaths = [
  '/input',
  '/probe',
  '/probe-evidence',
  '/library',
  '/asset',
  '/materialize',
  '/import',
  '/events',
  '/finish',
  '/candidate',
  '/status',
  '/branch',
  '/submit',
  '/evidence',
] as const;

/** The trusted launch endpoint must explicitly name the container-reachable controller address. */
export function controlRoutes(endpoint: string, timeoutSeconds: number): Route[] {
  return capabilityRoutes(endpoint, timeoutSeconds, controlPaths);
}

/** Explicit capability paths, shared by experiment and optimizer-study control planes. */
export function capabilityRoutes(
  endpoint: string,
  timeoutSeconds: number,
  paths: readonly string[],
): Route[] {
  const url = new URL(endpoint);
  const address = url.hostname.replace(/^\[|\]$/g, '');
  if (
    !isIP(address) ||
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/'
  )
    throw Error('Controller egress endpoint requires an explicit literal IP origin');
  return paths.map((route) => ({
    id: `controller_${route.slice(1).replaceAll('-', '_').replaceAll('/', '_')}`,
    path: route,
    method: 'POST',
    upstream: new URL(route, url).href,
    addresses: { kind: 'exact', values: [address] },
    credential: { env: 'SPARKVOLVE_TOKEN', header: 'authorization', prefix: 'Bearer ' },
    body: { kind: 'json', equals: {}, maximum: {} },
    maxRequestBytes: 1024 * 1024,
    timeoutSeconds: Math.ceil(timeoutSeconds),
  }));
}
