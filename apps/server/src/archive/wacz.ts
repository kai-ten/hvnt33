import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGunzip } from 'node:zlib';
import { ZipArchive } from 'archiver';
import yauzl from 'yauzl';
import { WARCParser, WARCRecord, WARCSerializer } from 'warcio';

/**
 * WACZ (Web Archive Collection Zipped): the Webrecorder standard for portable
 * web archives. A ZIP of WARC data, a CDXJ index, a pages list and a signed
 * data package, replayable offline in ReplayWeb.page.
 */

export interface WaczPage { url: string; title: string; status: number; ts: string; text: string; mime: string }
export interface WaczContents { pages: WaczPage[]; screenshot: Buffer | null; entries: string[] }

function openZip(file: string): Promise<yauzl.ZipFile> {
  return new Promise((resolve, reject) => yauzl.open(file, { lazyEntries: true, autoClose: false }, (e, z) => (e ? reject(e) : resolve(z!))));
}

async function entryBuffer(zip: yauzl.ZipFile, entry: yauzl.Entry): Promise<Buffer> {
  const stream = await new Promise<Readable>((resolve, reject) => zip.openReadStream(entry, (e, s) => (e ? reject(e) : resolve(s!))));
  const chunks: Buffer[] = [];
  for await (const c of stream) chunks.push(c as Buffer);
  return Buffer.concat(chunks);
}

/** Read the pages (with extracted text) and the page screenshot from a WACZ. */
export async function readWacz(file: string): Promise<WaczContents> {
  const zip = await openZip(file);
  const out: WaczContents = { pages: [], screenshot: null, entries: [] };
  try {
    await new Promise<void>((resolve, reject) => {
      zip.on('entry', async (entry: yauzl.Entry) => {
        try {
          out.entries.push(entry.fileName);
          if (/^pages\/pages\.jsonl$/.test(entry.fileName)) {
            for (const line of (await entryBuffer(zip, entry)).toString('utf8').split('\n')) {
              if (!line.trim()) continue;
              const p = JSON.parse(line);
              if (p.format || !p.url) continue;
              out.pages.push({ url: p.url, title: p.title ?? '', status: Number(p.status ?? 0), ts: p.ts ?? '', text: p.text ?? '', mime: p.mime ?? '' });
            }
          } else if (/^archive\/screenshots-.*\.warc(\.gz)?$/.test(entry.fileName)) {
            const data = await entryBuffer(zip, entry);
            for await (const record of WARCParser.iterRecords([new Uint8Array(data)])) {
              if (record.warcTargetURI?.startsWith('urn:view:') && record.warcContentType === 'image/png') out.screenshot = Buffer.from(await record.readFully());
            }
          }
          zip.readEntry();
        } catch (e) { reject(e); }
      });
      zip.on('end', resolve);
      zip.on('error', reject);
      zip.readEntry();
    });
  } finally {
    zip.close();
  }
  return out;
}

// ── Writing ──────────────────────────────────────────────────────────────────

/** Sort-friendly URI key used by CDXJ indexes: `com,example)/path?q`. */
export function surt(raw: string): string {
  const u = new URL(raw);
  const host = u.hostname.toLowerCase().replace(/^www\d*\./, '').split('.').reverse().join(',');
  const port = u.port && !((u.protocol === 'http:' && u.port === '80') || (u.protocol === 'https:' && u.port === '443')) ? `:${u.port}` : '';
  const query = [...u.searchParams].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join('&');
  return `${host}${port})${u.pathname.toLowerCase()}${query ? `?${query}` : ''}`;
}

const timestamp14 = (iso: string) => iso.replace(/[-:T]/g, '').slice(0, 14);
const sha256 = (b: Buffer | Uint8Array) => createHash('sha256').update(b).digest('hex');

/** One HTTP response as it was received (body decoded). */
export interface ArchivedResponse {
  url: string; method?: string; status: number; statusText: string; headers: [string, string][]; body: Buffer; mime: string;
  /** When it was received; defaults to the capture time. */
  date?: string;
}

/** A captured page: its main document, every response it loaded, its text and a screenshot. */
export interface ArchiveCapture {
  mainUrl: string; capturedAt: string; title: string; text: string; status: number; mime: string;
  responses: ArchivedResponse[];
  /** PNG of the page as displayed. */
  screenshot?: Buffer | null;
  software: string;
}

/** Headers describing the transfer, not the (decoded) body we store. */
const TRANSFER = /^(content-encoding|transfer-encoding|content-length)$/i;

/** Write a WACZ: the responses as WARC records with a CDXJ index, the page's text, and its screenshot. */
export async function writeArchive(file: string, c: ArchiveCapture): Promise<void> {
  const date = c.capturedAt;
  const info = WARCRecord.createWARCInfo({ filename: 'data.warc.gz', warcVersion: 'WARC/1.1' }, { software: c.software, format: 'WARC File Format 1.1' });
  const parts: Uint8Array[] = [await WARCSerializer.serialize(info, { gzip: true })];
  let offset = parts[0].length;
  const index: string[] = [];
  for (const r of c.responses) {
    const at = r.date ?? date;
    const u = new URL(r.url);
    const request = WARCRecord.create({
      url: r.url, date: at, type: 'request', warcVersion: 'WARC/1.1',
      httpHeaders: { Host: u.host }, statusline: `${r.method ?? 'GET'} ${u.pathname}${u.search} HTTP/1.1`,
    }, []);
    const response = WARCRecord.create({
      url: r.url, date: at, type: 'response', warcVersion: 'WARC/1.1',
      httpHeaders: Object.fromEntries(r.headers.filter(([k]) => !TRANSFER.test(k))),
      statusline: `HTTP/1.1 ${r.status} ${r.statusText || 'OK'}`,
    }, [new Uint8Array(r.body)]);
    const req = await WARCSerializer.serialize(request, { gzip: true });
    const res = await WARCSerializer.serialize(response, { gzip: true });
    parts.push(req);
    offset += req.length;
    index.push(`${surt(r.url)} ${timestamp14(at)} ${JSON.stringify({ url: r.url, mime: r.mime, status: String(r.status), digest: `sha256:${sha256(r.body)}`, length: String(res.length), offset: String(offset), filename: 'data.warc.gz' })}`);
    parts.push(res);
    offset += res.length;
  }
  const files: [string, Buffer][] = [['archive/data.warc.gz', Buffer.concat(parts)]];
  if (c.screenshot) {
    // As Webrecorder's tools store it: a resource record for urn:view:<page>.
    const shot = WARCRecord.create({ url: `urn:view:${c.mainUrl}`, date, type: 'resource', warcVersion: 'WARC/1.1', warcHeaders: { 'Content-Type': 'image/png' } }, [new Uint8Array(c.screenshot)]);
    const bytes = await WARCSerializer.serialize(shot, { gzip: true });
    files.push(['archive/screenshots-hvnt33.warc.gz', Buffer.from(bytes)]);
    index.push(`urn:view:${c.mainUrl} ${timestamp14(date)} ${JSON.stringify({ url: `urn:view:${c.mainUrl}`, mime: 'image/png', status: '200', digest: `sha256:${sha256(c.screenshot)}`, length: String(bytes.length), offset: '0', filename: 'screenshots-hvnt33.warc.gz' })}`);
  }
  index.sort();
  const pages = [
    JSON.stringify({ format: 'json-pages-1.0', id: 'pages', title: 'All Pages', hasText: true }),
    JSON.stringify({ id: sha256(Buffer.from(c.mainUrl)).slice(0, 32), url: c.mainUrl, title: c.title, ts: date, status: c.status, mime: c.mime, text: c.text }),
  ].join('\n') + '\n';
  files.push(['indexes/index.cdxj', Buffer.from(index.join('\n') + '\n')], ['pages/pages.jsonl', Buffer.from(pages)]);
  const datapackage = Buffer.from(JSON.stringify({
    profile: 'data-package', wacz_version: '1.1.1', title: c.title || c.mainUrl, mainPageURL: c.mainUrl, mainPageDate: date,
    created: date, software: c.software,
    resources: files.map(([path, data]) => ({ name: path.split('/').pop(), path, hash: `sha256:${sha256(data)}`, bytes: data.length })),
  }, null, 2));
  const digest = Buffer.from(JSON.stringify({ path: 'datapackage.json', hash: `sha256:${sha256(datapackage)}` }));
  const zip = new ZipArchive({ store: true });
  const done = pipeline(zip, fs.createWriteStream(file));
  for (const [name, data] of [...files, ['datapackage.json', datapackage], ['datapackage-digest.json', digest]] as [string, Buffer][]) zip.append(data, { name });
  await zip.finalize();
  await done;
}

export interface FetchedPage {
  requestUrl: string; finalUrl: string; status: number; statusText: string;
  headers: [string, string][]; body: Buffer; capturedAt: string; title: string; text: string; mime: string;
}

/** Write a single-page WACZ from one fetched response (the fetch capture). */
export function writeWacz(file: string, page: FetchedPage): Promise<void> {
  return writeArchive(file, {
    mainUrl: page.finalUrl, capturedAt: page.capturedAt, title: page.title, text: page.text, status: page.status, mime: page.mime,
    responses: [{ url: page.finalUrl, status: page.status, statusText: page.statusText, headers: page.headers, body: page.body, mime: page.mime }],
    software: 'hvnt33 fetch capture',
  });
}

// ── Text extraction (fetch capture) ──────────────────────────────────────────

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', mdash: '—', ndash: '–', hellip: '…', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', copy: '©' };

export function htmlTitle(html: string): string {
  const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  return m ? decode(m[1]).replace(/\s+/g, ' ').trim().slice(0, 300) : '';
}

function decode(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') { const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m; }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** Readable text of an HTML document, one block per line (for change detection). */
export function htmlText(html: string): string {
  const body = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|noscript|template|svg|head)\b[\s\S]*?<\/\1>/gi, '')
    .replace(/<(br|hr)\b[^>]*>/gi, '\n')
    .replace(/<\/(p|div|section|article|header|footer|li|tr|h[1-6]|blockquote|pre|table|ul|ol|nav|main|aside|figure|figcaption|dd|dt)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');
  return decode(body).split('\n').map(l => l.replace(/[ \t ]+/g, ' ').trim()).filter(Boolean).join('\n');
}

/** Stream a gzip WARC to records (used by tests to inspect fetch captures). */
export async function* warcRecords(warcGz: Buffer) {
  const gunzip = createGunzip();
  gunzip.end(warcGz);
  for await (const record of WARCParser.iterRecords(gunzip)) yield record;
}
