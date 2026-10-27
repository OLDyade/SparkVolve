import { DatabaseSync } from 'node:sqlite';
import { channel } from 'node:diagnostics_channel';
import type { Server } from 'node:http';
import path from 'node:path';
import { z } from 'zod';
import { canonical, digest } from './artifacts.js';
import { controlRoutes } from './control-routes.js';

const Request = z.strictObject({
  host: z.string().min(1),
  port: z.number().int().min(0).max(65535),
  endpoint: z.string().min(1),
});
const Record = z.strictObject({
  request: Request,
  bound: z.strictObject({
    address: z.string().min(1),
    family: z.enum(['IPv4', 'IPv6']),
    port: z.number().int().positive().max(65535),
  }),
  endpoint: z.string().min(1),
  controlEndpoint: z.string().min(1),
});
export type ControlTransportRequest = z.infer<typeof Request>;
export type ControlTransportRecord = z.infer<typeof Record>;
const observations = channel('harness-evolution:control-transport');

export async function closeControlServer(server: Server): Promise<void> {
  if (!server.listening) return;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
    server.closeAllConnections();
  });
}

/** Commit the actual TCP identity before any optimizer or broker can observe its endpoint. */
export async function listenControlTransport(
  root: string,
  request: ControlTransportRequest,
  listen: (port: number) => Promise<Server>,
  signal?: AbortSignal,
): Promise<{ server: Server; record: ControlTransportRecord }> {
  signal?.throwIfAborted();
  request = Request.parse(request);
  controlRoutes(request.endpoint, 1); // Preserve the explicit literal-IP controller boundary.
  const db = new DatabaseSync(path.join(root, 'control-transport.sqlite'), { timeout: 0 });
  let server: Server | undefined;
  try {
    // Holding the writer lock across listen+commit makes port-zero allocation indivisible to recovery.
    db.exec(`PRAGMA synchronous=FULL;
      CREATE TABLE IF NOT EXISTS transport (
        id INTEGER PRIMARY KEY CHECK(id=1), identity TEXT NOT NULL, record TEXT NOT NULL
      ) STRICT;
      BEGIN IMMEDIATE;`);
    const saved = db.prepare('SELECT identity,record FROM transport WHERE id=1').get() as
      { identity: string; record: string } | undefined;
    const original = saved ? Record.parse(JSON.parse(saved.record)) : undefined;
    if (original && (saved!.identity !== digest(original) || digest(original.request) !== digest(request)))
      throw Error('Controller transport contract changed');
    signal?.throwIfAborted();
    const requestedPort = original?.bound.port ?? request.port;
    server = await listen(requestedPort);
    const address = server.address();
    if (!address || typeof address === 'string') throw Error('Controller has no TCP address');
    if (requestedPort !== 0 && address.port !== requestedPort)
      throw Error('Controller did not bind the requested port');
    const hostname =
      address.address === '0.0.0.0'
        ? '127.0.0.1'
        : address.address === '::'
          ? '[::1]'
          : address.address.includes(':')
            ? `[${address.address}]`
            : address.address;
    const url = new URL(request.endpoint);
    const endpoint =
      url.port === '0'
        ? (() => {
            url.port = String(address.port);
            return url.origin;
          })()
        : request.endpoint;
    const record = Record.parse({
      request,
      bound: address,
      endpoint,
      controlEndpoint: `http://${hostname}:${address.port}`,
    });
    if (original && digest(record) !== digest(original))
      throw Error('Controller binding differs from its frozen transport identity');
    observations.publish({ root, phase: 'bound', record });
    signal?.throwIfAborted();
    if (!original) db.prepare('INSERT INTO transport VALUES (1,?,?)').run(digest(record), canonical(record));
    db.exec('COMMIT;');
    observations.publish({ root, phase: 'committed', record });
    signal?.throwIfAborted();
    return { server, record };
  } catch (error) {
    if (server) {
      try {
        await closeControlServer(server);
      } catch (closing) {
        throw new AggregateError([error, closing], 'Controller transport startup and cleanup failed');
      }
    }
    throw error;
  } finally {
    if (db.isTransaction) db.exec('ROLLBACK');
    db.close();
  }
}
