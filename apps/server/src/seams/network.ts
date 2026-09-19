import { ProxyAgent, fetch as undiciFetch } from 'undici';
import { socksDispatcher } from 'fetch-socks';

// Per-case network routes. A case can send everything it fetches (its
// browser tabs, and on the server its snapshots, watches and archive
// lookups) through a SOCKS5 or HTTP proxy: a VPN provider's proxy, a local
// Tor client, or a proxy of the researcher's own. SOCKS hostnames are
// resolved by the proxy, so DNS does not leak either.

export interface Route { url: string; kind: 'socks5' | 'http'; host: string; port: number }

/** Parse a route like socks5://127.0.0.1:9050 or http://proxy.example:8080; '' means direct. */
export function parseRoute(value: string): Route | null {
  const raw = value.trim();
  if (!raw) return null;
  let u: URL;
  try { u = new URL(raw); } catch { throw Error('A route is a proxy address like socks5://127.0.0.1:9050'); }
  const kind = u.protocol === 'socks5:' || u.protocol === 'socks5h:' ? 'socks5' : u.protocol === 'http:' ? 'http' : null;
  if (!kind) throw Error('Routes support socks5:// and http:// proxies');
  if (u.username || u.password) throw Error('Proxies that need a username and password are not supported yet');
  if ((u.pathname && u.pathname !== '/') || u.search || u.hash) throw Error('A route is only a host and port, e.g. socks5://127.0.0.1:9050');
  const port = Number(u.port);
  if (!u.hostname || !Number.isInteger(port) || port < 1 || port > 65535) throw Error('A route needs a host and a port, e.g. socks5://127.0.0.1:9050');
  const host = u.hostname.replace(/^\[|\]$/g, '');
  return { url: `${kind}://${u.host}`, kind, host, port };
}

/** fetch through a route (or directly when there is none). */
export function routedFetch(route: Route | null): typeof fetch {
  if (!route) return fetch;
  const dispatcher = route.kind === 'socks5'
    ? socksDispatcher({ type: 5, host: route.host, port: route.port })
    : new ProxyAgent(route.url);
  return ((input: string | URL | Request, init?: RequestInit) =>
    undiciFetch(input as never, { ...(init as object), dispatcher } as never)) as unknown as typeof fetch;
}

/** Where traffic leaves the internet from: country, city and network, as an exit-check service reports it. */
export interface Exit { country: string; city: string; org: string; vpn: string }

/**
 * Ask an exit-check service (default am.i.mullvad.net, which works for any
 * connection) where requests through this fetcher appear to come from.
 * The IP address itself is not kept.
 */
export async function exitOf(fetcher: typeof fetch, checkUrl: string): Promise<Exit> {
  const res = await fetcher(checkUrl, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(15_000) }).catch(e => {
    throw Error(`Could not reach the exit check through this route (${(e as Error).cause ? String((e as Error).cause) : (e as Error).message})`);
  });
  if (!res.ok) throw Error(`The exit check returned ${res.status}`);
  const v = (await res.json()) as Record<string, unknown>;
  return {
    country: String(v.country ?? ''),
    city: String(v.city ?? ''),
    org: String(v.organization ?? v.org ?? ''),
    vpn: v.mullvad_exit_ip === true ? 'Mullvad' : '',
  };
}

/** A case's lock: its exit must stay in this country and on this network. */
export interface Lock { country: string; org: string }

export function lockBroken(lock: Lock | null | undefined, exit: Exit): string {
  if (!lock) return '';
  if (lock.country && lock.country !== exit.country) return `the exit is in ${exit.country || 'an unknown country'}, not ${lock.country}`;
  if (lock.org && lock.org !== exit.org) return `the exit network is ${exit.org || 'unknown'}, not ${lock.org}`;
  return '';
}
