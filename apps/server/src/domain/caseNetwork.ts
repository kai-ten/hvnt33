import net from 'node:net';
import { z } from 'zod';
import { type Api, HttpError, badRequest, clean } from '../http.ts';
import type { Row } from '../seams/graph.ts';
import { type Lock, type Route, exitOf, lockBroken, parseRoute, routedFetch } from '../seams/network.ts';
import { type Deps, idParam, investigationIn, now, text } from './common.ts';

// A case's network: its route (direct, a proxy, or Tor), the login for the
// route (kept in the secret store), its Tor circuit, and its exit lock.
// Everything the server fetches for a case goes through its effective route:
// the proxy itself, or the case's local relay when the route needs a login
// (a proxy's username and password, or Tor's per-case circuit).

export interface StoredNetwork { route: string; label: string; lock: Lock | null; tor?: boolean; circuit?: number; relayPort?: number; hasCredentials?: boolean }

const TOR_PASSWORD = 'hvnt33';
const torName = (port: number) => (port === 9150 ? 'Tor Browser' : 'Tor');

/** Is Tor listening here? A SOCKS5 greeting on each port, first answer wins. */
export async function detectTor(ports: number[], host = '127.0.0.1'): Promise<{ port: number; name: string } | null> {
  for (const port of ports) {
    const ok = await new Promise<boolean>(resolve => {
      const s = net.connect(port, host);
      const done = (v: boolean) => { s.destroy(); resolve(v); };
      s.setTimeout(1500, () => done(false));
      s.once('error', () => done(false));
      s.once('connect', () => s.write(Buffer.from([5, 1, 0])));
      s.once('data', d => done(d[0] === 5 && d[1] === 0));
    });
    if (ok) return { port, name: torName(port) };
  }
  return null;
}

/**
 * Where Tor is: hvnt33's own (started now if needed), or else a Tor Browser or
 * tor service already running on this machine.
 */
export async function torRoute(deps: Deps): Promise<{ route: string; name: string } | null> {
  if (deps.tor.get().installed) return { route: `socks5://127.0.0.1:${await deps.tor.start()}`, name: 'Tor' };
  const found = await detectTor(deps.config.network.torPorts);
  return found ? { route: `socks5://127.0.0.1:${found.port}`, name: found.name } : null;
}

/** Stop the built-in Tor when no case uses Tor any more. */
async function stopTorIfUnused(deps: Deps) {
  const [row] = await deps.graph.sql<{ n: number }>('SELECT count(*) AS n FROM Investigation WHERE network.tor = true AND deletedAt=:live', { live: '' });
  if (!Number(row?.n)) await deps.tor.stop();
}

/** The route the case's traffic actually uses: the proxy, or the case's relay when it must log in. */
export async function effectiveRoute(deps: Deps, inv: Row): Promise<Route | null> {
  const network = inv.network as StoredNetwork | undefined;
  // Tor's port is whatever the running Tor uses now; if Tor cannot run, the case fails closed.
  const tor = network?.tor ? await torRoute(deps).catch(e => { throw Error(`Tor is not available: ${(e as Error).message}`); }) : null;
  if (network?.tor && !tor) throw Error('Tor is not running');
  const upstream = parseRoute(tor?.route ?? network?.route ?? '');
  if (!upstream) return null;
  const secret = deps.secrets.get(String(inv.id));
  if (!network!.tor && !secret) return upstream;
  const login = network!.tor
    ? { username: `hvnt33-${inv.id}-${network!.circuit ?? 0}`, password: TOR_PASSWORD }
    : { username: secret!.username, password: secret!.password };
  const port = await deps.relays.ensure(String(inv.id), { route: upstream, ...login }, network!.relayPort ?? 0);
  if (port !== network!.relayPort) {
    await deps.graph.sql('UPDATE Investigation SET network.relayPort=:port WHERE id=:id', { port, id: inv.id });
  }
  return parseRoute(`socks5://127.0.0.1:${port}`);
}

/** The network as clients see it: never the credentials, never the relay's internals. */
export function publicNetwork(deps: Deps, inv: Row): StoredNetwork | undefined {
  const network = inv.network as StoredNetwork | undefined;
  if (!network) return undefined;
  const { relayPort: _relayPort, ...rest } = network;
  return { ...rest, hasCredentials: !!deps.secrets.get(String(inv.id)) };
}

export const NetworkBody = z.object({
  route: z.string().max(300).default(''),
  label: z.string().max(100).default(''),
  lock: z.object({ country: z.string().max(100), org: z.string().max(200) }).nullable().default(null),
  tor: z.boolean().optional().describe('Use Tor (detected on this machine) instead of `route`'),
  credentials: z.object({ username: z.string().min(1).max(300), password: z.string().max(1000) }).nullable().optional()
    .describe("The route's login; null removes it; omitted keeps it"),
});

/** Validate and store a case's network settings; returns the stored network. */
export async function applyNetwork(deps: Deps, inv: Row, body: z.infer<typeof NetworkBody>): Promise<StoredNetwork> {
  const previous = inv.network as StoredNetwork | undefined;
  let route = '', label = body.label.trim().slice(0, 100), tor = false;
  if ((body.tor || body.route.trim()) && deps.config.auth === 'token') throw badRequest('Per-case network routes need a local server: a proxy address refers to the network the server runs on');
  if (body.tor) {
    const found = await torRoute(deps).catch(e => { throw new HttpError(502, `Tor could not start: ${(e as Error).message}`, 'tor_failed'); });
    if (!found) throw new HttpError(409, 'Tor is not installed: run npm run setup (or open Tor Browser), then try again.', 'tor_not_running');
    route = found.route;
    label = found.name;
    tor = true;
  } else {
    let parsed: Route | null;
    try { parsed = parseRoute(body.route); } catch (e) { throw badRequest((e as Error).message); }
    route = parsed?.url ?? '';
  }
  const id = String(inv.id);
  if (!route || tor || body.credentials === null) deps.secrets.set(id, null);
  else if (body.credentials) deps.secrets.set(id, { username: body.credentials.username, password: body.credentials.password });
  const stored: StoredNetwork = {
    route, label, lock: body.lock, tor,
    circuit: tor ? (previous?.tor ? previous.circuit ?? 0 : 0) : 0,
    relayPort: previous?.relayPort ?? 0,
  };
  // The relay follows the new settings on next use; open connections through the old route end now.
  if (!route) await deps.relays.close(id); else deps.relays.reset(id);
  await deps.graph.sql('UPDATE Investigation SET network=:network, updatedAt=:t, version=ifnull(version, 1) + 1 WHERE id=:id', { network: stored, t: now(), id });
  if (!tor) await stopTorIfUnused(deps);
  return stored;
}

export function caseNetworkRoutes(api: Api, deps: Deps) {
  const { graph } = deps;

  api.route({
    method: 'get', path: '/api/network/tor', summary: 'Whether Tor (Tor Browser or the tor service) is running on this computer', tags: ['Network'],
    response: z.object({
      available: z.boolean(), name: z.string(), route: z.string(),
      builtin: z.object({ installed: z.boolean(), state: z.enum(['off', 'starting', 'running', 'failed']), progress: z.number(), summary: z.string(), error: z.string(), port: z.number() }),
    }),
    handler: async () => {
      const builtin = deps.tor.get();
      if (deps.config.auth === 'token') return { available: false, name: '', route: '', builtin: { ...builtin, installed: false } };
      if (builtin.installed) return { available: true, name: 'Tor', route: builtin.port ? `socks5://127.0.0.1:${builtin.port}` : '', builtin };
      const found = await detectTor(deps.config.network.torPorts);
      return found ? { available: true, name: found.name, route: `socks5://127.0.0.1:${found.port}`, builtin } : { available: false, name: '', route: '', builtin };
    },
  });

  api.route({
    method: 'get', path: '/api/investigations/:id/route', summary: "The proxy address this case's traffic goes through (its local relay when the route logs in); empty for direct", tags: ['Network'],
    params: idParam, response: z.object({ route: z.string() }),
    handler: async ({ params, workspaceId }) => {
      const route = await effectiveRoute(deps, await investigationIn(graph, workspaceId, params.id));
      return { route: route?.url ?? '' };
    },
  });

  api.route({
    method: 'post', path: '/api/investigations/:id/new-exit', summary: 'Tor: move the case to a new circuit (a new exit); its open connections end', tags: ['Network'],
    params: idParam, response: z.looseObject({ circuit: z.number() }),
    handler: async ({ params, workspaceId }) => {
      const inv = await investigationIn(graph, workspaceId, params.id);
      const network = inv.network as StoredNetwork | undefined;
      if (!network?.tor) throw badRequest('A new exit is for cases routed through Tor');
      const circuit = (network.circuit ?? 0) + 1;
      await graph.sql('UPDATE Investigation SET network.circuit=:c, updatedAt=:t WHERE id=:id', { c: circuit, t: now(), id: params.id });
      deps.relays.reset(params.id);
      return { ...publicNetwork(deps, { ...inv, network: { ...network, circuit } }), circuit };
    },
  });

  api.route({
    method: 'get', path: '/api/investigations/:id/exit', summary: "Where the case's server-side traffic (snapshots, watches, archive lookups) leaves the internet, through its route", tags: ['Network'],
    params: idParam,
    response: z.object({ route: z.string(), label: z.string(), exit: z.object({ country: z.string(), city: z.string(), org: z.string(), vpn: z.string() }), locked: z.boolean(), broken: z.string() }),
    handler: async ({ params, workspaceId }) => {
      const inv = await investigationIn(graph, workspaceId, params.id);
      const network = (clean(inv) as { network?: StoredNetwork }).network ?? { route: '', label: '', lock: null };
      const route = await effectiveRoute(deps, inv);
      const exit = await exitOf(routedFetch(route), deps.config.network.exitCheckUrl).catch(e => { throw new HttpError(502, (e as Error).message, 'route_unreachable'); });
      return { route: network.route, label: network.label, exit, locked: !!network.lock, broken: lockBroken(network.lock, exit) };
    },
  });
}

/** Tidy text for a label (exported for the investigations module). */
export const networkLabel = (v: unknown) => text(v, 100);
