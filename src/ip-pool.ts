import ipaddr from 'ipaddr.js';
import { z } from 'zod';

export function ipv4Range(cidr: string): { first: number; last: number; prefix: number } {
  const [address, prefix] = ipaddr.parseCIDR(cidr);
  if (address.kind() !== 'ipv4') throw Error('Expected an IPv4 subnet');
  const value = address.toByteArray().reduce((result, byte) => result * 256 + byte, 0);
  const size = 2 ** (32 - prefix),
    first = Math.floor(value / size) * size;
  return { first, last: first + size - 1, prefix };
}
export function ipv4(value: number): string {
  return [24, 16, 8, 0].map((shift) => Math.floor(value / 2 ** shift) % 256).join('.');
}
export const EgressPool = z.string().superRefine((value, ctx) => {
  try {
    const range = ipv4Range(value);
    if (
      range.prefix < 16 ||
      range.prefix > 29 ||
      value !== `${ipv4(range.first)}/${range.prefix}` ||
      ipaddr.parse(ipv4(range.first)).range() !== 'private'
    )
      throw Error('Invalid pool');
  } catch {
    ctx.addIssue({
      code: 'custom',
      message: 'Egress pool requires a canonical private IPv4 CIDR with prefix /16 through /29',
    });
  }
});
export function poolCapacity(pool: string): number {
  const range = ipv4Range(EgressPool.parse(pool));
  return (range.last - range.first + 1) / 8;
}
/** Exact CIDR interval subtraction; each lease is a /29 with enough room for worker + broker. */
export function availableSubnets(pool: string, occupied: string[]): string[] {
  const space = ipv4Range(EgressPool.parse(pool));
  const ranges = occupied.filter((cidr) => ipaddr.parseCIDR(cidr)[0].kind() === 'ipv4').map(ipv4Range);
  const available: string[] = [];
  for (let first = space.first; first <= space.last; first += 8)
    if (!ranges.some((range) => range.first <= first + 7 && range.last >= first))
      available.push(`${ipv4(first)}/29`);
  return available;
}
