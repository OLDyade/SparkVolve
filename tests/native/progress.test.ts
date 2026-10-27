import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import path from 'node:path';
import os from 'node:os';
import { Store } from '../../dist/store.js';
import { command } from '../../dist/docker.js';
import { specification } from '../fixtures.js';

test(
  'CLI event observer replays pages, resumes an exact cursor and follows commits without owning the experiment',
  { timeout: 30_000 },
  async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'he-progress-'));
    const spec = specification();
    await writeFile(path.join(root, 'experiment.json'), JSON.stringify(spec));
    const store = new Store(path.join(root, 'experiment.sqlite'), spec);
    const args = [path.resolve('dist/cli.js'), 'events', '--root', root];
    try {
      const initial = store.cursor();
      const observer = new Store(path.join(root, 'experiment.sqlite'), spec, 'read');
      assert.throws(() => observer.event('forbidden', {}), /readonly/);
      assert.throws(() => observer.setMeta('spec', 'changed'), /readonly/);
      observer.close();
      assert.throws(() => new Store(path.join(root, 'missing.sqlite'), spec, 'read'), /unable to open/);
      store.transaction(() => {
        for (let n = 0; n < 205; n++) store.event('fixture', { n });
      });
      const output = await command(process.execPath, args);
      const records = output
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line));
      const fixture = records.filter((record) => record.event.type === 'fixture');
      assert.equal(fixture.length, 205);
      assert.deepEqual(
        fixture.map((record) => record.event.body.n),
        Array.from({ length: 205 }, (_, n) => n),
      );
      const cursorFile = path.join(root, 'cursor.json');
      await writeFile(cursorFile, JSON.stringify(fixture[199].cursor));
      const replay = (await command(process.execPath, [...args, '--cursor', cursorFile]))
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line));
      assert.deepEqual(
        replay.map((record) => record.event.body.n),
        [200, 201, 202, 203, 204],
      );
      await writeFile(cursorFile, JSON.stringify(store.cursor()));
      const child = spawn(process.execPath, [...args, '--cursor', cursorFile, '--follow'], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      const closed = once(child, 'close');
      const lines = createInterface({ input: child.stdout });
      let stderr = '';
      child.stderr.on('data', (data) => {
        stderr += String(data);
      });
      try {
        const next = once(lines, 'line');
        store.event('external.commit', { value: 42 });
        const [line] = await next;
        const event = JSON.parse(line);
        assert.equal(event.event.type, 'external.commit');
        assert.equal(event.event.body.value, 42);
        assert.deepEqual(event.cursor, store.cursor());
        child.kill('SIGTERM');
        assert.deepEqual(await closed, [0, null], stderr);
      } finally {
        child.kill('SIGKILL');
        await closed;
        lines.close();
      }
      assert.equal(store.db.prepare('SELECT * FROM lease').get(), undefined);
      assert.equal(store.candidates().length, 0);
      assert.equal(store.runs().length, 0);
      await writeFile(
        cursorFile,
        JSON.stringify({ ...initial, experimentId: '00000000-0000-4000-8000-000000000000' }),
      );
      await assert.rejects(
        command(process.execPath, [...args, '--cursor', cursorFile]),
        /another experiment/,
      );
    } finally {
      store.close();
    }
  },
);
