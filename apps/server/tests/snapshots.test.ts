// hvnt33's own archive: timestamps, WACZ, change detection, snapshots, watches,
// evidence and replay. Offline: a local web page stands in for the web.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import yauzl from 'yauzl';
import { buildRequest, parseResponse } from '../src/seams/timestamps.ts';
import { htmlText, htmlTitle, readWacz, surt, warcRecords, writeWacz } from '../src/archive/wacz.ts';
import { checkReplayToken, compareText, replayToken } from '../src/domain/snapshots.ts';
import { assertPublicUrl, isPublicAddress } from '../src/seams/netguard.ts';
import { fetchCapture } from '../src/seams/capture.ts';
import { type Harness, profile, removeInvestigation, start } from './harness.ts';

const fixtures = path.join(import.meta.dirname, 'fixtures');

// ── Pure logic ───────────────────────────────────────────────────────────────

test('RFC 3161: requests are well-formed and real tokens are checked against digest and nonce', () => {
  const data = fs.readFileSync(path.join(fixtures, 'tsa-data.txt'));
  const digest = createHash('sha256').update(data).digest();
  const meta = JSON.parse(fs.readFileSync(path.join(fixtures, 'tsa-fixtures.json'), 'utf8'));
  for (const [name, expected] of [['digicert', '2026-09-18T16:28:36.000Z'], ['freetsa', '2026-09-18T16:28:37.000Z']]) {
    const token = fs.readFileSync(path.join(fixtures, `tsa-${name}.tsr`));
    const nonce = Buffer.from(meta[name].nonce, 'hex');
    assert.equal(parseResponse(token, digest, nonce).genTime, expected, name);
    assert.throws(() => parseResponse(token, createHash('sha256').update('other').digest(), nonce), /does not cover this digest/);
    assert.throws(() => parseResponse(token, digest, Buffer.from('0000000000000001', 'hex')), /nonce does not match/);
  }
  const req = buildRequest(digest, Buffer.from([0x80, 1, 2, 3]));
  assert.equal(req[0], 0x30, 'a DER SEQUENCE');
  assert.ok(req.includes(digest), 'carries the digest');
  assert.ok(req.includes(Buffer.from([0x02, 0x05, 0x00, 0x80, 1, 2, 3])), 'a high-bit nonce is encoded as a positive INTEGER');
  assert.throws(() => buildRequest(Buffer.alloc(20), Buffer.alloc(8)), /SHA-256/);
  // A refused request (status 2) is an error, not a token.
  const refused = Buffer.from([0x30, 0x05, 0x30, 0x03, 0x02, 0x01, 0x02]);
  assert.throws(() => parseResponse(refused, digest, Buffer.alloc(8)), /refused/);
});

test('replay links are signed, expire and cannot be moved to another snapshot', () => {
  const secret = randomBytes(32).toString('hex'), id = '11111111-1111-1111-1111-111111111111';
  const t = replayToken(secret, id);
  assert.ok(checkReplayToken(secret, id, t));
  assert.equal(checkReplayToken(secret, '22222222-2222-2222-2222-222222222222', t), false);
  assert.equal(checkReplayToken('other-secret', id, t), false);
  assert.equal(checkReplayToken(secret, id, replayToken(secret, id, 1000, Date.now() - 10_000)), false, 'expired');
  const flip = (s: string, i: number) => s.slice(0, i) + (s[i] === 'A' ? 'B' : 'A') + s.slice(i + 1);
  assert.equal(checkReplayToken(secret, id, flip(t, t.length - 10)), false, 'tampered');
  assert.equal(checkReplayToken(secret, id, flip(t, t.length - 1)), false, 'a variant spelling of the same MAC');
  assert.equal(checkReplayToken(secret, id, 'garbage'), false);
});

test('page text extraction and line diffs', () => {
  const html = '<html><head><title>City &amp; Harbor</title><script>var x=1</script><style>p{}</style></head><body><nav>Menu</nav><h1>Award</h1><p>Council   awarded&nbsp;the <b>contract</b>.</p><p>Minutes &#8212; June</p></body></html>';
  assert.equal(htmlTitle(html), 'City & Harbor');
  assert.equal(htmlText(html), 'Menu\nAward\nCouncil awarded the contract .\nMinutes — June');
  const d = compareText('a\nb\nc\nd', 'a\nB\nc\nd\ne');
  assert.deepEqual([d.added, d.removed, d.unchanged, d.addedLines, d.removedLines], [2, 1, 3, ['B', 'e'], ['b']]);
  assert.equal(compareText('same', 'same').similarity, 1);
  assert.equal(surt('https://www.Example.com:443/Path/A?b=2&a=1'), 'com,example)/path/a?a=1&b=2');
});

test('fetch captures produce a valid, indexed WACZ', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'hvnt33-wacz-'));
  try {
    const file = path.join(dir, 'x.wacz');
    const body = Buffer.from('<html><title>T</title><p>Hello archive</p></html>');
    await writeWacz(file, { requestUrl: 'https://a.example/p', finalUrl: 'https://a.example/p', status: 200, statusText: 'OK', headers: [['content-type', 'text/html'], ['content-encoding', 'gzip']], body, capturedAt: '2026-09-18T10:00:00.000Z', title: 'T', text: 'Hello archive', mime: 'text/html' });
    const w = await readWacz(file);
    assert.deepEqual(w.entries.sort(), ['archive/data.warc.gz', 'datapackage-digest.json', 'datapackage.json', 'indexes/index.cdxj', 'pages/pages.jsonl']);
    assert.deepEqual([w.pages[0].url, w.pages[0].text, w.pages[0].status], ['https://a.example/p', 'Hello archive', 200]);
    // The CDXJ offset must point at the response record, and the data package must hash its files.
    const zip = await new Promise<yauzl.ZipFile>((res, rej) => yauzl.open(file, { lazyEntries: true }, (e, z) => (e ? rej(e) : res(z!))));
    const files: Record<string, Buffer> = {};
    await new Promise<void>((res, rej) => {
      zip.on('entry', (entry: yauzl.Entry) => zip.openReadStream(entry, async (e, s) => { if (e) return rej(e); const c: Buffer[] = []; for await (const x of s!) c.push(x as Buffer); files[entry.fileName] = Buffer.concat(c); zip.readEntry(); }));
      zip.on('end', res); zip.readEntry();
    });
    const cdx = JSON.parse(files['indexes/index.cdxj'].toString().split(' ').slice(2).join(' '));
    const slice = files['archive/data.warc.gz'].subarray(Number(cdx.offset), Number(cdx.offset) + Number(cdx.length));
    for await (const record of warcRecords(slice)) {
      assert.equal(record.warcType, 'response');
      assert.equal(Buffer.from(await record.readFully(true)).toString(), body.toString());
    }
    const pkg = JSON.parse(files['datapackage.json'].toString());
    for (const r of pkg.resources) assert.equal(r.hash, `sha256:${createHash('sha256').update(files[r.path]).digest('hex')}`, r.path);
    assert.ok(!/content-encoding/i.test((await (async () => { for await (const r of warcRecords(slice)) return JSON.stringify([...(r.httpHeaders?.headers ?? [])]); })()) ?? ''), 'stored bodies are decoded, so their encoding header is dropped');
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
});

test('hosted servers only archive public addresses, on every redirect', async () => {
  for (const ip of ['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111', '93.184.215.14']) assert.ok(isPublicAddress(ip), ip);
  for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', '::', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1', '::ffff:10.0.0.1', '224.0.0.1', 'not-an-ip']) assert.equal(isPublicAddress(ip), false, ip);
  const dns = (map: Record<string, string[]>) => async (h: string) => map[h] ?? [];
  await assertPublicUrl('https://example.com/x', dns({ 'example.com': ['93.184.215.14'] }));
  await assert.rejects(assertPublicUrl('http://metadata.internal/', dns({ 'metadata.internal': ['169.254.169.254'] })), /not a public internet address/);
  await assert.rejects(assertPublicUrl('http://mixed.example/', dns({ 'mixed.example': ['93.184.215.14', '10.0.0.5'] })), /not a public/, 'every address must be public');
  await assert.rejects(assertPublicUrl('http://[::1]:8080/'), /not a public/);
  await assert.rejects(assertPublicUrl('http://127.0.0.1/'), /not a public/);
  // A public page that redirects to a private one is refused at the redirect.
  const seen: string[] = [];
  const fake = (async (u: string) => { seen.push(u); return u.includes('public') ? new Response(null, { status: 302, headers: { location: 'http://10.0.0.5/admin' } }) : new Response('<title>secret</title>', { headers: { 'content-type': 'text/html' } }); }) as typeof fetch;
  const guard = async (u: string) => { if (new URL(u).hostname === '10.0.0.5') throw Error('private'); };
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'hvnt33-guard-'));
  try {
    await assert.rejects(fetchCapture(fake).capture('https://public.example/', dir, { guard }), /private/);
    assert.deepEqual(seen, ['https://public.example/'], 'the private address was never requested');
    const ok = await fetchCapture(fake).capture('https://public.example/', dir);
    assert.deepEqual([ok.finalUrl, ok.title], ['http://10.0.0.5/admin', 'secret'], 'without a guard (local mode) redirects are followed');
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
});

// ── Through the API ──────────────────────────────────────────────────────────

let h: Harness;
let page = { title: 'Harbor Works — Board', body: '<h1>Board members</h1><p>Jane Vale, chair</p><p>Tom Reed, treasurer</p>' };
let site: http.Server, siteUrl = '';
const cleanup: string[] = [];

before(async () => {
  h = await start();
  site = http.createServer((req, res) => {
    if (req.url === '/board') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(`<html><head><title>${page.title}</title></head><body>${page.body}</body></html>`); }
    else { res.writeHead(404); res.end('missing'); }
  });
  site.listen(0, '127.0.0.1');
  await new Promise(r => site.once('listening', r));
  siteUrl = `http://127.0.0.1:${(site.address() as AddressInfo).port}/board`;
});
after(async () => { for (const id of cleanup) await removeInvestigation(h.graph, id); site.close(); await h.close(); });

async function waitFor<T>(what: string, fn: () => Promise<T | null | undefined | false>, ms = 20_000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) throw Error(`Timed out waiting for ${what}`); await new Promise(r => setTimeout(r, 200)); }
}

test('snapshots archive a page, detect changes between captures, and export verifiable evidence', async () => {
  const inv = await h.a.api('/api/investigations', { title: 'TEST — own archive' });
  cleanup.push(inv.id);
  const job = await h.a.call('/api/snapshots', { investigationId: inv.id, url: siteUrl });
  assert.equal(job.status, 202);
  const [first] = await waitFor('first snapshot', async () => { const s = await h.a.api(`/api/investigations/${inv.id}/snapshots`); return s.length === 1 && s; });
  assert.deepEqual([first.method, first.status, first.title, first.changed, first.trigger], ['fetch', 200, 'Harbor Works — Board', null, 'manual']);
  assert.equal(first.resources.count, 1);
  assert.deepEqual(first.resources.statuses, ['200']);
  assert.ok(first.resources.mimeTypes.includes('text/html'));
  assert.ok(first.resources.responseHeaders.includes('content-type'));
  assert.deepEqual(first.timestampErrors.map((e: any) => e.tsa), ['offline-test'], 'missing timestamps are recorded, not hidden');

  page = { ...page, body: '<h1>Board members</h1><p>Jane Vale, chair</p><p>Ann Cole, treasurer</p><p>Updated September 2026</p>' };
  await h.a.api('/api/snapshots', { investigationId: inv.id, url: siteUrl });
  const snaps = await waitFor('second snapshot', async () => { const s = await h.a.api(`/api/investigations/${inv.id}/snapshots`); return s.length === 2 && s; });
  const second = snaps[0];
  assert.equal(second.changed, true);
  assert.equal(second.previousId, first.id);
  const [change] = await h.a.api(`/api/investigations/${inv.id}/page-changes`);
  assert.deepEqual([change.fromSnapshotId, change.toSnapshotId, change.added, change.removed, change.seen], [first.id, second.id, 2, 1, false]);
  assert.deepEqual(change.removedLines, ['Tom Reed, treasurer']);
  assert.deepEqual(change.addedLines, ['Ann Cole, treasurer', 'Updated September 2026']);
  const diff = await h.a.api(`/api/page-changes/${change.id}/diff`);
  assert.deepEqual(diff.parts.map((p: any) => p.kind), ['same', 'removed', 'added']);
  assert.equal((await h.a.api(`/api/page-changes/${change.id}`, { seen: true }, 'PATCH')).seen, true);
  // The agent reads the same through the research CLI.
  assert.deepEqual((await h.a.cli('page-changes', '--case', inv.id)).map((c: any) => c.id), [change.id]);
  assert.equal((await h.a.cli('page-text', '--snapshot', second.id)).text, 'Board members\nJane Vale, chair\nAnn Cole, treasurer\nUpdated September 2026');
  assert.deepEqual((await h.a.cli('page-diff', '--change', change.id)).parts.map((p: any) => p.kind), ['same', 'removed', 'added']);

  // Unchanged content: a snapshot, but no change.
  await h.a.api('/api/snapshots', { investigationId: inv.id, url: siteUrl });
  const three = await waitFor('third snapshot', async () => { const s = await h.a.api(`/api/investigations/${inv.id}/snapshots`); return s.length === 3 && s; });
  assert.equal(three[0].changed, false);
  assert.equal((await h.a.api(`/api/investigations/${inv.id}/page-changes`)).length, 1);

  // Evidence package: every file present and matching its checksum and the manifest.
  const res = await h.a.call(`/api/snapshots/${second.id}/evidence`);
  assert.equal(res.status, 200);
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'hvnt33-ev-'));
  try {
    const zipFile = path.join(dir, 'e.zip');
    await fsp.writeFile(zipFile, Buffer.from(await res.res.arrayBuffer()));
    const zip = await new Promise<yauzl.ZipFile>((ok, no) => yauzl.open(zipFile, { lazyEntries: true }, (e, z) => (e ? no(e) : ok(z!))));
    const files: Record<string, Buffer> = {};
    await new Promise<void>((ok, no) => {
      zip.on('entry', (entry: yauzl.Entry) => zip.openReadStream(entry, async (e, s) => { if (e) return no(e); const c: Buffer[] = []; for await (const x of s!) c.push(x as Buffer); files[entry.fileName] = Buffer.concat(c); zip.readEntry(); }));
      zip.on('end', ok); zip.readEntry();
    });
    assert.deepEqual(Object.keys(files).sort(), ['SHA256SUMS', 'VERIFY.txt', 'custody.json', 'manifest.json', 'snapshot.wacz', 'text.txt']);
    for (const line of files.SHA256SUMS.toString().trim().split('\n')) {
      const [hash, name] = line.split(/\s+/);
      assert.equal(createHash('sha256').update(files[name]).digest('hex'), hash, name);
    }
    const manifest = JSON.parse(files['manifest.json'].toString());
    assert.equal(manifest.files.wacz.sha256, createHash('sha256').update(files['snapshot.wacz']).digest('hex'));
    assert.equal(files['text.txt'].toString(), 'Board members\nJane Vale, chair\nAnn Cole, treasurer\nUpdated September 2026');
    assert.match(files['VERIFY.txt'].toString(), /no timestamp tokens were obtained/);
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
});

test('a capture can carry a snapshot of the page it came from', async () => {
  const inv = await h.a.api('/api/investigations', { title: 'TEST — capture snapshot' });
  cleanup.push(inv.id);
  const other = await h.a.api('/api/investigations', { title: 'TEST — other case' });
  cleanup.push(other.id);
  const intake = await h.a.api('/api/intakes', { investigationId: inv.id, text: 'Jane Vale, chair', title: 'Board page', sourceUrl: siteUrl });
  assert.equal((await h.a.call('/api/snapshots', { investigationId: other.id, url: siteUrl, intakeId: intake.id })).status, 404, 'a capture from another case');
  await h.a.api('/api/snapshots', { investigationId: inv.id, url: siteUrl, intakeId: intake.id });
  const [snap] = await waitFor('snapshot', async () => { const s = await h.a.api(`/api/investigations/${inv.id}/snapshots`); return s.length === 1 && s; });
  assert.deepEqual([snap.trigger, snap.intakeId], ['capture', intake.id]);
  const [summary] = await h.a.api(`/api/investigations/${inv.id}/intakes`);
  assert.deepEqual(summary.snapshot, { id: snap.id, capturedAt: snap.capturedAt, method: 'fetch' });
});

test('watches capture now and on schedule, can pause, and never double-run', async () => {
  const inv = await h.a.api('/api/investigations', { title: 'TEST — watches' });
  cleanup.push(inv.id);
  const w = await h.a.api('/api/watches', { investigationId: inv.id, url: siteUrl, everyHours: 24 });
  assert.equal((await h.a.call('/api/watches', { investigationId: inv.id, url: siteUrl, everyHours: 6 })).json.id, w.id, 'one watch per page and case');
  const [snap] = await waitFor('watch capture', async () => { const s = await h.a.api(`/api/investigations/${inv.id}/snapshots`); return s.length === 1 && s; });
  assert.deepEqual([snap.trigger, snap.watchId], ['watch', w.id]);
  const [watched] = await waitFor('watch update', async () => { const ws = await h.a.api(`/api/investigations/${inv.id}/watches`); return ws[0].lastSnapshotId && ws; });
  assert.equal(watched.lastSnapshotId, snap.id);
  assert.ok(Date.parse(watched.nextRunAt) > Date.now() + 23 * 3600_000, 'next capture is a day away');

  const paused = await h.a.api(`/api/watches/${w.id}`, { active: false }, 'PATCH');
  assert.equal(paused.active, false);
  await h.a.api(`/api/watches/${w.id}`, { active: true, everyHours: 1 }, 'PATCH');
  await h.a.api(`/api/watches/${w.id}/run`, {});
  const two = await waitFor('second watch capture', async () => { const s = await h.a.api(`/api/investigations/${inv.id}/snapshots`); return s.length === 2 && s; });
  await waitFor('watch to record it', async () => (await h.a.api(`/api/investigations/${inv.id}/watches`))[0].lastSnapshotId === two[0].id);
  // Two schedulers racing for the same due watch: only one wins the claim.
  await h.graph.sql('UPDATE Watch SET nextRunAt=:t WHERE id=:id', { id: w.id, t: new Date(0).toISOString() });
  const { runDueWatches } = await import('../src/domain/snapshots.ts');
  const deps = { graph: h.graph, entitlements: { require: async () => {}, record: async () => {}, usage: async () => ({ plan: 'x', metrics: {} }) }, jobs: { enqueue: async () => ({}) } } as never;
  const counts = await Promise.all([runDueWatches(deps), runDueWatches(deps), runDueWatches(deps)]);
  assert.equal(counts.reduce((a, b) => a + b, 0), 1);
  await h.a.api(`/api/watches/${w.id}`, undefined, 'DELETE');
  assert.equal((await h.a.api(`/api/investigations/${inv.id}/watches`)).length, 0);
  assert.equal((await h.a.api(`/api/investigations/${inv.id}/snapshots`)).length, 2, 'snapshots outlive the watch');
});

test('replay runs on its own origin with a signed link; the API refuses other sites', async () => {
  const inv = await h.a.api('/api/investigations', { title: 'TEST — replay' });
  cleanup.push(inv.id);
  await h.a.api('/api/snapshots', { investigationId: inv.id, url: siteUrl });
  const [snap] = await waitFor('snapshot', async () => { const s = await h.a.api(`/api/investigations/${inv.id}/snapshots`); return s.length === 1 && s; });
  const link = await h.a.api(`/api/snapshots/${snap.id}/replay-url`);
  const url = new URL(link.url);
  assert.equal(url.origin, h.replayBase, 'links point at the replay origin');
  assert.notEqual(url.origin, h.base);
  assert.equal((await h.a.api('/api/health')).replayUrl, h.replayBase);
  const page = await fetch(link.url);
  assert.equal(page.status, 200);
  assert.match(await page.text(), new RegExp(`<replay-web-page source="/replay/${snap.id}/archive\\.wacz\\?t=`));
  const token = url.searchParams.get('t')!;
  const wacz = await fetch(`${h.replayBase}/replay/${snap.id}/archive.wacz?t=${encodeURIComponent(token)}`);
  assert.equal(wacz.status, 200, 'the link reads the archive without an API token');
  assert.equal(wacz.headers.get('content-type'), 'application/wacz');
  assert.equal(Buffer.from(await wacz.arrayBuffer()).subarray(0, 2).toString(), 'PK');
  assert.equal((await fetch(`${h.replayBase}/replay/${snap.id}/archive.wacz?t=${encodeURIComponent(token.slice(0, -2) + 'xx')}`)).status, 401, 'tampered');
  assert.equal((await fetch(`${h.replayBase}/replay/${snap.id}/archive.wacz`)).status, 401, 'no link');
  assert.equal((await fetch(`${h.replayBase}/replay/${snap.id}?t=bad`)).status, 401);
  assert.equal((await fetch(`${h.replayBase}/replay/sw.js`)).headers.get('service-worker-allowed'), '/replay/');
  // The replay origin has no API at all, with or without credentials.
  for (const route of ['/api/investigations', `/api/snapshots/${snap.id}/files/wacz`, '/api/health', '/']) {
    assert.equal((await fetch(h.replayBase + route, { headers: h.a.headers })).status, 404, route);
  }
  // On the main origin: the web workspace (same origin) works; pages of other sites,
  // including the replay origin (same site, other port), do not.
  assert.equal((await h.a.call('/api/investigations', undefined, 'GET', { 'Sec-Fetch-Site': 'same-origin', 'Sec-Fetch-Mode': 'cors' })).status, 200, 'web workspace');
  for (const siteKind of ['same-site', 'cross-site']) {
    assert.equal((await h.a.call('/api/investigations', undefined, 'GET', { 'Sec-Fetch-Site': siteKind, 'Sec-Fetch-Mode': 'no-cors' })).status, 403, siteKind);
    assert.equal((await h.a.call(`/api/snapshots/${snap.id}/replay-url`, undefined, 'GET', { 'Sec-Fetch-Site': siteKind, 'Sec-Fetch-Mode': 'navigate' })).status, 403, `${siteKind} navigation`);
  }
  assert.equal((await h.a.call('/api/investigations', { title: 'x' }, 'POST', { 'Sec-Fetch-Site': 'same-site', Origin: h.replayBase })).status, 403, 'a replayed page posting');
});

test('with the guard on, private pages are refused up front', async () => {
  const inv = await h.a.api('/api/investigations', { title: 'TEST — guard' });
  cleanup.push(inv.id);
  h.config.snapshots.allowPrivateUrls = false;
  try {
    for (const route of ['/api/snapshots', '/api/watches']) {
      const r = await h.a.call(route, { investigationId: inv.id, url: siteUrl });
      assert.deepEqual([r.status, r.json.code], [400, 'private_address'], route);
    }
  } finally {
    h.config.snapshots.allowPrivateUrls = true;
  }
});

test('snapshot routes respect workspaces and plans', { skip: profile !== 'token' }, async () => {
  const inv = await h.a.api('/api/investigations', { title: 'TEST — private archive' });
  cleanup.push(inv.id);
  const w = await h.a.api('/api/watches', { investigationId: inv.id, url: siteUrl, everyHours: 24 });
  const [snap] = await waitFor('snapshot', async () => { const s = await h.a.api(`/api/investigations/${inv.id}/snapshots`); return s.length === 1 && s; });
  const b = h.b!;
  for (const [method, route, body] of [
    ['GET', `/api/investigations/${inv.id}/snapshots`], ['GET', `/api/snapshots/${snap.id}`], ['GET', `/api/snapshots/${snap.id}/replay-url`],
    ['GET', `/api/snapshots/${snap.id}/files/wacz`], ['GET', `/api/snapshots/${snap.id}/evidence`], ['GET', `/api/investigations/${inv.id}/watches`],
    ['PATCH', `/api/watches/${w.id}`, { active: false }], ['POST', `/api/watches/${w.id}/run`, {}], ['DELETE', `/api/watches/${w.id}`],
    ['GET', `/api/investigations/${inv.id}/page-changes`], ['POST', '/api/snapshots', { investigationId: inv.id, url: siteUrl }],
    ['POST', '/api/watches', { investigationId: inv.id, url: siteUrl }],
  ] as [string, string, unknown?][]) {
    assert.equal((await b.call(route, body, method)).status, 404, `B: ${method} ${route}`);
  }
  const c = h.limited!;
  const [cinv] = (await c.api('/api/investigations')).length ? await c.api('/api/investigations') : [await c.api('/api/investigations', { title: 'TEST — tiny archive' })];
  assert.equal((await c.call('/api/watches', { investigationId: cinv.id, url: siteUrl })).status, 402, 'watches are a plan feature');
  assert.equal((await c.call('/api/snapshots', { investigationId: cinv.id, url: siteUrl })).status, 202);
  assert.equal((await c.call('/api/snapshots', { investigationId: cinv.id, url: siteUrl })).status, 402, 'monthly snapshots are limited');
});
