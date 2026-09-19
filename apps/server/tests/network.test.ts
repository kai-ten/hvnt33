// Per-case network routes: parsing, fetching through a SOCKS5 proxy (with
// the proxy resolving hostnames), exit checks, locks, and snapshots that
// leave through the case's route and never fall back to a direct connection.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { lockBroken, parseRoute, routedFetch } from '../src/seams/network.ts';
import { BuiltinTor } from '../src/seams/tor.ts';
import os from 'node:os';
import { type Harness, profile, removeInvestigation, start } from './harness.ts';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { type TestSocks, startHttpProxy, startSocks } from './socks.ts';

test('routes are proxy addresses, validated', () => {
  assert.deepEqual(parseRoute(''), null);
  assert.deepEqual(parseRoute(' socks5://127.0.0.1:9050 '), { url: 'socks5://127.0.0.1:9050', kind: 'socks5', host: '127.0.0.1', port: 9050 });
  assert.equal(parseRoute('socks5h://10.64.0.1:1080')!.url, 'socks5://10.64.0.1:1080', 'socks5h is the same thing here: the proxy always resolves names');
  assert.equal(parseRoute('http://proxy.example:8080')!.kind, 'http');
  for (const [bad, why] of [['https://proxy.example:443', /socks5/], ['socks5://127.0.0.1', /port/], ['socks5://user:pw@host:1080', /username/], ['socks5://host:1080/path', /only a host/], ['not a url', /proxy address/], ['socks5://host:70000', /./]] as const) {
    assert.throws(() => parseRoute(bad), why, bad);
  }
  assert.equal(lockBroken(null, { country: 'Sweden', city: '', org: 'X', vpn: '' }), '');
  assert.equal(lockBroken({ country: 'Sweden', org: '' }, { country: 'Sweden', city: '', org: 'Any', vpn: '' }), '');
  assert.match(lockBroken({ country: 'Sweden', org: '' }, { country: 'United States', city: '', org: 'ISP', vpn: '' }), /United States, not Sweden/);
  assert.match(lockBroken({ country: 'Sweden', org: 'M247' }, { country: 'Sweden', city: '', org: 'Home ISP', vpn: '' }), /Home ISP, not M247/);
});

let h: Harness, socks: TestSocks, site: http.Server, siteBase = '';
let exitReply = { country: 'Testland', city: 'Proxytown', organization: 'E2E Proxy Network' };
const cleanup: string[] = [];

before(async () => {
  h = await start();
  socks = await startSocks();
  site = http.createServer((req, res) => {
    if (req.url === '/exit') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ip: '192.0.2.1', ...exitReply })); return; }
    res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<title>Routed page</title><p>Seen through the route.</p>');
  });
  await new Promise<void>(r => site.listen(0, '127.0.0.1', r));
  siteBase = `http://127.0.0.1:${(site.address() as AddressInfo).port}`;
  h.config.network.exitCheckUrl = `${siteBase}/exit`;
});
after(async () => { for (const id of cleanup) await removeInvestigation(h.graph, id); await socks.close(); site.close(); await h.close(); });

async function waitFor<T>(what: string, fn: () => Promise<T | null | undefined | false>, ms = 20_000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) throw Error(`Timed out waiting for ${what}`); await new Promise(r => setTimeout(r, 200)); }
}

test('fetching through a SOCKS5 route: traffic goes via the proxy, which resolves hostnames', async () => {
  socks.log.length = 0;
  const port = new URL(siteBase).port;
  const res = await routedFetch(parseRoute(socks.url))(`http://localhost:${port}/`);
  assert.match(await res.text(), /Seen through the route/);
  assert.deepEqual(socks.log.at(-1), { host: 'localhost', port: Number(port), addressType: 'domain', username: '' }, 'the hostname reached the proxy unresolved (no local DNS lookup)');
});

test('a case route: saved on the case, used for its exit check and its snapshots', async () => {
  const inv = await h.a.api('/api/investigations', { title: 'TEST — routed case' });
  cleanup.push(inv.id);
  if (profile === 'token') {
    const r = await h.a.call(`/api/investigations/${inv.id}`, { network: { route: socks.url, label: 'Test proxy', lock: null } }, 'PATCH');
    assert.equal(r.status, 400, 'hosted servers do not accept routes');
    assert.equal((await h.a.call(`/api/investigations/${inv.id}`, { network: { route: '', label: '', lock: { country: 'Testland', org: '' } } }, 'PATCH')).status, 200, 'a lock alone is allowed');
    return;
  }
  assert.equal((await h.a.call(`/api/investigations/${inv.id}`, { network: { route: 'ftp://x:1', label: '', lock: null } }, 'PATCH')).status, 400);
  const saved = await h.a.api(`/api/investigations/${inv.id}`, { network: { route: `socks5h://127.0.0.1:${socks.port}`, label: 'Test proxy', lock: null } }, 'PATCH');
  assert.deepEqual(saved.network, { route: socks.url, label: 'Test proxy', lock: null, tor: false, circuit: 0, hasCredentials: false });
  assert.equal((await h.a.api(`/api/investigations/${inv.id}`)).investigation.network.label, 'Test proxy');

  socks.log.length = 0;
  const exit = await h.a.api(`/api/investigations/${inv.id}/exit`);
  assert.deepEqual([exit.exit.country, exit.exit.org, exit.locked, exit.broken], ['Testland', 'E2E Proxy Network', false, '']);
  assert.ok(socks.log.some(l => l.port === Number(new URL(siteBase).port)), 'the exit check went through the route');
  assert.ok(!('ip' in exit.exit), 'the IP address is not kept');

  socks.log.length = 0;
  await h.a.api('/api/snapshots', { investigationId: inv.id, url: `${siteBase}/page` });
  const [snap] = await waitFor('routed snapshot', async () => { const s = await h.a.api(`/api/investigations/${inv.id}/snapshots`); return s.length === 1 && s; });
  assert.deepEqual(snap.network, { route: 'Test proxy', country: 'Testland', org: 'E2E Proxy Network' });
  assert.equal(socks.log.filter(l => l.port === Number(new URL(siteBase).port)).length, 2, 'the exit check and the page both went through the route');
  const manifest = JSON.parse(await (await h.a.call(`/api/snapshots/${snap.id}/files/manifest`)).res.text());
  assert.deepEqual(manifest.network, snap.network, 'the timestamped manifest says where the page was fetched from');

  // Wayback lookups for the case go through its route too (a cached history needs no request).
  socks.log.length = 0;
  // Only the request's path matters here, not archive.org's (sometimes slow) answer.
  void h.a.call('/api/archive/lookup', { url: `${siteBase}/never-archived-${Date.now()}`, investigationId: inv.id, refresh: true }).catch(() => {});
  await waitFor('the Wayback lookup to go through the route', async () => socks.log.some(l => l.host === 'web.archive.org'), 15_000);

  // Locked to somewhere else: nothing is captured.
  await h.a.api(`/api/investigations/${inv.id}`, { network: { route: socks.url, label: 'Test proxy', lock: { country: 'Sweden', org: '' } } }, 'PATCH');
  assert.match((await h.a.api(`/api/investigations/${inv.id}/exit`)).broken, /Testland, not Sweden/);
  const job = await h.a.api('/api/snapshots', { investigationId: inv.id, url: `${siteBase}/page` });
  const failed = await waitFor('locked capture to fail', async () => { const j = (await h.a.api(`/api/investigations/${inv.id}/archive`)).jobs.find((x: any) => x.id === job.id); return j?.state === 'failed' && j; }, 30_000);
  assert.match(failed.error, /Not captured: this case is locked to Sweden/);

  // The proxy goes away: captures fail rather than go direct.
  await h.a.api(`/api/investigations/${inv.id}`, { network: { route: socks.url, label: 'Test proxy', lock: null } }, 'PATCH');
  await socks.close();
  const direct = await h.a.api('/api/snapshots', { investigationId: inv.id, url: `${siteBase}/page` });
  const down = await waitFor('capture without its proxy to fail', async () => { const j = (await h.a.api(`/api/investigations/${inv.id}/archive`)).jobs.find((x: any) => x.id === direct.id); return j?.state === 'failed' && j; }, 30_000);
  assert.match(down.error, /Could not reach the exit check through this route/);
  assert.equal((await h.a.api(`/api/investigations/${inv.id}/snapshots`)).length, 1, 'no snapshot was taken outside the route');
  assert.equal((await h.a.call(`/api/investigations/${inv.id}/exit`)).status, 502);
  socks = await startSocks();
});

test('network settings are private to the workspace', { skip: profile !== 'token' }, async () => {
  const inv = await h.a.api('/api/investigations', { title: 'TEST — private network' });
  cleanup.push(inv.id);
  assert.equal((await h.b!.call(`/api/investigations/${inv.id}`, { title: 'x' }, 'PATCH')).status, 404);
  assert.equal((await h.b!.call(`/api/investigations/${inv.id}/exit`)).status, 404);
});

test('routes that log in: credentials stay on this machine, a local relay adds them', { skip: profile !== 'local' }, async () => {
  const vpn = await startSocks('127.0.0.1', { credentials: { username: 'e2e-user', password: 'correct horse' } });
  const httpProxy = await startHttpProxy({ username: 'web-user', password: 'battery staple' });
  try {
    const inv = await h.a.api('/api/investigations', { title: 'TEST — proxy with login' });
    cleanup.push(inv.id);
    const saved = await h.a.api(`/api/investigations/${inv.id}`, { network: { route: vpn.url, label: 'VPN proxy', lock: null, credentials: { username: 'e2e-user', password: 'correct horse' } } }, 'PATCH');
    assert.equal(saved.network.hasCredentials, true);
    const everything = JSON.stringify([saved, await h.a.api(`/api/investigations/${inv.id}`), await h.a.api('/api/investigations'), await h.graph.sql('SELECT FROM Investigation WHERE id=:id', { id: inv.id })]);
    assert.ok(!everything.includes('correct horse'), 'the password is never in the API or the database');
    assert.ok(!everything.includes('relayPort') || !JSON.stringify([saved, await h.a.api('/api/investigations')]).includes('relayPort'));
    const secrets = path.join(h.config.network.secretsDir, 'routes.json');
    assert.ok(fs.readFileSync(secrets, 'utf8').includes('correct horse'));
    if (process.platform !== 'win32') assert.equal(fs.statSync(secrets).mode & 0o077, 0, 'readable by this user only');

    const { route } = await h.a.api(`/api/investigations/${inv.id}/route`);
    assert.match(route, /^socks5:\/\/127\.0\.0\.1:\d+$/, 'clients use the local relay, without credentials');
    vpn.log.length = 0;
    const exit = await h.a.api(`/api/investigations/${inv.id}/exit`);
    assert.equal(exit.exit.org, 'E2E Proxy Network');
    assert.deepEqual(vpn.log.map(l => l.username), ['e2e-user'], 'the relay logged in upstream');
    // A client of the relay needs no login, and hostnames stay unresolved all the way.
    const port = new URL(siteBase).port;
    await (await routedFetch(parseRoute(route))(`http://localhost:${port}/`)).text();
    assert.deepEqual(vpn.log.at(-1), { host: 'localhost', port: Number(port), addressType: 'domain', username: 'e2e-user' });
    const relayPort = new URL(route).port;
    assert.equal(new URL((await h.a.api(`/api/investigations/${inv.id}/route`)).route).port, relayPort, 'the relay keeps its port');

    // A wrong password fails closed.
    await h.a.api(`/api/investigations/${inv.id}`, { network: { route: vpn.url, label: 'VPN proxy', lock: null, credentials: { username: 'e2e-user', password: 'wrong' } } }, 'PATCH');
    assert.equal((await h.a.call(`/api/investigations/${inv.id}/exit`)).status, 502);

    // An HTTP proxy with Basic authentication, for a snapshot.
    await h.a.api(`/api/investigations/${inv.id}`, { network: { route: httpProxy.url, label: 'HTTP proxy', lock: null, credentials: { username: 'web-user', password: 'battery staple' } } }, 'PATCH');
    await h.a.api('/api/snapshots', { investigationId: inv.id, url: `${siteBase}/page` });
    const [snap] = await waitFor('snapshot through the HTTP proxy', async () => { const s = await h.a.api(`/api/investigations/${inv.id}/snapshots`); return s.length === 1 && s; });
    assert.equal(snap.network.route, 'HTTP proxy');
    assert.ok(httpProxy.log.filter(l => l.username === 'web-user').length >= 2, 'the exit check and the page went through it, logged in');

    // Removing the route removes the login.
    await h.a.api(`/api/investigations/${inv.id}`, { network: { route: '', label: '', lock: null } }, 'PATCH');
    assert.ok(!fs.readFileSync(secrets, 'utf8').includes(inv.id));
    assert.equal((await h.a.api(`/api/investigations/${inv.id}/route`)).route, '');
  } finally {
    await vpn.close();
    await httpProxy.close();
  }
});

test('Tor: detected when running, one circuit per case, and a new exit on request', { skip: profile !== 'local' }, async () => {
  const tor = await startSocks('127.0.0.1', { credentials: 'any' });
  const ports = h.config.network.torPorts;
  try {
    h.config.network.torPorts = [1];
    const none = await h.a.api('/api/network/tor');
    assert.deepEqual([none.available, none.builtin.installed], [false, false], 'built-in Tor is off in offline tests');
    const a = await h.a.api('/api/investigations', { title: 'TEST — Tor case A' });
    const b = await h.a.api('/api/investigations', { title: 'TEST — Tor case B' });
    cleanup.push(a.id, b.id);
    const off = await h.a.call(`/api/investigations/${a.id}`, { network: { route: '', label: '', lock: null, tor: true } }, 'PATCH');
    assert.deepEqual([off.status, off.json.code], [409, 'tor_not_running']);
    assert.match(off.json.error, /npm run setup/);

    h.config.network.torPorts = [1, tor.port];
    const found = await h.a.api('/api/network/tor');
    assert.deepEqual([found.available, found.name, found.route], [true, 'Tor', `socks5://127.0.0.1:${tor.port}`]);
    for (const c of [a, b]) {
      const n = (await h.a.api(`/api/investigations/${c.id}`, { network: { route: '', label: '', lock: null, tor: true } }, 'PATCH')).network;
      assert.deepEqual([n.tor, n.route, n.label, n.circuit], [true, `socks5://127.0.0.1:${tor.port}`, 'Tor', 0]);
    }
    tor.log.length = 0;
    await h.a.api(`/api/investigations/${a.id}/exit`);
    await h.a.api(`/api/investigations/${b.id}/exit`);
    assert.deepEqual(tor.log.map(l => l.username), [`hvnt33-${a.id}-0`, `hvnt33-${b.id}-0`], 'each case logs in with its own name: Tor gives it its own circuit');

    // A long-lived connection through case A's relay ends when A takes a new exit.
    const relay = new URL((await h.a.api(`/api/investigations/${a.id}/route`)).route);
    const open = net.connect(Number(relay.port), '127.0.0.1');
    await new Promise(r => open.once('connect', r));
    open.write(Buffer.from([5, 1, 0]));
    await new Promise(r => open.once('data', r));
    const sitePort = Number(new URL(siteBase).port);
    open.write(Buffer.concat([Buffer.from([5, 1, 0, 3, 9]), Buffer.from('localhost'), Buffer.from([sitePort >> 8, sitePort & 255])]));
    await new Promise(r => open.once('data', r));
    const ended = new Promise(r => open.once('close', r));
    const next = await h.a.api(`/api/investigations/${a.id}/new-exit`, {});
    assert.equal(next.circuit, 1);
    await ended;
    tor.log.length = 0;
    await h.a.api(`/api/investigations/${a.id}/exit`);
    assert.deepEqual(tor.log.map(l => l.username), [`hvnt33-${a.id}-1`], 'the new circuit');
    assert.equal((await h.a.call(`/api/investigations/${inv(a)}/new-exit`, {})).status, 200);

    // Exports never say how the researcher connected.
    const zip = await h.a.call(`/api/investigations/${a.id}/export?scope=all`);
    assert.equal(zip.status, 200);
    const body = Buffer.from(await zip.res.arrayBuffer()).toString('latin1');
    assert.ok(!body.includes('127.0.0.1:' + tor.port) && !body.includes('"tor":'), 'no route in the export');
  } finally {
    h.config.network.torPorts = ports;
    await tor.close();
  }
});

const inv = (x: { id: string }) => x.id;

test('built-in Tor: started on demand with progress, found on its own port, stopped; a failed start is reported', async () => {
  const fake = path.join(import.meta.dirname, 'fixtures', 'fake-tor.mjs');
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hvnt33-tor-'));
  try {
    const tor = new BuiltinTor(fake, dataDir, 20_000);
    assert.equal(tor.get().installed, true);
    const starting = tor.start();
    assert.equal(tor.get().state, 'starting');
    assert.equal(tor.start(), starting, 'one start at a time');
    const port = await starting;
    assert.deepEqual([tor.get().state, tor.get().progress, tor.get().summary, tor.get().port], ['running', 100, 'Done', port]);
    // Its SOCKS port serves logins (circuit isolation).
    const probe = await import('../src/domain/caseNetwork.ts');
    assert.deepEqual(await probe.detectTor([port]), { port, name: 'Tor' });
    await tor.stop();
    assert.equal(tor.get().state, 'off');
    assert.equal(await probe.detectTor([port]), null, 'stopped');
    if (process.platform !== 'win32') assert.equal(fs.statSync(dataDir).mode & 0o077, 0, 'its data folder is private');

    process.env.FAKE_TOR_FAIL = '1';
    const broken = new BuiltinTor(fake, dataDir, 20_000);
    await assert.rejects(broken.start(), /Reading config failed/);
    assert.equal(broken.get().state, 'failed');
    assert.equal(new BuiltinTor(path.join(dataDir, 'missing'), dataDir).get().installed, false);
  } finally {
    delete process.env.FAKE_TOR_FAIL;
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
