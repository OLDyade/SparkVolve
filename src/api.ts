import { createServer } from 'node:http';
import type { Server } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { Controller } from './controller.js';
import { Digest, Id, RelativePath } from './contracts.js';
import { confined, inventory } from './artifacts.js';
import { EventCursor } from './events.js';
import { draftOrigin } from './library.js';

export async function serve(
  controller: Controller,
  token: string,
  port: number,
  host: string,
  signal?: AbortSignal,
): Promise<Server> {
  if (controller.spec.purpose !== 'search') throw new Error('Validation experiments have no optimizer API');
  if (token.length < 32) throw new Error('Controller capability must have at least 32 characters');
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
          const probe = controller.store.probes().find((probe) => probe.id === args.probe);
          if (!probe) throw new Error('Unknown probe');
          const areas = {
            source: `candidates/${probe.sourceDigest}`,
            suite: 'suite',
            build: `builds/${probe.sourceDigest}/logs`,
            artifact: `artifacts/${probe.sourceDigest}`,
            logs: 'logs',
            observations: 'work',
          };
          result = await artifact(
            path.join(controller.root, 'probes', args.probe, areas[args.area]),
            args.file,
          );
          break;
        }
        case '/library': {
          const args = z.strictObject({ query: z.string().default('') }).parse(body);
          result = await controller.library(args.query);
          break;
        }
        case '/asset': {
          const args = z.strictObject({ archive: Digest, file: RelativePath.optional() }).parse(body);
          result = await controller.asset(args.archive, args.file);
          break;
        }
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
              cursor: EventCursor,
              timeoutMs: z.number().int().min(0).max(30_000).default(30_000),
              limit: z.number().int().min(1).max(100).default(100),
            })
            .parse(body);
          result = await controller.store.wait(args.cursor, {
            ...args,
            signal: AbortSignal.any([disconnect.signal, ...(signal ? [signal] : [])]),
          });
          break;
        }
        case '/finish': {
          const args = z.strictObject({ reason: z.string().min(1) }).parse(body);
          controller.finish(args.reason);
          result = controller.status();
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
          controller.store.candidate(args.candidate);
          const root = path.join(
            controller.root,
            { source: 'candidates', build: 'builds', artifact: 'artifacts', qa: 'qa' }[args.area],
            args.candidate,
            ...(args.area === 'build' ? ['logs'] : []),
          );
          result = await artifact(root, args.file);
          break;
        }
        case '/status':
          result = controller.status();
          break;
        case '/branch': {
          const args = z.strictObject({ parent: Digest, draft: Id }).parse(body);
          await controller.draft(args.parent, args.draft);
          result = { path: `/workspace/${args.draft}` };
          break;
        }
        case '/submit':
          result = await controller.submit(body);
          break;
        case '/evidence': {
          const args = z
            .strictObject({
              run: Digest,
              area: z.enum(['input', 'delivery', 'trace']),
              file: RelativePath.optional(),
            })
            .parse(body);
          const run = controller.store.runs().find((r) => r.id === args.run);
          if (!run) throw new Error('Unknown run');
          const task = controller.spec.tasks.find((t) => t.id === run.task)!;
          const root =
            args.area === 'input'
              ? confined(controller.dataset, task.input)
              : path.join(controller.root, 'runs', run.id, args.area);
          result = {
            run: run.id,
            area: args.area,
            artifact: await artifact(root, args.file),
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

async function artifact(root: string, file?: string): Promise<unknown> {
  if (file === undefined) return await inventory(root);
  const resolved = await realpath(confined(root, file));
  if (!resolved.startsWith(`${await realpath(root)}${path.sep}`))
    throw new Error('Artifact escapes authorized area');
  return { file, encoding: 'base64', data: (await readFile(resolved)).toString('base64') };
}
