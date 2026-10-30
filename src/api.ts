import { createServer } from 'node:http';
import type { Server } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { Controller } from './controller.js';
import { Digest, Id, RelativePath } from './contracts.js';
import { OptimizerAccess, OptimizerCursor } from './optimizer-access.js';
import { draftOrigin } from './library.js';
import { controlPaths } from './control-routes.js';
import { readEvidence, materializeEvidence } from './evidence.js';

export async function serve(
  controller: Controller,
  token: string,
  port: number,
  host: string,
  signal?: AbortSignal,
): Promise<Server> {
  if (controller.spec.purpose !== 'search') throw new Error('Validation experiments have no optimizer API');
  if (token.length < 32) throw new Error('Controller capability must have at least 32 characters');
  const access = new OptimizerAccess(controller);
  const server = createServer(async (req, res) => {
    const disconnect = new AbortController();
    const closed = () => disconnect.abort(new Error('Event client disconnected'));
    res.once('close', closed);
    try {
      const expected = Buffer.from(`Bearer ${token}`),
        actual = Buffer.from(req.headers.authorization ?? '');
      if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
        res.writeHead(401).end();
        return;
      }
      if (req.method !== 'POST') {
        res.writeHead(405).end();
        return;
      }
      if (!controlPaths.some((route) => route === req.url)) {
        res.writeHead(404).end();
        return;
      }
      const chunks: Buffer[] = [];
      let length = 0;
      for await (const chunk of req) {
        length += (chunk as Buffer).length;
        if (length > 1024 * 1024) {
          res.writeHead(413).end();
          return;
        }
        chunks.push(chunk as Buffer);
      }
      const body: unknown = JSON.parse(Buffer.concat(chunks).toString());
      let result: unknown;
      switch (req.url) {
        case '/discover': {
          const args = z
            .strictObject({
              query: z.string().default(''),
              offset: z.number().int().min(0).default(0),
              limit: z.number().int().min(1).max(100).default(20),
            })
            .parse(body);
          result = await controller.discover(args.query, args.offset, args.limit);
          break;
        }
        case '/capability': {
          const args = z.strictObject({ id: Digest }).parse(body);
          result = await controller.capability(args.id);
          break;
        }
        case '/resolve':
          result = await controller.resolve(body);
          break;
        case '/resolution': {
          const args = z
            .strictObject({
              id: Digest,
              area: z.enum(['source', 'logs']).optional(),
              file: RelativePath.optional(),
            })
            .parse(body);
          result = args.area
            ? await readEvidence(controller, {
                kind: 'resolution',
                id: args.id,
                area: args.area,
                file: args.file,
              })
            : controller.resolution(args.id);
          break;
        }
        case '/input': {
          const args = z.strictObject({ task: Id, file: RelativePath.optional() }).parse(body);
          result = await readEvidence(controller, {
            kind: 'task',
            id: args.task,
            area: 'input',
            file: args.file,
          });
          break;
        }
        case '/probe':
          result = await controller.probe(body);
          break;
        case '/probe-evidence': {
          const args = z
            .strictObject({
              probe: Digest,
              area: z.enum(['source', 'suite', 'build', 'artifact', 'logs', 'observations']),
              file: RelativePath.optional(),
            })
            .parse(body);
          result = await readEvidence(controller, {
            kind: 'probe',
            id: args.probe,
            area: args.area,
            file: args.file,
          });
          break;
        }
        case '/library': {
          const args = z.strictObject({ query: z.string().default('') }).parse(body);
          result = await controller.library(args.query);
          break;
        }
        case '/asset': {
          const args = z.strictObject({ archive: Digest, file: RelativePath.optional() }).parse(body);
          result = await readEvidence(controller, {
            kind: 'asset',
            id: args.archive,
            area: 'source',
            file: args.file,
          });
          break;
        }
        case '/materialize':
          result = await materializeEvidence(controller, body);
          break;
        case '/import': {
          const args = z.strictObject({ archive: Digest, draft: Id }).parse(body);
          await controller.importAsset(args.archive, args.draft);
          result = {
            path: `/workspace/${args.draft}`,
            origin: draftOrigin(controller.store, args.draft),
          };
          break;
        }
        case '/events': {
          const args = z
            .strictObject({
              cursor: OptimizerCursor,
              timeoutMs: z.number().int().min(0).max(30_000).default(30_000),
              limit: z.number().int().min(1).max(100).default(100),
            })
            .parse(body);
          result = await access.wait(args.cursor, {
            ...args,
            signal: AbortSignal.any([disconnect.signal, ...(signal ? [signal] : [])]),
          });
          break;
        }
        case '/finish': {
          const args = z.strictObject({ reason: z.string().min(1) }).parse(body);
          controller.finish(args.reason);
          result = access.status();
          break;
        }
        case '/candidate': {
          const args = z
            .strictObject({
              candidate: Digest,
              area: z.enum(['source', 'build', 'artifact', 'qa']),
              file: RelativePath.optional(),
            })
            .parse(body);
          result = await readEvidence(controller, {
            kind: 'candidate',
            id: args.candidate,
            area: args.area,
            file: args.file,
          });
          break;
        }
        case '/status':
          result = access.status();
          break;
        case '/branch': {
          const args = z.strictObject({ parent: Digest, draft: Id }).parse(body);
          await controller.draft(args.parent, args.draft);
          result = { path: `/workspace/${args.draft}` };
          break;
        }
        case '/submit':
          result = access.submission(await controller.submit(body));
          break;
        case '/evidence': {
          const args = z
            .strictObject({
              run: Digest,
              area: z.enum(['input', 'delivery', 'trace']),
              file: RelativePath.optional(),
            })
            .parse(body);
          result = {
            run: args.run,
            area: args.area,
            artifact: await readEvidence(controller, {
              kind: 'run',
              id: args.run,
              area: args.area,
              file: args.file,
            }),
          };
          break;
        }
        default:
          res.writeHead(404).end();
          return;
      }
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(result));
    } catch (error) {
      if (res.destroyed) return;
      res
        .writeHead(400, { 'content-type': 'application/json' })
        .end(JSON.stringify({ error: String(error) }));
    } finally {
      res.removeListener('close', closed);
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, resolve);
  });
  return server;
}
