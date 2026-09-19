import net from 'node:net';
import { SocksClient } from 'socks';
import type { Route } from './network.ts';

// A local relay per case. The app's browser (tabs and snapshots) and the
// server's own fetches connect to 127.0.0.1:<port> without credentials; the
// relay connects on to the case's real route, logging in there: with the
// proxy's username and password, or for Tor with a username per case (and per
// circuit), which Tor uses to keep each case on its own circuit and exit.
// Hostnames are passed on unresolved, so DNS stays on the route.

export interface Upstream { route: Route; username: string; password: string }

interface Relay { server: net.Server; port: number; upstream: Upstream; sockets: Set<net.Socket> }

const REPLY = (code: number) => Buffer.from([5, code, 0, 1, 0, 0, 0, 0, 0, 0]);

function readRequest(req: Buffer): { host: string; port: number } | null {
  if (req[0] !== 5 || req[1] !== 1) return null;
  if (req[3] === 1) return { host: [...req.subarray(4, 8)].join('.'), port: req.readUInt16BE(8) };
  if (req[3] === 3) { const n = req[4]; return { host: req.subarray(5, 5 + n).toString(), port: req.readUInt16BE(5 + n) }; }
  if (req[3] === 4) return { host: req.subarray(4, 20).toString('hex').match(/.{4}/g)!.join(':'), port: req.readUInt16BE(20) };
  return null;
}

/** Open a tunnel to host:port through the upstream proxy. */
async function connectUpstream(up: Upstream, host: string, port: number): Promise<net.Socket> {
  if (up.route.kind === 'socks5') {
    const { socket } = await SocksClient.createConnection({
      proxy: { host: up.route.host, port: up.route.port, type: 5, ...(up.username ? { userId: up.username, password: up.password } : {}) },
      command: 'connect', destination: { host, port }, timeout: 30_000,
    });
    return socket;
  }
  return new Promise((resolve, reject) => {
    const socket = net.connect(up.route.port, up.route.host);
    const auth = up.username ? `Proxy-Authorization: Basic ${Buffer.from(`${up.username}:${up.password}`).toString('base64')}\r\n` : '';
    const target = net.isIPv6(host) ? `[${host}]:${port}` : `${host}:${port}`;
    socket.once('error', reject);
    socket.once('connect', () => socket.write(`CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\n${auth}\r\n`));
    let buf = Buffer.alloc(0);
    const onData = (chunk: Buffer) => {
      buf = Buffer.concat([buf, chunk]);
      const end = buf.indexOf('\r\n\r\n');
      if (end < 0) { if (buf.length > 16384) { socket.destroy(); reject(Error('Proxy reply too long')); } return; }
      socket.off('data', onData);
      const status = Number(/^HTTP\/1\.[01] (\d{3})/.exec(buf.subarray(0, end).toString())?.[1]);
      if (status !== 200) { socket.destroy(); reject(Error(status === 407 ? 'The proxy rejected the username or password' : `The proxy refused the connection (${status || 'no reply'})`)); return; }
      const rest = buf.subarray(end + 4);
      if (rest.length) socket.unshift(rest);
      resolve(socket);
    };
    socket.on('data', onData);
  });
}

export class RouteRelays {
  private relays = new Map<string, Relay>();

  /** The local relay for a case, started (on `port` when given, else a free one) and pointed at `upstream`. */
  async ensure(caseId: string, upstream: Upstream, port = 0): Promise<number> {
    const existing = this.relays.get(caseId);
    if (existing) {
      if (JSON.stringify(existing.upstream) !== JSON.stringify(upstream)) this.reset(caseId, upstream);
      return existing.port;
    }
    const relay: Relay = { server: net.createServer(), port: 0, upstream, sockets: new Set() };
    relay.server.on('connection', client => this.serve(relay, client));
    await new Promise<void>((resolve, reject) => {
      relay.server.once('error', reject);
      relay.server.listen(port, '127.0.0.1', () => { relay.server.off('error', reject); resolve(); });
    }).catch(async e => {
      if (!port) throw e;
      // The case's usual port is taken: use another (the caller stores it).
      await new Promise<void>(resolve => relay.server.listen(0, '127.0.0.1', resolve));
    });
    relay.port = (relay.server.address() as net.AddressInfo).port;
    this.relays.set(caseId, relay);
    return relay.port;
  }

  /** Point a case's relay at a new upstream (or new circuit), dropping its open connections. */
  reset(caseId: string, upstream?: Upstream) {
    const relay = this.relays.get(caseId);
    if (!relay) return;
    if (upstream) relay.upstream = upstream;
    for (const s of relay.sockets) s.destroy();
    relay.sockets.clear();
  }

  async close(caseId?: string) {
    const ids = caseId ? [caseId] : [...this.relays.keys()];
    for (const id of ids) {
      const relay = this.relays.get(id);
      if (!relay) continue;
      this.relays.delete(id);
      for (const s of relay.sockets) s.destroy();
      await new Promise<void>(resolve => relay.server.close(() => resolve()));
    }
  }

  private serve(relay: Relay, client: net.Socket) {
    // Only this machine may use a relay.
    if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(client.remoteAddress ?? '')) return void client.destroy();
    relay.sockets.add(client);
    client.on('close', () => relay.sockets.delete(client));
    client.on('error', () => {});
    client.once('data', greeting => {
      if (greeting[0] !== 5 || ![...greeting.subarray(2, 2 + greeting[1])].includes(0)) return void client.end(Buffer.from([5, 0xff]));
      client.write(Buffer.from([5, 0]));
      client.once('data', async req => {
        const dest = readRequest(req);
        if (!dest) return void client.end(REPLY(7));
        client.pause();
        try {
          const upstream = await connectUpstream(relay.upstream, dest.host, dest.port);
          relay.sockets.add(upstream);
          upstream.on('close', () => { relay.sockets.delete(upstream); client.destroy(); });
          upstream.on('error', () => client.destroy());
          client.on('close', () => upstream.destroy());
          client.write(REPLY(0));
          upstream.pipe(client);
          client.pipe(upstream);
          client.resume();
        } catch {
          client.end(REPLY(5));
        }
      });
    });
  }
}
