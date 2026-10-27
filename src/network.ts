import { isIP } from 'node:net';
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';

const name = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/);
const ip = z.string().refine((value) => isIP(value) !== 0, 'Expected a literal IP');
export const AttachedNetwork = z
  .strictObject({
    interfaces: z
      .array(
        z.strictObject({
          name,
          ipv4: z
            .string()
            .refine((value) => isIP(value) === 4)
            .nullable(),
          gatewayPriority: z.number().int().nonnegative(),
        }),
      )
      .min(1),
    dns: z.array(ip),
    hosts: z.array(z.strictObject({ name, address: ip })),
  })
  .superRefine((value, ctx) => {
    if (
      new Set(value.interfaces.map((item) => item.name)).size !== value.interfaces.length ||
      new Set(value.hosts.map((item) => item.name)).size !== value.hosts.length
    )
      ctx.addIssue({ code: 'custom', message: 'Duplicate network or host binding' });
  });
export type NetworkSpec = 'bridge' | 'none' | z.infer<typeof AttachedNetwork>;
export interface NetworkInspection {
  State: { Running: boolean };
  HostConfig: { NetworkMode: string; Dns: string[] | null; ExtraHosts: string[] | null };
  NetworkSettings: {
    Networks: Record<
      string,
      {
        IPAMConfig: { IPv4Address?: string } | null;
        IPAddress: string;
        NetworkID: string;
        GwPriority: number;
      }
    >;
  };
}

export function networkArgs(network: NetworkSpec): string[] {
  if (typeof network === 'string')
    return [
      '--network',
      network,
      ...(network === 'bridge' ? ['--add-host', 'host.docker.internal:host-gateway'] : []),
    ];
  AttachedNetwork.parse(network);
  return [
    ...network.interfaces.flatMap((item) => [
      '--network',
      `name=${item.name},gw-priority=${item.gatewayPriority}${item.ipv4 ? `,ip=${item.ipv4}` : ''}`,
    ]),
    ...network.dns.flatMap((value) => ['--dns', value]),
    ...network.hosts.flatMap((item) => ['--add-host', `${item.name}:${item.address}`]),
  ];
}
export function verifyNetwork(network: NetworkSpec, actual: NetworkInspection): void {
  const interfaces =
    typeof network === 'string' ? [{ name: network, ipv4: null, gatewayPriority: 0 }] : network.interfaces;
  const hosts =
    typeof network === 'string'
      ? network === 'bridge'
        ? ['host.docker.internal:host-gateway']
        : []
      : network.hosts.map((item) => `${item.name}:${item.address}`);
  const check = (ok: boolean, field: string) => {
    if (!ok) throw Error(`Container network mismatch: ${field}`);
  };
  check(actual.HostConfig.NetworkMode === interfaces[0]!.name, 'primary interface');
  check(
    isDeepStrictEqual(actual.HostConfig.Dns ?? [], typeof network === 'string' ? [] : network.dns),
    'DNS',
  );
  check(isDeepStrictEqual(actual.HostConfig.ExtraHosts ?? [], hosts), 'host bindings');
  check(
    isDeepStrictEqual(
      Object.keys(actual.NetworkSettings.Networks).sort(),
      interfaces.map((item) => item.name).sort(),
    ),
    'attached interfaces',
  );
  for (const entry of interfaces) {
    const observed = actual.NetworkSettings.Networks[entry.name]!;
    check(observed.GwPriority === entry.gatewayPriority, 'gateway priority');
    check((observed.IPAMConfig?.IPv4Address ?? null) === entry.ipv4, 'requested address');
    if (entry.ipv4 && actual.State.Running) check(observed.IPAddress === entry.ipv4, 'active address');
  }
}
