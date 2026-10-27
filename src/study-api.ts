import { createServer, type Server } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { StudyBranchReceipt, studyRequests, studyPaths, type StudyControl } from './study-control.js';

/** Host-owned development capability. Final validation has no route on this server. */
export async function serveStudy(
  control: StudyControl,
  token: string,
  port: number,
  host: string,
  signal: AbortSignal,
): Promise<Server> {
  signal.throwIfAborted();
  if (token.length < 32) throw new Error('Study capability must have at least 32 characters');
  const expected = Buffer.from(`Bearer ${token}`);
  const server = createServer(async (req, res) => {
    const disconnected = new AbortController();
    const closed = () => disconnected.abort(new Error('Study observer disconnected'));
    res.once('close', closed);
    try {
      const actual = Buffer.from(req.headers.authorization ?? '');
      if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
        res.writeHead(401).end();
        return;
      }
      signal.throwIfAborted();
      if (req.method !== 'POST') {
        res.writeHead(405).end();
        return;
      }
      if (!studyPaths.some((route) => route === req.url)) {
        res.writeHead(404).end();
        return;
      }
      const chunks: Buffer[] = [];
      let bytes = 0;
      for await (const chunk of req) {
        bytes += (chunk as Buffer).length;
        if (bytes > 1024 * 1024) {
          res.writeHead(413).end();
          return;
        }
        chunks.push(chunk as Buffer);
      }
      const body: unknown = JSON.parse(Buffer.concat(chunks).toString());
      signal.throwIfAborted();
      let result: unknown;
      switch (req.url) {
        case '/study/status':
          studyRequests['/study/status'].parse(body);
          result = control.status();
          break;
        case '/study/branch': {
          const args = studyRequests['/study/branch'].parse(body);
          result = StudyBranchReceipt.parse(await control.branch(args.parent, args.draft));
          break;
        }
        case '/study/submit':
          result = await control.submit(studyRequests['/study/submit'].parse(body));
          break;
        case '/study/events':
          result = await control.events(
            studyRequests['/study/events'].parse(body),
            AbortSignal.any([signal, disconnected.signal]),
          );
          break;
        case '/study/finish':
          result = await control.finish(studyRequests['/study/finish'].parse(body).reason);
          break;
        case '/study/search':
          result = await control.search(studyRequests['/study/search'].parse(body).jobID);
          break;
        case '/study/evidence':
          result = await control.evidence(studyRequests['/study/evidence'].parse(body));
          break;
        case '/study/materialize': {
          const reference = studyRequests['/study/materialize'].parse(body);
          if (!(reference.kind === 'search' ? reference.reference.file : reference.file))
            throw new Error('Materialization requires an explicit file');
          result = await control.materialize(reference);
          break;
        }
        default:
          throw new Error('Unknown study capability');
      }
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(result));
    } catch (error) {
      if (!res.destroyed)
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
