import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';

// Which addresses the server may fetch on a user's behalf. A hosted server
// must not be usable to reach its own network (cloud metadata, databases,
// admin ports): snapshot URLs, and every redirect they take, must resolve to
// public addresses. A local server may archive anything its user can reach.

const blocked = new BlockList();
for (const [net, bits] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12],
  ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24],
  ['224.0.0.0', 4], ['240.0.0.0', 4],
] as const) blocked.addSubnet(net, bits, 'ipv4');
for (const [net, bits] of [
  ['::', 128], ['::1', 128], ['64:ff9b::', 96], ['64:ff9b:1::', 48], ['100::', 64], ['2001:db8::', 32], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8],
] as const) blocked.addSubnet(net, bits, 'ipv6');

/** True for addresses on the public internet. */
export function isPublicAddress(ip: string): boolean {
  const v = isIP(ip);
  if (!v) return false;
  // IPv4-mapped IPv6 (::ffff:10.0.0.1) is judged as the IPv4 address.
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  if (mapped) return !blocked.check(mapped[1], 'ipv4');
  return !blocked.check(ip, v === 4 ? 'ipv4' : 'ipv6');
}

export class PrivateAddressError extends Error {}

/** Throw unless every address the URL's host resolves to is public. */
export async function assertPublicUrl(url: string, resolve: (host: string) => Promise<string[]> = async h => (await lookup(h, { all: true, verbatim: true })).map(a => a.address)): Promise<void> {
  const host = new URL(url).hostname.replace(/^\[|\]$/g, '');
  const addresses = isIP(host) ? [host] : await resolve(host).catch(() => { throw new PrivateAddressError(`${host} could not be resolved`); });
  if (!addresses.length || !addresses.every(isPublicAddress)) throw new PrivateAddressError(`${host} is not a public internet address; this server only archives public pages`);
}
