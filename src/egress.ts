import http from 'node:http';
import https from 'node:https';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { randomUUID } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import ipaddr from 'ipaddr.js';
import { z } from 'zod';

const IP = z.string().refine((value) => isIP(value) !== 0, 'Expected a literal IP address');
const scalar = z.union([z.string(), z.number().finite(), z.boolean(), z.null()]);
export const EgressRoute = z
  .strictObject({
    id: z.string().regex(/^[a-zA-Z0-9_-]+$/),
    path: z.string().regex(/^\/[a-zA-Z0-9/_-]*$/),
    method: z.enum(['GET', 'POST']),
    upstream: z.url(),
    addresses: z.discriminatedUnion('kind', [
      z.strictObject({ kind: z.literal('public') }),
      z.strictObject({ kind: z.literal('exact'), values: z.array(IP).min(1) }),
    ]),
    credential: z
      .strictObject({
        env: z.string().regex(/^[A-Z][A-Z0-9_]*$/),
        header: z.string().min(1),
        prefix: z.string(),
      })
      .nullable(),
    body: z.discriminatedUnion('kind', [
      z.strictObject({ kind: z.literal('empty') }),
      z.strictObject({
        kind: z.literal('json'),
        equals: z.record(z.string(), scalar),
        maximum: z.record(z.string(), z.number().int().positive()),
      }),
    ]),
    maxRequestBytes: z.number().int().positive(),
    timeoutSeconds: z.number().int().positive(),
  })
  .superRefine((route, ctx) => {
    const url = new URL(route.upstream);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash || url.search)
      ctx.addIssue({
        code: 'custom',
        message: 'Upstream requires an exact HTTP(S) URL without credentials, fragment or query',
      });
    if (url.protocol === 'http:' && route.addresses.kind !== 'exact')
      ctx.addIssue({ code: 'custom', message: 'Plain HTTP requires explicitly pinned addresses' });
    if (route.method === 'GET' && route.body.kind !== 'empty')
      ctx.addIssue({ code: 'custom', message: 'GET routes require an empty body' });
  });
export const EgressConfig = z
  .strictObject({
    bindAddress: IP,
    port: z.number().int().min(0).max(65535),
    routes: z.array(EgressRoute).min(1),
  })
  .superRefine((config, ctx) => {
    if (
      new Set(config.routes.map((r) => r.id)).size !== config.routes.length ||
      new Set(config.routes.map((r) => `${r.method} ${r.path}`)).size !== config.routes.length
    )
      ctx.addIssue({ code: 'custom', message: 'Duplicate egress route' });
  });
export type Route = z.infer<typeof EgressRoute>;
export type Address = { address: string; family: number };
type Resolver = (hostname: string) => Promise<Address[]>;
export interface EgressEvent {
  id: string;
  at: string;
  phase: 'started' | 'finished';
  route: string | null;
  outcome?: 'completed' | 'denied' | 'upstream_error' | 'cancelled' | 'timeout';
  upstreamStatus?: number;
  address?: string;
}
export type EgressServer = http.Server & { shutdown: () => Promise<void> };
class Denied extends Error {}

function normalized(address: string): string {
  return ipaddr.process(address).toString();
}
/** Resolve once, validate the entire answer, then give the socket only the selected IP. */
export async function resolveEgressAddress(route: Route, resolve: Resolver): Promise<Address> {
  const host = new URL(route.upstream).hostname.replace(/^\[|\]$/g, '');
  const addresses = isIP(host) ? [{ address: host, family: isIP(host) }] : await resolve(host);
  if (!addresses.length) throw new Denied('No resolved address');
  for (const address of addresses) {
    if (isIP(address.address) !== address.family) throw new Denied('Invalid DNS address');
    const parsed = ipaddr.process(address.address);
    const allowed =
      route.addresses.kind === 'public'
        ? parsed.range() === 'unicast'
        : route.addresses.values.some((value) => normalized(value) === parsed.toString());
    if (!allowed) throw new Denied('Resolved address outside route contract');
  }
  return addresses[0]!;
}

async function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  let abort: () => void;
  const cancelled = new Promise<never>((_resolve, reject) => {
    abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
  });
  try {
    return await Promise.race([promise, cancelled]);
  } finally {
    signal.removeEventListener('abort', abort!);
  }
}

async function readBody(req: http.IncomingMessage, route: Route, signal: AbortSignal): Promise<Buffer> {
  const declared = req.headers['content-length'];
  if (declared !== undefined && (!/^\d+$/.test(declared) || Number(declared) > route.maxRequestBytes))
    throw new Denied('Request exceeds route limit');
  if (
    req.headers['content-encoding'] ||
    (route.body.kind === 'json' && req.headers['content-type']?.split(';')[0]?.trim() !== 'application/json')
  )
    throw new Denied('Unsupported request encoding');
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const raw of req) {
    signal.throwIfAborted();
    const chunk = Buffer.from(raw);
    size += chunk.length;
    if (size > route.maxRequestBytes) throw new Denied('Request exceeds route limit');
    chunks.push(chunk);
  }
  const body = Buffer.concat(chunks);
  if (route.body.kind === 'empty') {
    if (body.length) throw new Denied('Body not allowed');
  } else {
    let value: unknown;
    try {
      value = JSON.parse(body.toString('utf8'));
    } catch {
      throw new Denied('Invalid JSON');
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Denied('JSON object required');
    const object = value as Record<string, unknown>;
    for (const [key, expected] of Object.entries(route.body.equals))
      if (!Object.hasOwn(object, key) || object[key] !== expected)
        throw new Denied('Request differs from route contract');
    for (const [key, maximum] of Object.entries(route.body.maximum)) {
      const actual = object[key];
      if (
        !Object.hasOwn(object, key) ||
        typeof actual !== 'number' ||
        !Number.isSafeInteger(actual) ||
        actual < 1 ||
        actual > maximum
      )
        throw new Denied('Request exceeds contracted numeric range');
    }
  }
  return body;
}

/** Fixed-route broker; process/network isolation is the caller's responsibility. No proxy fallback. */
export async function serveEgress(
  raw: unknown,
  options: {
    credentials: NodeJS.ProcessEnv;
    record: (event: EgressEvent) => void;
    resolve?: Resolver;
  },
): Promise<EgressServer> {
  const config = EgressConfig.parse(raw);
  const secrets = new Map<string, { header: string; value: string }>();
  for (const route of config.routes) {
    if (!route.credential) continue;
    const { env, header, prefix } = route.credential;
    const secret = options.credentials[env];
    if (!secret) throw new Error(`Missing egress credential: ${env}`);
    http.validateHeaderName(header);
    http.validateHeaderValue(header, prefix + secret);
    if (
      [
        'host',
        'connection',
        'transfer-encoding',
        'content-length',
        'content-type',
        'upgrade',
        'proxy-authorization',
      ].includes(header.toLowerCase())
    )
      throw new Error('Credential header conflicts with transport');
    secrets.set(route.id, { header: header.toLowerCase(), value: prefix + secret });
  }
  const resolve = options.resolve ?? ((hostname) => lookup(hostname, { all: true }));
  const pending = new Set<Promise<void>>();
  let stopping: Promise<void> | undefined;
  const server = http.createServer((req, res) => {
    const task = handle(req, res).catch((error: unknown) => {
      // A broken ledger invalidates the broker, including its other active requests.
      void shutdown();
      server.emit('error', new Error('Egress evidence write failed', { cause: error }));
    });
    pending.add(task);
    void task.finally(() => pending.delete(task));
  });
  function shutdown(): Promise<void> {
    stopping ??= (async () => {
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      });
      // Socket closure precedes async request finally blocks; keep the ledger open until both finish.
      await Promise.allSettled([...pending]);
    })();
    return stopping;
  }
  async function handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const route = config.routes.find((r) => r.path === req.url && r.method === req.method);
    const id = randomUUID();
    const record = (event: Omit<EgressEvent, 'id' | 'at' | 'route'>) =>
      options.record({ id, at: new Date().toISOString(), route: route?.id ?? null, ...event });
    record({ phase: 'started' });
    const abort = new AbortController();
    let timedOut = false;
    const deadline = route
      ? setTimeout(() => {
          timedOut = true;
          abort.abort();
          req.destroy();
          res.destroy();
        }, route.timeoutSeconds * 1000)
      : undefined;
    const closed = () => {
      if (!res.writableFinished) abort.abort();
    };
    res.on('close', closed);
    let address: Address | undefined, upstreamStatus: number | undefined;
    let outcome: EgressEvent['outcome'] = 'upstream_error';
    try {
      if (!route) throw new Denied('Route not permitted');
      const body = await readBody(req, route, abort.signal);
      address = await abortable(resolveEgressAddress(route, resolve), abort.signal);
      abort.signal.throwIfAborted();
      const url = new URL(route.upstream);
      const headers: Record<string, string> = {
        'content-length': String(body.length),
        'accept-encoding': 'identity',
        ...(route.body.kind === 'json' ? { 'content-type': 'application/json' } : {}),
      };
      const credential = secrets.get(route.id);
      if (credential) headers[credential.header] = credential.value;
      const pinned = address;
      const response = await new Promise<http.IncomingMessage>((resolve, reject) => {
        const request = (url.protocol === 'https:' ? https : http).request(
          url,
          {
            // A fixed nonzero family disables Node's automatic family selection.
            method: route.method,
            headers,
            agent: false,
            family: pinned.family,
            signal: abort.signal,
            lookup: (_hostname, opts, callback) => {
              if (opts.all) callback(null, [pinned]);
              else callback(null, pinned.address, pinned.family);
            },
          },
          resolve,
        );
        request.on('error', reject);
        request.end(body);
      });
      upstreamStatus = response.statusCode;
      res.statusCode = upstreamStatus ?? 502;
      for (const name of ['content-type', 'content-encoding', 'retry-after']) {
        const value = response.headers[name];
        if (value !== undefined) res.setHeader(name, value);
      }
      // Redirects remain responses. The broker never follows Location or retries any request.
      await pipeline(response, res, { signal: abort.signal });
      outcome = 'completed';
    } catch (error) {
      outcome = timedOut
        ? 'timeout'
        : error instanceof Denied
          ? 'denied'
          : abort.signal.aborted
            ? 'cancelled'
            : 'upstream_error';
      if (!res.headersSent && !res.destroyed) {
        res.writeHead(outcome === 'denied' ? 403 : 502, {
          'content-type': 'application/json',
          connection: 'close',
        });
        res.end(JSON.stringify({ error: outcome, requestId: id }));
      } else res.destroy();
    } finally {
      clearTimeout(deadline);
      res.off('close', closed);
      abort.abort();
      record({
        phase: 'finished',
        outcome,
        ...(address ? { address: address.address } : {}),
        ...(upstreamStatus !== undefined ? { upstreamStatus } : {}),
      });
    }
  }
  server.on('connect', (_req, socket) => socket.destroy());
  server.on('upgrade', (_req, socket) => socket.destroy());
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(config.port, config.bindAddress, () => {
      server.off('error', reject);
      resolve();
    });
  });
  return Object.assign(server, { shutdown });
}
