import { spawn } from 'node:child_process';
import { open, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { Isolation, type IsolationSpec } from './contracts.js';
import { atomicJSON } from './artifacts.js';
import { networkArgs, type NetworkSpec } from './network.js';
import {
  containerIdentity,
  isolationReceipt,
  isolationObservation,
  temporaryFilesystems,
  verifyIsolation,
  type InspectedContainer,
} from './isolation.js';

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
        reject(
          new Error(
            `${program} failed (${code ?? signal}): ${Buffer.concat(stdout).toString()}\n${Buffer.concat(stderr).toString()}`,
          ),
        );
      else resolve(Buffer.concat(stdout).toString().trim());
    });
  });
}
export interface ContainerSpec {
  name: string;
  image: string;
  command: string[];
  mounts: Array<{ source: string; target: string; writable: boolean }>;
  network: NetworkSpec;
  env: Record<string, string>;
  timeoutSeconds: number;
  isolation: IsolationSpec;
}
export interface ContainerState {
  Status: string;
  Running: boolean;
  ExitCode: number;
  StartedAt: string;
  FinishedAt: string;
}
export interface ContainerReference {
  name: string;
  id: string;
  intent: string;
}

/** Container lifecycle primitives; controlled executions reclaim only after durable terminal evidence. */
export class Docker {
  async host(runtime: string): Promise<unknown> {
    const info = JSON.parse(await command('docker', ['info', '--format', '{{json .}}'])) as {
      ID: string;
      ServerVersion: string;
      KernelVersion: string;
      OSType: string;
      Architecture: string;
      OperatingSystem: string;
      SecurityOptions: string[];
      Runtimes: Record<string, unknown>;
    };
    if (info.OSType !== 'linux' || !Object.hasOwn(info.Runtimes, runtime))
      throw new Error(`Required Linux Docker runtime is unavailable: ${runtime}`);
    return {
      daemonId: info.ID,
      version: info.ServerVersion,
      kernel: info.KernelVersion,
      architecture: info.Architecture,
      operatingSystem: info.OperatingSystem,
      securityOptions: info.SecurityOptions,
      runtime,
      registration: info.Runtimes[runtime],
    };
  }
  async configuration(name: string): Promise<InspectedContainer> {
    const [actual] = JSON.parse(await command('docker', ['inspect', name])) as InspectedContainer[];
    if (!actual) throw new Error(`Container missing: ${name}`);
    return actual;
  }
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
    Isolation.parse(spec.isolation);
    await this.host(spec.isolation.runtime);
    const args = [
      'create',
      '--name',
      spec.name,
      '--label',
      'org.harness-evolution.managed=true',
      '--label',
      `org.harness-evolution.intent=${containerIdentity(spec)}`,
      '--runtime',
      spec.isolation.runtime,
      '--user',
      `${spec.isolation.user.uid}:${spec.isolation.user.gid}`,
      '--entrypoint=',
      '--init',
      '--read-only',
      '--cap-drop=ALL',
      '--security-opt=no-new-privileges',
      `--pids-limit=${spec.isolation.pids}`,
      `--memory=${spec.isolation.memoryMiB}m`,
      `--memory-swap=${spec.isolation.memoryMiB}m`,
      `--cpus=${spec.isolation.cpus}`,
      '--ipc=private',
      ...networkArgs(spec.network),
      '--workdir',
      '/workspace',
    ];
    for (const [target, options] of Object.entries(temporaryFilesystems(spec)))
      args.push('--tmpfs', `${target}:${options}`);
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
    verifyIsolation(spec, await this.configuration(spec.name));
  }
  async halt(spec: ContainerSpec): Promise<void> {
    const state = await this.inspect(spec.name);
    if (!state) return;
    const actual = await this.configuration(spec.name);
    if (actual.Config.Labels['org.harness-evolution.intent'] !== containerIdentity(spec))
      throw Error('Refusing to stop a container with a different execution identity');
    if (state.Running) await command('docker', ['stop', '--time=5', spec.name]);
  }
  async remove(reference: ContainerReference): Promise<void> {
    if (!(await this.inspect(reference.name))) return;
    const actual = await this.configuration(reference.name);
    if (
      actual.Id !== reference.id ||
      actual.Config.Labels['org.harness-evolution.intent'] !== reference.intent
    )
      throw Error('Refusing to remove a replacement container');
    if (actual.State.Running) throw Error('Refusing to remove an active execution');
    await command('docker', ['rm', reference.name]);
  }
  async failureEvidence(spec: ContainerSpec, logDir: string): Promise<ContainerReference | null> {
    if (!(await this.inspect(spec.name))) return null;
    await this.halt(spec);
    const actual = await this.configuration(spec.name);
    if (actual.State.Running) throw Error('Failure container termination is unconfirmed');
    const reference = { name: spec.name, id: actual.Id, intent: containerIdentity(spec) };
    await this.logs(spec.name, logDir);
    await atomicJSON(path.join(logDir, 'failure-observation.json'), {
      reference,
      state: await this.inspect(spec.name),
      observed: isolationObservation(actual),
      validation: 'failure observation, not an isolation acceptance',
    });
    return reference;
  }
  async collect(spec: ContainerSpec, logDir: string, signal?: AbortSignal): Promise<ContainerState> {
    signal?.throwIfAborted();
    let state = await this.inspect(spec.name);
    if (!state) throw new Error(`Execution intent has no container: ${spec.name}; no automatic task retry`);
    const host = await this.host(spec.isolation.runtime);
    await atomicJSON(
      path.join(logDir, 'isolation.json'),
      isolationReceipt(spec, await this.configuration(spec.name), host),
    );
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
    await this.logs(spec.name, logDir);
    const final = await this.inspect(spec.name);
    if (!final || final.Running) throw new Error('Container termination is unconfirmed');
    await atomicJSON(
      path.join(logDir, 'isolation-final.json'),
      isolationReceipt(spec, await this.configuration(spec.name), host),
    );
    return final;
  }
  private async logs(name: string, logDir: string): Promise<void> {
    await mkdir(logDir, { recursive: true });
    const out = await open(path.join(logDir, 'stdout.log'), 'w', 0o600);
    const err = await open(path.join(logDir, 'stderr.log'), 'w', 0o600);
    try {
      await new Promise<void>((resolve, reject) => {
        const proc = spawn('docker', ['logs', name], { stdio: ['ignore', out.fd, err.fd] });
        proc.on('error', reject);
        proc.on('close', (code) =>
          code === 0 ? resolve() : reject(new Error(`docker logs exited ${code}`)),
        );
      });
    } finally {
      await out.close();
      await err.close();
    }
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
