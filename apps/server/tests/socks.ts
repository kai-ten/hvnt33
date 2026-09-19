// Test proxies. A minimal SOCKS5 proxy (CONNECT only; optionally requiring a
// username and password, like a VPN provider's, or accepting any, like Tor)
// and an HTTP CONNECT proxy with Basic authentication. Both log every
// destination as the client sent it, with the username used, so tests can see
// what went through a route, under which identity, and that hostnames reached
// the proxy unresolved.
import http from 'node:http';
import net from 'node:net';
import type { AddressInfo } from 'node:net';

export interface SocksLog { host: string; port: number; addressType: 'ipv4' | 'domain' | 'ipv6'; username: string }
export interface TestSocks { url: string; port: number; log: SocksLog[]; close(): Promise<void> }
/** `credentials`: require this login; 'any': accept any login (as Tor does, isolating circuits by it); omitted: no login. */
export interface SocksOptions { credentials?: { username: string; password: string } | 'any' }

export async function startSocks(host = '127.0.0.1', options: SocksOptions = {}): Promise<TestSocks> {
  const log: SocksLog[] = [];
  const sockets = new Set<net.Socket>();
  const server = net.createServer(client => {
    sockets.add(client);
    client.on('close', () => sockets.delete(client));
    client.on('error', () => {});
    let username = '';
    const request = (req: Buffer) => {
      if (req[0] !== 5 || req[1] !== 1) { client.end(Buffer.from([5, 7, 0, 1, 0, 0, 0, 0, 0, 0])); return; }
      let dest = '', i = 4, addressType: SocksLog['addressType'];
      if (req[3] === 1) { dest = [...req.subarray(4, 8)].join('.'); i = 8; addressType = 'ipv4'; }
      else if (req[3] === 3) { const n = req[4]; dest = req.subarray(5, 5 + n).toString(); i = 5 + n; addressType = 'domain'; }
      else { dest = req.subarray(4, 20).toString('hex').match(/.{4}/g)!.join(':'); i = 20; addressType = 'ipv6'; }
      const port = req.readUInt16BE(i);
      log.push({ host: dest, port, addressType, username });
      const upstream = net.connect(port, dest, () => {
        client.write(Buffer.from([5, 0, 0, 1, 0, 0, 0, 0, 0, 0]));
        upstream.pipe(client);
        client.pipe(upstream);
      });
      sockets.add(upstream);
      upstream.on('close', () => { sockets.delete(upstream); client.destroy(); });
      upstream.on('error', () => client.end(Buffer.from([5, 5, 0, 1, 0, 0, 0, 0, 0, 0])));
    };
    client.once('data', greeting => {
      if (greeting[0] !== 5) return client.destroy();
      const methods = [...greeting.subarray(2, 2 + greeting[1])];
      if (!options.credentials) {
        if (!methods.includes(0)) return void client.end(Buffer.from([5, 0xff]));
        client.write(Buffer.from([5, 0]));
        client.once('data', request);
        return;
      }
      if (!methods.includes(2)) {
        // Like Tor: 'any' also serves clients that offer no login.
        if (options.credentials !== 'any' || !methods.includes(0)) return void client.end(Buffer.from([5, 0xff]));
        client.write(Buffer.from([5, 0]));
        client.once('data', request);
        return;
      }
      client.write(Buffer.from([5, 2]));
      client.once('data', auth => {
        const ulen = auth[1], user = auth.subarray(2, 2 + ulen).toString();
        const plen = auth[2 + ulen], pass = auth.subarray(3 + ulen, 3 + ulen + plen).toString();
        const want = options.credentials;
        const ok = want === 'any' || (want!.username === user && want!.password === pass);
        client.write(Buffer.from([1, ok ? 0 : 1]));
        if (!ok) return void client.end();
        username = user;
        client.once('data', request);
      });
    });
  });
  await new Promise<void>(resolve => server.listen(0, host, resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    url: `socks5://${host}:${port}`, port, log,
    close: () => new Promise(resolve => { for (const s of sockets) s.destroy(); server.close(() => resolve()); }),
  };
}

/** An HTTP CONNECT proxy requiring Basic authentication. */
export async function startHttpProxy(credentials: { username: string; password: string }): Promise<TestSocks> {
  const log: SocksLog[] = [];
  const sockets = new Set<net.Socket>();
  const server = http.createServer((_req, res) => { res.writeHead(405); res.end(); });
  server.on('connect', (req, client: net.Socket, head) => {
    sockets.add(client);
    client.on('error', () => {});
    const [user, pass] = Buffer.from(String(req.headers['proxy-authorization'] ?? '').replace(/^Basic /, ''), 'base64').toString().split(':');
    if (user !== credentials.username || pass !== credentials.password) {
      client.end('HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm="test"\r\n\r\n');
      return;
    }
    const [host, port] = String(req.url).split(':');
    log.push({ host, port: Number(port), addressType: net.isIP(host) ? 'ipv4' : 'domain', username: user });
    const upstream = net.connect(Number(port), host, () => {
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head.length) upstream.write(head);
      upstream.pipe(client);
      client.pipe(upstream);
    });
    sockets.add(upstream);
    upstream.on('error', () => client.destroy());
    upstream.on('close', () => client.destroy());
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    url: `http://127.0.0.1:${port}`, port, log,
    close: () => new Promise(resolve => { for (const s of sockets) s.destroy(); server.close(() => resolve()); }),
  };
}
