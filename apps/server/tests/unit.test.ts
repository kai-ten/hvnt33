// Pure logic: no server, no database.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateDraft, generateDraft, draftSchema, browserCapture } from '../src/domain/intake.ts';
import { validateRun, validateSaved } from '../src/domain/searches.ts';
import { validateVisit } from '../src/domain/visits.ts';
import { archiveUrl, waybackTime, parseCdx, summarize, fetchWaybackHistory, savePageNow } from '../src/domain/archive.ts';
import { csv } from '../src/domain/presentation.ts';
import { createJobQueue, memoryJobStore, RetryableError } from '../src/seams/jobs.ts';
import { Api } from '../src/http.ts';
import { z } from 'zod';

import { draftInput, original } from './fixtures.ts';
const json = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) }) as unknown as Response;

test('Drafts require source excerpts and valid references; exact entity matches are offered for reuse', () => {
  const draft = validateDraft(draftInput, original, [{ id: 'same', kind: 'Person', title: 'JANE VALE' }]);
  assert.equal(draft.records[0].matchId, 'same');
  assert.throws(() => validateDraft({ ...draftInput, records: [{ ...draftInput.records[0], quote: 'Fabricated sentence' }] }, original), /exact excerpt/);
  assert.throws(() => validateDraft({ ...draftInput, connections: [{ ...draftInput.connections[0], toKey: 'invented' }] }, original), /proposed records/);
  assert.throws(() => validateDraft({ ...draftInput, records: [{ ...draftInput.records[0], eventDate: '2026-02-31' }] }, original), /real YYYY/);
  assert.equal(validateDraft(draftInput, original, [{ id: '1', kind: 'Person', title: 'Jane Vale' }, { id: '2', kind: 'Person', title: 'Jane Vale' }]).records[0].matchId, '', 'ambiguous names are not matched');
});

test('Optional OpenAI adapter requests strict structured drafts without sending attachments', async () => {
  let sent: any;
  const result = await generateDraft({ text: original, sourceUrl: '', sourceLabel: 'Test', attachment: { fileKey: 'PRIVATE-FILE-MARKER' } }, { investigation: { title: 'Test case' }, records: [] }, { apiKey: 'test-key-never-sent', model: 'm' }, async (url, opts) => {
    assert.equal(url, 'https://api.openai.com/v1/responses');
    sent = JSON.parse(String(opts?.body));
    return json(200, { status: 'completed', output: [{ content: [{ type: 'output_text', text: JSON.stringify(draftInput) }] }] });
  });
  assert.deepEqual(result, draftInput);
  assert.equal(sent.store, false);
  assert.equal(sent.text.format.strict, true);
  assert.deepEqual(sent.text.format.schema, draftSchema);
  assert.ok(!JSON.stringify(sent).includes('PRIVATE-FILE-MARKER'));
  assert.ok(sent.instructions.includes('untrusted'));
  await assert.rejects(generateDraft({ text: original }, { investigation: {}, records: [] }, { apiKey: 'k', model: 'm' }, async () => json(200, { status: 'incomplete' })), /incomplete/);
  await assert.rejects(generateDraft({ text: original }, { investigation: {}, records: [] }, { apiKey: '', model: 'm' }), (e: any) => e.status === 503);
});

test('Search runs are cleaned and ranked from what the page showed; URL quality is labelled', () => {
  const run = validateRun({ engine: 'bing', query: '  harbor   works ', url: 'https://www.bing.com/search?q=harbor', results: [
    { title: 'A', url: 'https://www.City.gov/a', snippet: '  one \n two ' }, { title: 'dup', url: 'https://www.city.gov/a' }, { title: '', url: 'https://x.org' },
    { title: 'js', url: 'javascript:alert(1)' }, { title: 'B', url: 'http://b.example/' }] });
  assert.equal(run.query, 'harbor works');
  assert.deepEqual(run.results.map(r => [r.rank, r.url, r.domain]), [[1, 'https://www.city.gov/a', 'city.gov'], [2, 'http://b.example/', 'b.example']]);
  assert.equal(run.results[0].snippet, 'one two');
  assert.throws(() => validateRun({ engine: 'altavista', query: 'x', url: 'https://a.b', results: [] }), /Unknown search engine/);
  assert.throws(() => validateRun({ engine: 'bing', query: '', url: 'https://a.b', results: [] }), /query required/);
  assert.throws(() => validateRun({ engine: 'bing', query: 'x', url: 'file:///etc/passwd', results: [] }), /must start with http/);
  assert.throws(() => validateRun({ engine: 'bing', query: 'x', url: 'https://a.b', results: Array(101).fill({}) }), /up to 100/);
  const google = validateRun({ engine: 'google', query: 'q', url: 'https://www.google.com/search?q=q', results: [
    { title: 'Wiki', url: 'https://en.wikipedia.org/wiki/X', quality: 'display', link: 'https://www.google.com/goto?url=a' },
    { title: 'LinkedIn', url: 'https://www.google.com/goto?url=b', quality: 'opaque', link: 'https://www.google.com/goto?url=b' },
    { title: 'Direct', url: 'https://example.org/', quality: 'made-up', link: 'javascript:alert(1)' }] });
  assert.deepEqual(google.results.map(r => [r.quality, r.link, r.domain]), [['display', 'https://www.google.com/goto?url=a', 'en.wikipedia.org'], ['opaque', 'https://www.google.com/goto?url=b', ''], [undefined, undefined, 'example.org']]);
});

test('Browser capture metadata keeps provenance fields only', () => {
  const meta = browserCapture(JSON.stringify({ mode: 'selection', pageTitle: 'T', engine: 'google', query: 'q', canonical: 'javascript:alert(1)', imageUrl: 'https://img.example/a.png', injected: 'ignored' }))!;
  assert.equal(meta.via, 'hvnt33-desktop');
  assert.equal(meta.imageUrl, 'https://img.example/a.png');
  assert.equal(meta.canonical, undefined);
  assert.equal(meta.injected, undefined);
  assert.ok(meta.capturedAt);
  assert.equal(browserCapture(''), null);
  assert.throws(() => browserCapture('{bad'), /must be JSON/);
  assert.throws(() => browserCapture({ mode: 'keylogger' }), /Invalid capture mode/);
  assert.throws(() => browserCapture({ pageTitle: 5 }), /must be text/);
});

test('Visits keep only safe, bounded metadata; saved searches validate kind and engines', () => {
  const v = validateVisit({ url: 'https://news.example.com/a', title: '  A \n story ', referrer: 'javascript:alert(1)', found: { engine: 'bing', query: 'harbor' },
    meta: { canonical: 'file:///etc/passwd', author: 'R. Reporter', schemaTypes: ['NewsArticle', 5, 'x'.repeat(200)], wordCount: -4, links: { external: 12, domains: [{ domain: 'city.gov', count: 3 }, { domain: 7 }] }, injected: 'no' } });
  assert.equal(v.title, 'A story');
  assert.equal(v.referrer, '');
  assert.deepEqual(v.found, { engine: 'bing', query: 'harbor' });
  assert.equal(v.meta.canonical, '');
  assert.equal(v.meta.schemaTypes.length, 2);
  assert.equal(v.meta.schemaTypes[1].length, 80);
  assert.equal(v.meta.wordCount, 0);
  assert.deepEqual(v.meta.topDomains, [{ domain: 'city.gov', count: 3 }]);
  assert.equal((v.meta as Record<string, unknown>).injected, undefined);
  assert.equal(validateVisit({ url: 'https://a.b', found: { engine: 'altavista', query: 'x' } }).found, null);
  assert.throws(() => validateVisit({ url: 'about:blank' }), /must start with http/);
  assert.deepEqual(validateSaved({ kind: 'web', query: ' harbor  works ', engines: ['google', 'google', 'nope', 'bing'] }), { kind: 'web', query: 'harbor works', engines: ['google', 'bing'], label: '' });
  assert.deepEqual(validateSaved({ kind: 'lab', query: 'sourcetype=serp | compare', engines: ['google'] }).engines, []);
  assert.throws(() => validateSaved({ kind: 'web', query: 'x', engines: [] }), /at least one engine/);
  assert.throws(() => validateSaved({ kind: 'cron', query: 'x' }), /web or lab/);
});

const cdx = [['timestamp', 'original', 'statuscode', 'mimetype', 'digest', 'length'],
  ['20040617052922', 'http://en.wikipedia.org:80/wiki/X', '200', 'text/html', 'AAA', '4534'],
  ['20050215143101', 'http://en.wikipedia.org:80/wiki/X', '200', 'text/html', 'BBB', '5986'],
  ['20260827221254', 'https://en.wikipedia.org/wiki/X', '200', 'text/html', 'CCC', '9001'],
  ['garbage', 'x', '200', '', '', '']];

test('Wayback timestamps, CDX rows and history summaries', () => {
  assert.equal(waybackTime('20040617052922'), '2004-06-17T05:29:22Z');
  assert.equal(waybackTime('2004'), '');
  const snaps = parseCdx(cdx);
  assert.equal(snaps.length, 3, 'rows with invalid timestamps are dropped');
  assert.equal(snaps[0].snapshotUrl, 'https://web.archive.org/web/20040617052922/http://en.wikipedia.org:80/wiki/X');
  const s = summarize('https://en.wikipedia.org/wiki/X', snaps);
  assert.deepEqual([s.versions, s.first, s.last, s.byYear, s.truncated], [3, '2004-06-17T05:29:22Z', '2026-08-27T22:12:54Z', { 2004: 1, 2005: 1, 2026: 1 }, false]);
  assert.equal(archiveUrl('https://a.example/x#frag'), 'https://a.example/x');
  assert.throws(() => archiveUrl('file:///etc/passwd'), /http\(s\) URL/);
});

test('History lookups keep the newest versions, find the true first capture, retry once and report limits', async () => {
  let asked: URL | undefined;
  const h = await fetchWaybackHistory('https://en.wikipedia.org/wiki/X', async url => { asked = new URL(String(url)); return json(200, cdx); });
  assert.deepEqual(Object.fromEntries(['collapse', 'filter', 'limit'].map(k => [k, asked!.searchParams.get(k)])), { collapse: 'digest', filter: 'statuscode:200', limit: '-5000' });
  assert.equal(h.versions, 3);
  const asks: (string | null)[] = [];
  const long = await fetchWaybackHistory('https://a.example/', async url => {
    const q = new URL(String(url)).searchParams;
    asks.push(q.get('limit'));
    return json(200, q.get('limit') === '1' ? [cdx[0], ['19990101000000', 'http://a.example/', '200', 'text/html', 'Z', '1']] : [cdx[0], cdx[2], cdx[3]]);
  }, 2);
  assert.deepEqual(asks, ['-2', '1']);
  assert.deepEqual([long.truncated, long.first], [true, '1999-01-01T00:00:00Z']);
  await assert.rejects(fetchWaybackHistory('https://a.example/', async () => json(429, 'slow')), (e: any) => e.status === 429);
  let tries = 0;
  const flaky = await fetchWaybackHistory('https://a.example/', async () => { if (++tries === 1) throw Object.assign(Error('t'), { name: 'TimeoutError' }); return json(200, cdx); });
  assert.equal(flaky.versions, 3);
  await assert.rejects(fetchWaybackHistory('https://a.example/', async () => { throw Object.assign(Error('t'), { name: 'TimeoutError' }); }), (e: any) => e.status === 504);
});

test('Save Page Now: authenticated capture, polling, rate limits and errors', async () => {
  const keys = { accessKey: 'KEY', secretKey: 'SECRET' };
  const opts = (fetcher: typeof fetch) => ({ fetcher, sleep: async () => {}, pollMs: 0 });
  await assert.rejects(savePageNow('https://a.example/', { accessKey: '', secretKey: '' }, opts(async () => json(200, {}))), /needs archive.org API keys/);
  const calls: { url: string; auth?: string; body?: string }[] = [];
  let polls = 0;
  const ok = await savePageNow('https://a.example/page', keys, opts(async (url, init) => {
    calls.push({ url: String(url), auth: (init?.headers as Record<string, string>)?.Authorization, body: init?.body as string });
    if (String(url).endsWith('/save')) return json(200, { job_id: 'spn2-abc' });
    return json(200, ++polls < 3 ? { status: 'pending' } : { status: 'success', timestamp: '20260918151703', original_url: 'https://a.example/page' });
  }));
  assert.deepEqual(ok, { jobId: 'spn2-abc', timestamp: '20260918151703', capturedAt: '2026-09-18T15:17:03Z', snapshotUrl: 'https://web.archive.org/web/20260918151703/https://a.example/page' });
  assert.equal(calls[0].auth, 'LOW KEY:SECRET');
  assert.equal(calls.at(-1)!.url, 'https://web.archive.org/save/status/spn2-abc');
  await assert.rejects(savePageNow('https://a.example/', keys, opts(async () => json(429, {}))), (e: any) => e instanceof RetryableError);
  await assert.rejects(savePageNow('https://a.example/', keys, opts(async () => json(401, {}))), /rejected the API keys/);
  const failing = (status: object) => opts(async url => (String(url).endsWith('/save') ? json(200, { job_id: 'j' }) : json(200, { status: 'error', ...status })));
  await assert.rejects(savePageNow('https://a.example/', keys, failing({ status_ext: 'error:too-many-daily-captures' })), (e: any) => e instanceof RetryableError);
  await assert.rejects(savePageNow('https://a.example/', keys, failing({ message: 'This URL is excluded' })), /This URL is excluded/);
});

test('Job queue runs, spaces, retries with backoff and recovers only stale work', async () => {
  const store = memoryJobStore(), ran: unknown[] = [];
  let flaky = 0;
  const queue = createJobQueue({ store, log: { error() {} }, handlers: {
    ok: { run: async (p: { n: number }) => { ran.push(p.n); return p; } },
    flaky: { maxAttempts: 3, run: async () => { if (++flaky < 3) throw new RetryableError('busy', 5); return 'fine'; } },
    broken: { run: async () => { throw Error('permanent'); } },
    spaced: { minIntervalMs: 60, run: async (p: { n: number }) => { ran.push(`s${p.n}`); return null; } },
  } });
  const scope = { workspaceId: 'ws', investigationId: 'c' };
  await queue.enqueue('ok', { n: 1 }, scope);
  const f = await queue.enqueue('flaky', {}, scope);
  const b = await queue.enqueue('broken', {}, scope);
  await assert.rejects(queue.enqueue('nope', {}, scope), /Unknown job kind/);
  const until = Date.now() + 2000;
  while (Date.now() < until && [...store.jobs.values()].some(j => j.state === 'queued' || j.state === 'running')) await new Promise(r => setTimeout(r, 10));
  assert.deepEqual([(await queue.get(f.id))!.state, (await queue.get(f.id))!.attempts], ['done', 3]);
  assert.deepEqual([(await queue.get(b.id))!.state, (await queue.get(b.id))!.error], ['failed', 'permanent']);
  assert.equal((await queue.list('ws', 'c')).length, 3);
  assert.equal((await queue.list('other-ws', 'c')).length, 0, 'jobs are listed per workspace');
  const t0 = Date.now();
  await queue.enqueue('spaced', { n: 1 }, scope);
  await queue.enqueue('spaced', { n: 2 }, scope);
  while (Date.now() - t0 < 2000 && !ran.includes('s2')) await new Promise(r => setTimeout(r, 5));
  assert.ok(Date.now() - t0 >= 55);
  queue.stop();

  const store2 = memoryJobStore(), old = new Date(Date.now() - 11 * 60 * 1000).toISOString(), fresh = new Date().toISOString();
  const job = (id: string, t: string) => ({ id, kind: 'ok', workspaceId: 'ws', investigationId: 'c', payload: { n: 9 }, state: 'running' as const, attempts: 1, runAfter: t, createdAt: t, updatedAt: t, result: null, error: '' });
  await store2.insert(job('stale', old));
  await store2.insert(job('live', fresh));
  const q2 = createJobQueue({ store: store2, log: { error() {} }, handlers: { ok: { run: async (p: { n: number }) => p.n } } });
  await q2.start();
  while (store2.jobs.get('stale')!.state !== 'done') await new Promise(r => setTimeout(r, 5));
  assert.equal(store2.jobs.get('live')!.state, 'running', "another live server's job is left alone");
  q2.stop();
});

test('CSV neutralizes spreadsheet formulas', () => {
  assert.equal(csv([{ a: '=HYPERLINK("x")', b: 'plain "quoted"' }], ['a', 'b']), 'a,b\r\n"\'=HYPERLINK(""x"")","plain ""quoted"""');
});

test('Route registry validates input and documents every route in OpenAPI', () => {
  const api = new Api();
  api.route({ method: 'post', path: '/api/things/:id', summary: 'Make a thing', tags: ['T'], params: z.object({ id: z.string() }), body: z.object({ name: z.string().max(5) }), response: z.object({ ok: z.boolean() }), status: 201, handler: () => ({ ok: true }) });
  const spec = api.openapi({ title: 't', version: '1', description: 'd' }) as any;
  const op = spec.paths['/api/things/{id}'].post;
  assert.equal(op.parameters[0].name, 'id');
  assert.equal(op.requestBody.content['application/json'].schema.properties.name.maxLength, 5);
  assert.ok(op.responses['201'].content['application/json']);
  assert.equal(op.operationId, 'postApiThingsId');
});

test('Captures in the app browser become a WACZ with every response and the screenshot; files stay in the capture folder', async () => {
  const { appCapture } = await import('../src/seams/capture.ts');
  const { readWacz, warcRecords } = await import('../src/archive/wacz.ts');
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const yauzl = (await import('yauzl')).default;
  const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'hvnt33-appcap-'));
  try {
    let asked: any = null;
    const channel = {
      async request<T>(type: string, payload: any): Promise<T> {
        asked = { type, payload };
        fs.writeFileSync(path.join(payload.workDir, 'body-0001'), '<html><title>Harbor</title><img src="/a.png"></html>');
        fs.writeFileSync(path.join(payload.workDir, 'body-0002'), png);
        fs.writeFileSync(path.join(payload.workDir, 'shot.png'), png);
        return {
          finalUrl: 'https://example.org/board', status: 200, title: 'Harbor', text: 'Harbor board\nRevision 1', mime: 'text/html', capturedAt: '2026-09-18T12:00:00.000Z',
          screenshot: 'shot.png', notes: [],
          responses: [
            { url: 'https://example.org/board', status: 200, statusText: 'OK', headers: [['content-type', 'text/html'], ['content-encoding', 'br']], mime: 'text/html', file: 'body-0001' },
            { url: 'https://example.org/a.png', status: 200, statusText: 'OK', headers: [['content-type', 'image/png']], mime: 'image/png', file: 'body-0002' },
          ],
        } as T;
      },
    };
    const route = { url: 'socks5://127.0.0.1:9050', kind: 'socks5' as const, host: '127.0.0.1', port: 9050 };
    const got = await appCapture(channel).capture('https://example.org/board', work, { route });
    assert.deepEqual(asked, { type: 'capture', payload: { url: 'https://example.org/board', workDir: work, route: 'socks5://127.0.0.1:9050' } });
    assert.equal(got.method, 'browser');
    assert.equal(got.screenshotPath, path.join(work, 'shot.png'));
    const wacz = await readWacz(got.waczPath);
    assert.deepEqual(wacz.pages.map(p => [p.url, p.title, p.status, p.text]), [['https://example.org/board', 'Harbor', 200, 'Harbor board\nRevision 1']]);
    assert.deepEqual(wacz.screenshot, png, 'the screenshot is stored as Webrecorder tools store it');
    // Every response is indexed, and stored decoded (no content-encoding header left).
    const zip: any = await new Promise((res, rej) => yauzl.open(got.waczPath, { lazyEntries: true }, (e, z) => (e ? rej(e) : res(z))));
    const files: Record<string, Buffer> = {};
    await new Promise<void>((res, rej) => {
      zip.on('entry', (entry: any) => zip.openReadStream(entry, (e: any, s: any) => { if (e) return rej(e); const c: Buffer[] = []; s.on('data', (d: Buffer) => c.push(d)); s.on('end', () => { files[entry.fileName] = Buffer.concat(c); zip.readEntry(); }); }));
      zip.on('end', res); zip.readEntry();
    });
    const index = files['indexes/index.cdxj'].toString().trim().split('\n');
    assert.equal(index.length, 3, 'two responses and the screenshot');
    assert.deepEqual([...index].sort(), index, 'the index is sorted');
    const responses = [];
    for await (const r of warcRecords(files['archive/data.warc.gz'])) if (r.warcType === 'response') responses.push([r.warcTargetURI, r.httpHeaders?.headers.get('content-encoding') ?? null]);
    assert.deepEqual(responses, [['https://example.org/board', null], ['https://example.org/a.png', null]]);

    // The app names files; one outside the capture folder is refused.
    const escaping = { request: async () => ({ finalUrl: 'https://example.org/', status: 200, title: '', text: '', mime: 'text/html', capturedAt: '2026-09-18T12:00:00.000Z', screenshot: null, notes: [], responses: [{ url: 'https://example.org/', status: 200, statusText: 'OK', headers: [], mime: 'text/html', file: '../../etc/hosts' }] }) } as any;
    await assert.rejects(appCapture(escaping).capture('https://example.org/', work), /outside the capture folder/);
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
});
