import { command } from './docker.js';
import { availableSubnets, poolCapacity } from './ip-pool.js';

export async function occupiedSubnets(): Promise<string[]> {
  const list = async () =>
    (await command('docker', ['network', 'ls', '--no-trunc', '--format', '{{.ID}}']))
      .split('\n')
      .filter(Boolean);
  for (let observation = 0; observation < 32; observation++) {
    const ids = await list();
    if (!ids.length) return [];
    try {
      const networks = JSON.parse(await command('docker', ['network', 'inspect', ...ids])) as Array<{
        IPAM: { Config: Array<{ Subnet?: string }> | null };
      }>;
      return networks.flatMap((network) =>
        (network.IPAM.Config ?? []).flatMap((config) => (config.Subnet ? [config.Subnet] : [])),
      );
    } catch (error) {
      // Cleanup can remove a listed network before inspect; only that observed race is resampled.
      const current = new Set(await list());
      if (ids.every((id) => current.has(id))) throw error;
    }
  }
  throw Error('Docker networks changed continuously during address-pool observation');
}
let allocation: Promise<unknown> = Promise.resolve();
/** Docker IPAM commits the lease atomically, including races with other controller processes. */
export async function allocateNetwork(
  pool: string,
  name: string,
  args: string[],
  persist: (subnet: string) => Promise<void>,
): Promise<void> {
  const operation = allocation.then(async () => {
    for (let attempt = 0; attempt < poolCapacity(pool); attempt++) {
      const subnet = availableSubnets(pool, await occupiedSubnets())[0];
      if (!subnet) throw Error(`Egress address pool exhausted: ${pool}`);
      await persist(subnet);
      try {
        await command('docker', ['network', 'create', '--subnet', subnet, ...args, name]);
        return;
      } catch (error) {
        const names = (await command('docker', ['network', 'ls', '--format', '{{.Name}}'])).split('\n');
        if (names.includes(name)) return; // Lost acknowledgement: caller verifies the original identity.
        // Retry only an observed IPAM collision before any task launch; all other errors propagate.
        if (
          !String(error).includes('Pool overlaps with other one on this address space') ||
          availableSubnets(subnet, await occupiedSubnets()).length
        )
          throw error;
      }
    }
    throw Error(`Egress pool allocation contention exhausted: ${pool}`);
  });
  allocation = operation.catch(() => {}); // Release the local mutex; the caller still receives the error.
  await operation;
}
