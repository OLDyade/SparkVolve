import { createServer } from 'node:http';
import type { Server } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { Controller } from './controller.js';
import { Digest, Id, RelativePath } from './contracts.js';
import { confined, inventory } from './artifacts.js';

export async function serve(
  controller: Controller,
  token: string,
  port: number,
  host: string,
): Promise<Server> {
  if (controller.spec.purpose !== 'search') throw new Error('Validation experiments have no optimizer API');
  if (token.length < 32) throw new Error('Controller capability must have at least 32 characters');
  const server = createServer(async (req, res) => {
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
          if (args.file === undefined) {
            result = await inventory(root);
            break;
          }
          const resolved = await realpath(confined(root, args.file));
          if (!resolved.startsWith(`${await realpath(root)}${path.sep}`))
            throw new Error('Artifact escapes authorized area');
          const bytes = await readFile(resolved);
          result = {
            run: run.id,
            area: args.area,
            file: args.file,
            encoding: 'base64',
            data: bytes.toString('base64'),
          };
          break;
        }
        default:
          res.writeHead(404).end();
          return;
      }
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(result));
    } catch (error) {
      res
        .writeHead(400, { 'content-type': 'application/json' })
        .end(JSON.stringify({ error: String(error) }));
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, resolve);
  });
  return server;
}
