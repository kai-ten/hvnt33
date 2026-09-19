import fsp from 'node:fs/promises';
import path from 'node:path';
import { type ArchivedResponse, htmlText, htmlTitle, writeArchive, writeWacz } from '../archive/wacz.ts';
import { appChannel, type AppChannel } from './app.ts';
import { type Route, routedFetch } from './network.ts';

/**
 * CaptureService seam: turn a URL into a portable archive (WACZ), the page's
 * readable text and, when possible, a screenshot.
 *
 * - browser: the desktop app's own browser (Chromium) loads the page through
 *   the case's route and records every response it receives, so the archive
 *   replays the page as rendered, with a screenshot and the rendered text.
 * - fetch: the server alone; archives the HTML response only (no
 *   subresources, no JavaScript rendering, no screenshot). Good for text
 *   change tracking, and what a server without the app uses.
 *
 * A hosted deployment adds its own implementation (a headless browser on a
 * worker fleet, in a network that cannot reach private addresses).
 */
export interface Capture {
  method: 'browser' | 'fetch';
  requestUrl: string;
  finalUrl: string;
  status: number;
  title: string;
  text: string;
  mime: string;
  capturedAt: string;
  /** Files in the work directory, consumed by the caller. */
  waczPath: string;
  screenshotPath: string | null;
  notes: string[];
  /** A safe searchable index of the network surface. Raw response headers and
   * bodies remain in the WACZ; cookie/header values are not copied into the DB. */
  resources: { count: number; domains: string[]; statuses: string[]; mimeTypes: string[]; responseHeaders: string[] };
}

function resourceSummary(responses: Pick<ArchivedResponse, 'url' | 'status' | 'mime' | 'headers'>[]): Capture['resources'] {
  const unique = (xs: string[]) => [...new Set(xs.filter(Boolean))].sort();
  return {
    count: responses.length,
    domains: unique(responses.map(r => { try { return new URL(r.url).hostname.toLowerCase(); } catch { return ''; } })),
    statuses: unique(responses.map(r => String(r.status || ''))),
    mimeTypes: unique(responses.map(r => r.mime)),
    // Header names are useful for CSP/cache/server analysis without indexing
    // Set-Cookie values or other secrets into the query surface.
    responseHeaders: unique(responses.flatMap(r => r.headers.map(([name]) => name.toLowerCase()))),
  };
}

export interface CaptureService {
  readonly method: Capture['method'];
  /**
   * `guard` rejects addresses the server may not fetch (checked on every
   * redirect where the method allows); `route` sends the capture through the
   * case's proxy.
   */
  capture(url: string, workDir: string, options?: { guard?: (url: string) => Promise<void>; route?: Route | null }): Promise<Capture>;
}

const MAX_BODY = 25 * 1024 * 1024;
const BROWSER_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15';

export function fetchCapture(fetcher: typeof fetch = fetch): CaptureService {
  return {
    method: 'fetch',
    async capture(url, workDir, { guard, route } = {}) {
      const capturedAt = new Date().toISOString();
      const get = route ? routedFetch(route) : fetcher;
      // Redirects are followed by hand so each hop can be checked.
      let res!: Response, at = url;
      for (let hop = 0; ; hop++) {
        await guard?.(at);
        res = await get(at, { redirect: 'manual', headers: { 'User-Agent': BROWSER_UA, Accept: 'text/html,application/xhtml+xml,*/*;q=0.8' }, signal: AbortSignal.timeout(60_000) });
        const location = res.status >= 300 && res.status < 400 ? res.headers.get('location') : null;
        if (!location) break;
        if (hop >= 10) throw Error('Too many redirects');
        await res.body?.cancel();
        at = new URL(location, at).href;
        if (!/^https?:$/.test(new URL(at).protocol)) throw Error(`Redirected to an unsupported address: ${at}`);
      }
      const length = Number(res.headers.get('content-length') || 0);
      if (length > MAX_BODY) throw Error('The page is larger than 25 MB');
      const body = Buffer.from(await res.arrayBuffer());
      if (body.length > MAX_BODY) throw Error('The page is larger than 25 MB');
      const mime = (res.headers.get('content-type') || 'application/octet-stream').split(';')[0].trim();
      const html = /html|xml/.test(mime) ? body.toString('utf8') : '';
      const finalUrl = at;
      const title = html ? htmlTitle(html) : '';
      const text = html ? htmlText(html) : mime.startsWith('text/') ? body.toString('utf8') : '';
      const waczPath = path.join(workDir, 'capture.wacz');
      await writeWacz(waczPath, { requestUrl: url, finalUrl, status: res.status, statusText: res.statusText, headers: [...res.headers.entries()], body, capturedAt, title, text, mime });
      return {
        method: 'fetch', requestUrl: url, finalUrl, status: res.status, title, text, mime, capturedAt, waczPath, screenshotPath: null,
        resources: resourceSummary([{ url: finalUrl, status: res.status, mime, headers: [...res.headers.entries()] }]),
        notes: ['Archived the HTML response only: no scripts were run and no images or styles were stored. Snapshots made from the desktop app keep the whole page.'],
      };
    },
  };
}

/** What the app sends back: files it wrote in the work directory, and what it saw. */
interface AppCaptured {
  finalUrl: string; status: number; title: string; text: string; mime: string; capturedAt: string;
  screenshot: string | null;
  responses: (Omit<ArchivedResponse, 'body'> & { file: string })[];
  notes: string[];
}

/**
 * Capture through the desktop app's browser. The app writes each response body
 * and the screenshot into the work directory; the archive is built here, like
 * every other capture's. Only the starting address is checked by `guard`: this
 * method exists only on a researcher's own computer (hosted servers use their
 * own crawler).
 */
export function appCapture(channel: AppChannel): CaptureService {
  return {
    method: 'browser',
    async capture(url, workDir, { guard, route } = {}) {
      await guard?.(url);
      const got = await channel.request<AppCaptured>('capture', { url, workDir, route: route ? `${route.kind}://${route.host}:${route.port}` : '' }, 240_000);
      const inside = (file: string) => {
        const full = path.resolve(workDir, file);
        if (!full.startsWith(path.resolve(workDir) + path.sep)) throw Error('The app wrote outside the capture folder');
        return full;
      };
      const responses: ArchivedResponse[] = [];
      for (const r of got.responses) responses.push({ ...r, body: await fsp.readFile(inside(r.file)) });
      const screenshotPath = got.screenshot ? inside(got.screenshot) : null;
      const waczPath = path.join(workDir, 'capture.wacz');
      await writeArchive(waczPath, {
        mainUrl: got.finalUrl, capturedAt: got.capturedAt, title: got.title, text: got.text, status: got.status, mime: got.mime,
        responses, screenshot: screenshotPath ? await fsp.readFile(screenshotPath) : null, software: 'hvnt33 browser capture',
      });
      return {
        method: 'browser', requestUrl: url, finalUrl: got.finalUrl, status: got.status, title: got.title, text: got.text,
        mime: got.mime, capturedAt: got.capturedAt, waczPath, screenshotPath, notes: got.notes, resources: resourceSummary(responses),
      };
    },
  };
}

/** Pick the capture method: the app's browser when the server runs inside the app, else fetch. */
export function chooseCapture(mode: 'auto' | 'fetch'): CaptureService {
  const channel = mode === 'auto' ? appChannel() : null;
  return channel ? appCapture(channel) : fetchCapture();
}
