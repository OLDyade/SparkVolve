import { spawn } from 'node:child_process';
import { open, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';

export async function command(
  program: string,
  args: string[],
  options: { env?: NodeJS.ProcessEnv; timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<string> {
  return await new Promise((resolve, reject) => {
    const child = spawn(program, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: options.env,
      ...(options.signal ? { signal: options.signal } : {}),
    });
    const stdout: Buffer[] = [],
      stderr: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
    }, options.timeoutMs ?? 60_000);
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      if (code !== 0)
        reject(new Error(`${program} failed (${code ?? signal}): ${Buffer.concat(stderr).toString()}`));
      else resolve(Buffer.concat(stdout).toString().trim());
    });
  });
}
export interface ContainerSpec {
  name: string;
  image: string;
  command: string[];
  mounts: Array<{ source: string; target: string; writable: boolean }>;
  network: 'bridge' | 'none';
  env: Record<string, string>;
  timeoutSeconds: number;
}
interface ContainerState {
  Status: string;
  Running: boolean;
  ExitCode: number;
  StartedAt: string;
  FinishedAt: string;
}

/** Containers remain after completion so recovery can distinguish absent, created, running and exited. */
export class Docker {
  async inspect(name: string): Promise<ContainerState | undefined> {
    const ids = (await command('docker', ['ps', '-aq', '--filter', `name=^/${name}$`]))
      .split('\n')
      .filter(Boolean);
    if (ids.length === 0) return undefined;
    if (ids.length !== 1) throw new Error(`Ambiguous container ${name}`);
    return JSON.parse(
      await command('docker', ['inspect', '--format', '{{json .State}}', name]),
    ) as ContainerState;
  }
  async create(spec: ContainerSpec): Promise<void> {
    const args = [
      'create',
      '--name',
      spec.name,
      '--label',
      'org.harness-evolution.managed=true',
      '--init',
      '--read-only',
      '--cap-drop=ALL',
      '--security-opt=no-new-privileges',
      '--pids-limit=256',
      '--memory=4g',
      '--cpus=2',
      '--network',
      spec.network,
      // DSH's native loader maps shared objects from its temporary cache.
      '--tmpfs',
      '/tmp:rw,exec,nosuid,nodev,size=512m',
      '--tmpfs',
      '/home/node:rw,nosuid,nodev,size=128m',
      '--workdir',
      '/workspace',
    ];
    if (spec.network === 'bridge') args.push('--add-host', 'host.docker.internal:host-gateway');
    for (const mount of spec.mounts) {
      if (mount.source.includes(',') || mount.target.includes(','))
        throw new Error('Docker mount paths cannot contain commas');
      args.push(
        '--mount',
        `type=bind,src=${path.resolve(mount.source)},dst=${mount.target}${mount.writable ? '' : ',readonly'}`,
      );
    }
    // Only environment variable names reach argv; secret values travel via the child environment.
    for (const name of Object.keys(spec.env)) args.push('--env', name);
    args.push(spec.image, ...spec.command);
    await command('docker', args, { env: { ...process.env, ...spec.env } });
  }
  async collect(spec: ContainerSpec, logDir: string, signal?: AbortSignal): Promise<ContainerState> {
    signal?.throwIfAborted();
    let state = await this.inspect(spec.name);
    if (!state) throw new Error(`Execution intent has no container: ${spec.name}; no automatic task retry`);
    if (state.Status === 'created') {
      await command('docker', ['start', spec.name]);
      state = await this.inspect(spec.name);
    }
    if (!state) throw new Error('Container disappeared after start');
    if (state.Running) {
      const remaining = spec.timeoutSeconds * 1000 - (Date.now() - Date.parse(state.StartedAt));
      if (remaining <= 0) await command('docker', ['kill', spec.name]);
      else {
        let timer: ReturnType<typeof setTimeout>;
        const deadline = new Promise<void>((resolve, reject) => {
          timer = setTimeout(() => {
            void command('docker', ['kill', spec.name]).then(() => resolve(), reject);
          }, remaining);
        });
        try {
          await Promise.race([
            command('docker', ['wait', spec.name], {
              timeoutMs: remaining + 30_000,
              ...(signal ? { signal } : {}),
            }),
            deadline,
          ]);
        } finally {
          clearTimeout(timer!);
        }
      }
    }
    await mkdir(logDir, { recursive: true });
    const out = await open(path.join(logDir, 'stdout.log'), 'w', 0o600);
    const err = await open(path.join(logDir, 'stderr.log'), 'w', 0o600);
    try {
      await new Promise<void>((resolve, reject) => {
        const proc = spawn('docker', ['logs', spec.name], { stdio: ['ignore', out.fd, err.fd] });
        proc.on('error', reject);
        proc.on('close', (code) =>
          code === 0 ? resolve() : reject(new Error(`docker logs exited ${code}`)),
        );
      });
    } finally {
      await out.close();
      await err.close();
    }
    const final = await this.inspect(spec.name);
    if (!final || final.Running) throw new Error('Container termination is unconfirmed');
    return final;
  }
  async run(spec: ContainerSpec, logDir: string, signal?: AbortSignal): Promise<ContainerState> {
    signal?.throwIfAborted();
    if (!(await this.inspect(spec.name))) await this.create(spec);
    return await this.collect(spec, logDir, signal);
  }
}

export async function readJSON(file: string): Promise<unknown> {
  return JSON.parse(await readFile(file, 'utf8')) as unknown;
}
