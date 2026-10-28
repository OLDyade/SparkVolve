import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { command } from '../src/command.js';

const leaf = `const fs=require('node:fs');
process.on('SIGTERM',()=>{});
fs.writeFileSync(process.argv[1],JSON.stringify({parent:process.ppid,leaf:process.pid}));
setInterval(()=>process.stdout.write('leaf\\n'),100);`;

function launcher(marker: string, exitParent: boolean) {
  return `const {spawn}=require('node:child_process');
const fs=require('node:fs');
spawn(process.execPath,['-e',${JSON.stringify(leaf)},${JSON.stringify(marker)}],{stdio:'inherit'});
const timer=setInterval(()=>{
 if(fs.existsSync(${JSON.stringify(marker)})){
  clearInterval(timer);
  process.stdout.write('parent ready\\n');
  ${exitParent ? 'process.exit(0);' : 'setInterval(()=>{},1000);'}
 }
},10);`;
}

async function ready(marker: string) {
  const deadline = Date.now() + 5_000;
  for (;;) {
    try {
      return JSON.parse(await readFile(marker, 'utf8')) as { parent: number; leaf: number };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      if (Date.now() >= deadline) throw new Error('Child did not become ready');
      await delay(10);
    }
  }
}

function running(pid: number) {
  if (process.platform === 'linux') {
    try {
      const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
      return stat.slice(stat.lastIndexOf(')') + 2).split(' ')[0] !== 'Z';
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw error;
    }
  }
  try {
    return !execFileSync('ps', ['-o', 'stat=', '-p', String(pid)], { encoding: 'utf8' })
      .trim()
      .startsWith('Z');
  } catch (error) {
    if ((error as { status?: number }).status === 1) return false;
    throw error;
  }
}

async function stopped(pids: number[]) {
  const deadline = Date.now() + 3_000;
  while (pids.some(running)) {
    if (Date.now() >= deadline) assert.fail(`Command processes still running: ${pids.join(', ')}`);
    await delay(10);
  }
}

test('command captures output, env and nonzero diagnostics; spawn failures retain their cause', async () => {
  assert.equal(
    await command(process.execPath, ['-e', 'console.log(process.env.COMMAND_TEST_VALUE)'], {
      env: { COMMAND_TEST_VALUE: 'exact-value' },
    }),
    'exact-value',
  );
  await assert.rejects(
    command(process.execPath, ['-e', 'console.log("out");console.error("err");process.exit(7)']),
    /failed \(7\): out\n\nerr/,
  );
  await assert.rejects(command('/__missing_harness_evolution_command__', []), { code: 'ENOENT' });
});

test('timeout kills nested processes holding inherited stdio without touching an unrelated group', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'he-command-timeout-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const unrelated = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], {
    detached: true,
    stdio: 'ignore',
  });
  t.after(async () => {
    const closed = new Promise<void>((resolve) => unrelated.once('close', () => resolve()));
    process.kill(-unrelated.pid!, 'SIGKILL');
    await closed;
  });
  const marker = path.join(root, 'ready.json');
  const result = command(
    process.execPath,
    ['-e', `console.error('dependency-progress');${launcher(marker, false)}`],
    { timeoutMs: 1_000 },
  );
  const rejected = assert.rejects(result, (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.match(error.message, /timed out after 1000 ms/);
    assert.match(error.message, /parent ready/);
    assert.match(error.message, /dependency-progress/);
    return true;
  });
  const pids = await ready(marker);
  await rejected;
  await stopped([pids.parent, pids.leaf]);
  assert.equal(running(unrelated.pid!), true);
});

test('abort kills the process group and preserves the caller cancellation reason', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'he-command-abort-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const marker = path.join(root, 'ready.json'),
    controller = new AbortController(),
    reason = new Error('caller cancelled this command');
  const result = command(process.execPath, ['-e', launcher(marker, false)], {
    signal: controller.signal,
    timeoutMs: 10_000,
  });
  const rejected = assert.rejects(result, (error) => error === reason);
  const pids = await ready(marker);
  controller.abort(reason);
  await rejected;
  await stopped([pids.parent, pids.leaf]);
});

test('leader exit releases inherited-pipe descendants instead of waiting until the command deadline', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'he-command-exit-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const marker = path.join(root, 'ready.json');
  const output = await command(process.execPath, ['-e', launcher(marker, true)], { timeoutMs: 5_000 });
  assert.match(output, /parent ready/);
  const pids = await ready(marker);
  await stopped([pids.parent, pids.leaf]);
});

test('pre-aborted commands never start and invalid deadlines fail before spawn', async () => {
  const reason = new Error('cancelled before launch');
  await assert.rejects(
    command('/__must_not_spawn__', [], { signal: AbortSignal.abort(reason) }),
    (error) => error === reason,
  );
  for (const timeoutMs of [0, -1, Infinity, NaN, 2_147_483_648])
    await assert.rejects(command('/__must_not_spawn__', [], { timeoutMs }), /timeoutMs/);
});
