import test from 'node:test';
import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { mkdtemp, mkdir, writeFile, chmod, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { authorizedInventory, readAuthorizedFile, fileReaderCapabilities } from '../src/file-reader.js';

test('descriptor reader preserves binary bytes, executable metadata and rejects links and non-files', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'he-file-reader-'));
  await mkdir(path.join(root, 'nested'));
  const bytes = Buffer.from([0, 255, 128, 10, 0]);
  await writeFile(path.join(root, 'nested/data.bin'), bytes);
  await chmod(path.join(root, 'nested/data.bin'), 0o755);
  assert.equal((await fileReaderCapabilities()).descriptorRelative, true);
  assert.deepEqual(await readAuthorizedFile(root, 'nested/data.bin'), bytes);
  assert.equal((await authorizedInventory(root))[0]!.executable, true);
  await symlink('data.bin', path.join(root, 'nested/link'));
  await assert.rejects(readAuthorizedFile(root, 'nested/link'), { code: 'ELOOP' });
  await assert.rejects(authorizedInventory(root), { code: 'ELOOP' });
  await symlink('nested', path.join(root, 'linked-directory'));
  await assert.rejects(readAuthorizedFile(root, 'linked-directory/data.bin'));
  await assert.rejects(readAuthorizedFile(root, 'nested'), /regular file/);
  await assert.rejects(readAuthorizedFile(root, 'missing'), { code: 'ENOENT' });
  for (const relative of ['../private', '/etc/passwd', 'nested/../data.bin', 'nested\\data.bin'])
    await assert.rejects(readAuthorizedFile(root, relative), /Invalid relative/);
  const fifo = path.join(root, 'pipe');
  assert.equal(
    childProcess.spawnSync('python3', ['-I', '-S', '-c', 'import os,sys; os.mkfifo(sys.argv[1])', fifo])
      .status,
    0,
  );
  await assert.rejects(readAuthorizedFile(root, 'pipe'), /regular file/);
});

test('openat anchors the already opened parent across directory replacement and refuses a replaced leaf', async () => {
  // A Python audit hook schedules a real filesystem mutation immediately before
  // the production os.open call. It changes no flags, descriptors or read behavior.
  for (const attack of ['leaf', 'parent'] as const)
    for (const operation of ['read', 'inventory'] as const) {
      const root = await mkdtemp(path.join(os.tmpdir(), `he-reader-race-${attack}-${operation}-`));
      const allowed = path.join(root, 'allowed'),
        outside = path.join(root, 'outside');
      await mkdir(path.join(allowed, 'nested'), { recursive: true });
      await mkdir(outside);
      await writeFile(path.join(allowed, 'nested/victim.bin'), 'AUTHORIZED_FIXTURE');
      await writeFile(path.join(outside, 'victim.bin'), 'OUTSIDE_FIXTURE');
      const hook = `
import os,sys
attacked=False
def mutate(event,args):
    global attacked
    if event!='open' or args[0]!='victim.bin' or attacked: return
    attacked=True
    ${attack === 'leaf' ? `os.unlink(${JSON.stringify(path.join(allowed, 'nested/victim.bin'))})\n    os.symlink(${JSON.stringify(path.join(outside, 'victim.bin'))},${JSON.stringify(path.join(allowed, 'nested/victim.bin'))})` : `os.rename(${JSON.stringify(path.join(allowed, 'nested'))},${JSON.stringify(path.join(allowed, 'retained-directory'))})\n    os.symlink(${JSON.stringify(outside)},${JSON.stringify(path.join(allowed, 'nested'))})`}
sys.addaudithook(mutate)
`;
      const original = childProcess.spawn;
      childProcess.spawn = ((
        command: string,
        args: readonly string[],
        options: childProcess.SpawnOptions,
      ) => {
        assert.equal(command, 'python3');
        const injected = [...args!];
        assert.equal(injected[2], '-c');
        injected[3] = hook + injected[3];
        return original(command, injected, options);
      }) as unknown as typeof childProcess.spawn;
      syncBuiltinESMExports();
      try {
        const result =
          operation === 'read'
            ? readAuthorizedFile(allowed, 'nested/victim.bin')
            : authorizedInventory(allowed);
        if (attack === 'leaf') await assert.rejects(result, { code: 'ELOOP' });
        else if (operation === 'read')
          assert.equal(((await result) as Buffer).toString(), 'AUTHORIZED_FIXTURE');
        else {
          const { createHash } = await import('node:crypto');
          const entries = (await result) as Awaited<ReturnType<typeof authorizedInventory>>;
          assert.equal(entries[0]!.hash, createHash('sha256').update('AUTHORIZED_FIXTURE').digest('hex'));
        }
      } finally {
        childProcess.spawn = original;
        syncBuiltinESMExports();
      }
    }
});

test('missing Python fails explicitly before evidence processing', () => {
  const result = childProcess.spawnSync(
    process.execPath,
    [
      '--import',
      'tsx',
      '--input-type=module',
      '-e',
      "import {fileReaderCapabilities} from './src/file-reader.ts'; await fileReaderCapabilities();",
    ],
    {
      cwd: process.cwd(),
      env: { ...process.env, PATH: '' },
      encoding: 'utf8',
    },
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Python 3 POSIX evidence reader could not start/);
  assert.match(result.stderr, /ENOENT/);
});

test('descriptor inventories retain depth-first UTF-16 ordering used by frozen identities', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'he-reader-order-'));
  await mkdir(path.join(root, 'a'));
  for (const file of ['a/child', 'a.txt', '\u{10000}', '\uE000'])
    await writeFile(path.join(root, file), 'data');
  assert.deepEqual(
    (await authorizedInventory(root)).map((file) => file.path),
    ['a/child', 'a.txt', '\u{10000}', '\uE000'],
  );
});
