import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { digest } from './artifacts.js';
import type { ContainerSpec } from './docker.js';
import { runtimeEnvironment } from './runtime-environment.js';
import { verifyNetwork, type NetworkInspection } from './network.js';

/** The label binds a durable intent. Actual Docker settings are checked separately. */
export function containerIdentity(spec: ContainerSpec): string {
  return digest({
    image: spec.image,
    command: spec.command,
    mounts: spec.mounts.map((mount) => ({ ...mount, source: path.resolve(mount.source) })),
    isolation: spec.isolation,
    network: spec.network,
    timeoutSeconds: spec.timeoutSeconds,
    runtimeEnvironment,
  });
}

export function temporaryFilesystems(spec: ContainerSpec): Record<string, string> {
  const { uid, gid } = spec.isolation.user;
  return {
    '/tmp': `rw,exec,nosuid,nodev,size=${spec.isolation.tmpMiB}m,uid=${uid},gid=${gid},mode=1777`,
    [runtimeEnvironment.HOME]: `rw,nosuid,nodev,size=${spec.isolation.homeMiB}m,uid=${uid},gid=${gid},mode=700`,
  };
}

export interface InspectedContainer extends NetworkInspection {
  Id: string;
  Image: string;
  Config: {
    Image: string;
    Cmd: string[];
    Entrypoint: string[] | null;
    User: string;
    WorkingDir: string;
    Labels: Record<string, string>;
    Volumes: Record<string, unknown> | null;
    Env: string[];
  };
  HostConfig: {
    Runtime: string;
    Privileged: boolean;
    ReadonlyRootfs: boolean;
    CapDrop: string[];
    CapAdd: string[] | null;
    SecurityOpt: string[];
    Init: boolean;
    Memory: number;
    MemorySwap: number;
    NanoCpus: number;
    PidsLimit: number;
    NetworkMode: string;
    Dns: string[] | null;
    ExtraHosts: string[] | null;
    PidMode: string;
    IpcMode: string;
    Devices: unknown[];
    DeviceRequests: unknown[] | null;
    Tmpfs: Record<string, string>;
  };
  Mounts: Array<{ Type: string; Source: string; Destination: string; RW: boolean; Propagation?: string }>;
}

export function verifyIsolation(spec: ContainerSpec, actual: InspectedContainer): void {
  const check = (condition: boolean, field: string) => {
    if (!condition) throw new Error(`Container isolation mismatch: ${field} (${spec.name})`);
  };
  const { Config: config, HostConfig: host } = actual;
  check(config.Labels['org.harness-evolution.intent'] === containerIdentity(spec), 'intent');
  check(config.Image === spec.image && isDeepStrictEqual(config.Cmd, spec.command), 'image/command');
  check(!config.Entrypoint?.length, 'entrypoint');
  check(config.User === `${spec.isolation.user.uid}:${spec.isolation.user.gid}`, 'user');
  check(config.WorkingDir === '/workspace', 'workdir');
  for (const [key, value] of Object.entries(runtimeEnvironment))
    check(
      config.Env.filter((entry) => entry.startsWith(`${key}=`)).length === 1 &&
        config.Env.includes(`${key}=${value}`),
      `runtime environment ${key}`,
    );
  check(!Object.keys(config.Volumes ?? {}).length, 'image volumes');
  check(host.Runtime === spec.isolation.runtime, 'runtime');
  check(!host.Privileged && host.ReadonlyRootfs && host.Init, 'privileges/rootfs/init');
  check(!host.CapAdd?.length && isDeepStrictEqual(host.CapDrop, ['ALL']), 'capabilities');
  check(isDeepStrictEqual(host.SecurityOpt, ['no-new-privileges']), 'security options');
  check(
    host.Memory === spec.isolation.memoryMiB * 1024 ** 2 && host.MemorySwap === host.Memory,
    'memory/swap',
  );
  check(host.NanoCpus === Math.round(spec.isolation.cpus * 1e9), 'cpu');
  check(host.PidsLimit === spec.isolation.pids, 'pids');
  check(host.PidMode === '' && host.IpcMode === 'private', 'namespaces');
  verifyNetwork(spec.network, actual);
  check(!host.Devices.length && !host.DeviceRequests?.length, 'devices');
  check(isDeepStrictEqual(host.Tmpfs, temporaryFilesystems(spec)), 'tmpfs');
  const bind = actual.Mounts.filter((mount) => mount.Type === 'bind');
  check(
    actual.Mounts.every(
      (mount) =>
        mount.Type === 'bind' || (mount.Type === 'tmpfs' && mount.Destination in temporaryFilesystems(spec)),
    ),
    'mount types',
  );
  check(
    bind.length === spec.mounts.length &&
      spec.mounts.every((mount) =>
        bind.some(
          (observed) =>
            observed.Source === path.resolve(mount.source) &&
            observed.Destination === mount.target &&
            observed.RW === mount.writable &&
            observed.Propagation === 'rprivate',
        ),
      ),
    'bind mounts',
  );
}

/** Whitelist fields; never serialize Docker Config.Env, which contains model credentials. */
export function isolationReceipt(spec: ContainerSpec, actual: InspectedContainer, host: unknown) {
  verifyIsolation(spec, actual);
  return {
    observedAt: new Date().toISOString(),
    intent: containerIdentity(spec),
    containerId: actual.Id,
    imageId: actual.Image,
    declared: spec.isolation,
    network: spec.network,
    host,
    observed: isolationObservation(actual),
    boundary:
      'Docker daemon attestation of configuration; not cryptographic runtime attestation or escape-proof isolation.',
  };
}
/** Raw, credential-free observation; callers must not present this alone as a passed attestation. */
export function isolationObservation(actual: InspectedContainer) {
  return {
    user: actual.Config.User,
    settings: Object.fromEntries(
      [
        'Runtime',
        'Privileged',
        'ReadonlyRootfs',
        'CapDrop',
        'CapAdd',
        'SecurityOpt',
        'Init',
        'Memory',
        'MemorySwap',
        'NanoCpus',
        'PidsLimit',
        'NetworkMode',
        'Dns',
        'ExtraHosts',
        'PidMode',
        'IpcMode',
        'Devices',
        'DeviceRequests',
        'Tmpfs',
      ].map((key) => [key, actual.HostConfig[key as keyof InspectedContainer['HostConfig']]]),
    ),
    mounts: actual.Mounts.map(({ Type, Source, Destination, RW, Propagation }) => ({
      Type,
      Source,
      Destination,
      RW,
      Propagation,
    })),
    interfaces: actual.NetworkSettings.Networks,
  };
}
