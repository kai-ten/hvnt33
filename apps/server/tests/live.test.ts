// Live checks against the real world: a real page archived by the server on
// its own (fetch; captures in the app's browser are checked by the app's
// end-to-end run) and the public timestamp authorities, verified independently
// with OpenSSL.
// Opt in with `npm run test:live` (HVNT33_LIVE=1); skipped otherwise.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { type Harness, removeInvestigation, start } from './harness.ts';

const live = process.env.HVNT33_LIVE === '1';
const run = promisify(execFile);
const fixtures = path.join(import.meta.dirname, 'fixtures');
let h: Harness, investigationId = '';

before(async () => { if (live) h = await start(); });
after(async () => { if (!live) return; if (investigationId) await removeInvestigation(h.graph, investigationId); await h.close(); });

test('a real page is archived and timestamped by two authorities', { skip: !live && 'set HVNT33_LIVE=1', timeout: 300_000 }, async () => {
  const inv = await h.a.api('/api/investigations', { title: 'TEST — live snapshot' });
  investigationId = inv.id;
  await h.a.api('/api/snapshots', { investigationId: inv.id, url: 'https://example.com/' });
  let snap: any;
  for (const end = Date.now() + 280_000; !snap && Date.now() < end;) {
    [snap] = await h.a.api(`/api/investigations/${inv.id}/snapshots`);
    if (!snap) await new Promise(r => setTimeout(r, 1000));
  }
  assert.ok(snap, 'snapshot finished');
  assert.equal(snap.method, 'fetch');
  assert.equal(snap.title, 'Example Domain');
  assert.deepEqual(snap.timestampErrors, []);
  assert.equal(snap.timestamps.length, 2);

  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'hvnt33-live-'));
  try {
    const manifest = path.join(dir, 'manifest.json');
    await fsp.writeFile(manifest, Buffer.from(await (await h.a.call(`/api/snapshots/${snap.id}/files/manifest`)).res.arrayBuffer()));
    for (const [i, t] of snap.timestamps.entries()) {
      const tsr = path.join(dir, `${i}.tsr`);
      await fsp.writeFile(tsr, Buffer.from(await (await h.a.call(`/api/snapshots/${snap.id}/files/timestamp-${i}`)).res.arrayBuffer()));
      const trust = t.tsa.includes('freetsa')
        ? ['-CAfile', path.join(fixtures, 'freetsa-cacert.pem'), '-untrusted', path.join(fixtures, 'freetsa-tsa.crt')]
        : ['-CAfile', '/etc/ssl/cert.pem'];
      const { stdout } = await run('openssl', ['ts', '-verify', '-data', manifest, '-in', tsr, ...trust]);
      assert.match(stdout, /Verification: OK/, t.tsa);
    }
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
});

test('built-in Tor: two cases on real Tor get different exits, New exit changes one, snapshots go through it', { skip: !live && 'set HVNT33_LIVE=1', timeout: 600_000 }, async () => {
  const { parseRoute, routedFetch } = await import('../src/seams/network.ts');
  assert.ok(h.config.network.torBinary, 'built-in Tor is installed (npm run setup)');
  const exitIp = async (id: string) => {
    const { route } = await h.a.api(`/api/investigations/${id}/route`);
    const r = await routedFetch(parseRoute(route))('https://check.torproject.org/api/ip', { signal: AbortSignal.timeout(60_000) });
    return (await r.json()) as { IsTor: boolean; IP: string };
  };
  const a = await h.a.api('/api/investigations', { title: 'TEST — live Tor A' });
  const b = await h.a.api('/api/investigations', { title: 'TEST — live Tor B' });
  try {
    for (const c of [a, b]) {
      const n = (await h.a.api(`/api/investigations/${c.id}`, { network: { route: '', label: '', lock: null, tor: true } }, 'PATCH')).network;
      assert.deepEqual([n.tor, n.label], [true, 'Tor']);
    }
    const status = await h.a.api('/api/network/tor');
    assert.deepEqual([status.builtin.state, status.builtin.progress], ['running', 100]);
    const [ea, eb] = [await exitIp(a.id), await exitIp(b.id)];
    assert.ok(ea.IsTor && eb.IsTor, 'both exits are Tor exits');
    // Separate circuits usually mean separate exits; Tor can rarely pick the same one.
    let other = eb;
    for (let i = 0; i < 3 && other.IP === ea.IP; i++) { await h.a.api(`/api/investigations/${b.id}/new-exit`, {}); other = await exitIp(b.id); }
    assert.notEqual(other.IP, ea.IP, 'the two cases leave from different Tor exits');
    let next = ea;
    for (let i = 0; i < 4 && next.IP === ea.IP; i++) { await h.a.api(`/api/investigations/${a.id}/new-exit`, {}); next = await exitIp(a.id); }
    assert.notEqual(next.IP, ea.IP, 'New exit changed the exit');
    assert.ok(next.IsTor);

    await h.a.api('/api/snapshots', { investigationId: a.id, url: 'https://example.com/' });
    let snap: any;
    for (const end = Date.now() + 300_000; !snap && Date.now() < end;) {
      [snap] = await h.a.api(`/api/investigations/${a.id}/snapshots`);
      if (!snap) await new Promise(r => setTimeout(r, 2000));
    }
    assert.ok(snap, 'a snapshot through Tor');
    assert.equal(snap.network.route, 'Tor');
    assert.equal(snap.title, 'Example Domain');

    for (const c of [a, b]) await h.a.api(`/api/investigations/${c.id}`, { network: { route: '', label: '', lock: null } }, 'PATCH');
    assert.equal((await h.a.api('/api/network/tor')).builtin.state, 'off', 'Tor stops when no case uses it');
  } finally {
    await removeInvestigation(h.graph, a.id);
    await removeInvestigation(h.graph, b.id);
  }
});
