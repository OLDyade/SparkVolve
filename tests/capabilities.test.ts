import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createServer } from 'node:http';
import { prepareCapabilities, readCapabilities, searchCapabilities } from '../src/capabilities.js';
import { catalogRoot, queueResolution, resolutions } from '../src/capability-resolution.js';
import { libraryFixture } from './library-fixture.js';
import { Store } from '../src/store.js';
import { specification, candidate } from './fixtures.js';

test('research capabilities cannot bypass the seed-only experiment feedback boundary', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sv-capability-protocol-'));
  const fixture = await libraryFixture(path.join(root, 'archives'));
  const catalog = await prepareCapabilities(
    {
      indexes: [],
      official: false,
      local: [],
      archives: ['archives/' + fixture.archiveId],
      registry: 'https://registry.npmjs.org',
      timeoutSeconds: 10,
    },
    root,
    path.join(root, 'catalog'),
  );
  const spec = specification();
  spec.capabilities = { directory: 'catalog', digest: catalog.digest, resolutionLimit: 1 };
  assert.equal((await catalogRoot(root, spec)).snapshot.entries[0]!.origin, 'research');
  spec.hostSearchProtocol = { ancestry: 'seed-only', feedback: 'mechanical' };
  await assert.rejects(catalogRoot(root, spec), /Seed-only protocol forbids/);
});

test('native catalogs preserve exact versions, source provenance and incompatibility without popularity ranking', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sv-capabilities-'));
  const local = path.join(root, 'local');
  await mkdir(local);
  await writeFile(
    path.join(local, 'package.json'),
    JSON.stringify({
      name: 'local-capability',
      version: '1.0.0',
      dsh: { bundle: { patch: ['./a.yml', './b.yml'] } },
    }),
  );
  await writeFile(path.join(local, 'a.yml'), '[]');
  await writeFile(path.join(local, 'b.yml'), '[]');
  const server = createServer((_req, res) =>
    res.end(
      JSON.stringify({
        format: 1,
        title: 'Test market',
        plugins: [
          {
            name: 'remote-capability',
            description: 'Spreadsheet evidence',
            versions: [
              { version: '2.0.0', publishTimestamp: 2, source: { type: 'npm' }, engines: { dsh: '>=9' } },
              {
                version: '1.0.0',
                publishTimestamp: 1,
                source: {
                  type: 'git',
                  url: 'https://github.com/example/plugin',
                  commit: 'a'.repeat(40),
                  path: 'bundle',
                },
              },
            ],
          },
        ],
      }),
    ),
  );
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address() as { port: number };
    const result = await prepareCapabilities(
      {
        official: false,
        indexes: ['http://127.0.0.1:' + address.port],
        local: ['local'],
        archives: [],
        registry: 'https://registry.npmjs.org',
        timeoutSeconds: 10,
      },
      root,
      path.join(root, 'catalog'),
    );
    const snapshot = await readCapabilities(result.directory, result.digest);
    assert.equal(snapshot.entries.length, 3);
    const found = searchCapabilities(snapshot, 'spreadsheet', 0, 1);
    assert.equal(found.total, 2);
    assert.equal(found.nextOffset, 1);
    assert.ok(found.entries[0]!.compatibility);
    assert.match(JSON.stringify(snapshot.entries[1]!.source), /aaaaaaaa/);
    const spec = specification();
    spec.capabilities = { directory: 'catalog', digest: result.digest, resolutionLimit: 1 };
    const store = new Store(':memory:', spec);
    try {
      const parent = candidate();
      store.addCandidate(parent);
      const localEntry = snapshot.entries.find((e) => e.origin === 'local')!;
      const request = {
        parent: parent.digest,
        draft: 'composed',
        capabilities: [localEntry.id],
        rationale: 'Test resolved source',
      };
      const simultaneous = await Promise.all([
        queueResolution(root, root, spec, store, request),
        queueResolution(root, root, spec, store, request),
      ]);
      assert.equal(simultaneous[0]!.id, simultaneous[1]!.id);
      const record = simultaneous[0]!;
      assert.equal((await queueResolution(root, root, spec, store, request)).id, record.id);
      assert.equal(resolutions(store).length, 1);
      await assert.rejects(
        queueResolution(root, root, spec, store, { ...request, capabilities: [found.entries[0]!.id] }),
        /Incompatible/,
      );
      await assert.rejects(
        queueResolution(root, root, spec, store, { ...request, draft: 'duplicate' }),
        /already requested/,
      );
      const pending = queueResolution(root, root, spec, store, {
        ...request,
        draft: 'closing',
        capabilities: [snapshot.entries[1]!.id],
      });
      store.setMeta('searchConclusion', JSON.stringify({ reason: 'Closed during catalog read' }));
      await assert.rejects(pending, /requires an open search/);
      await writeFile(path.join(result.directory, 'unexpected.txt'), 'changed');
      await assert.rejects(readCapabilities(result.directory, result.digest), /snapshot changed/);
    } finally {
      store.close();
    }
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
