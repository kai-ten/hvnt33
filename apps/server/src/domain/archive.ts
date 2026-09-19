import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { routedFetch } from '../seams/network.ts';
import { effectiveRoute } from './caseNetwork.ts';
import type { Config } from '../config.ts';
import { type Api, HttpError, badRequest, clean, notFound } from '../http.ts';
import type { Graph, Row } from '../seams/graph.ts';
import { type JobHandler, RetryableError } from '../seams/jobs.ts';
import { type Deps, idParam, investigationIn } from './common.ts';

// The Wayback Machine as a source: what the Internet Archive holds for a URL
// (CDX index, public and read-only) and user-triggered "archive now" through
// Save Page Now, which needs the user's free archive.org API keys.
//
// History is public information about a URL, so it is cached once per URL
// (shared across workspaces) and refreshed after HISTORY_TTL_MS.

const WAYBACK = 'https://web.archive.org';
const HISTORY_TTL_MS = 12 * 60 * 60 * 1000;
const MAX_SNAPSHOTS = 5000;
const USER_AGENT = 'hvnt33/0.2 (investigation workbench)';
const KEYS_HELP = 'Archive now needs a free archive.org account: add ARCHIVE_ORG_ACCESS_KEY and ARCHIVE_ORG_SECRET_KEY (from https://archive.org/account/s3.php) to .env and restart the server.';

export function archiveUrl(value: unknown): string {
  let u: URL;
  try { u = new URL(String(value)); } catch { throw badRequest('Archive lookups need an http(s) URL'); }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw badRequest('Archive lookups need an http(s) URL');
  u.hash = '';
  return u.href;
}

/** Wayback timestamp (YYYYMMDDhhmmss) → ISO 8601, or '' when malformed. */
export function waybackTime(ts: string | undefined): string {
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})?(\d{2})?(\d{2})?$/.exec(ts ?? '');
  if (!m) return '';
  return `${m[1]}-${m[2]}-${m[3]}T${m[4] || '00'}:${m[5] || '00'}:${m[6] || '00'}Z`;
}

export interface Snapshot { timestamp: string; capturedAt: string; original: string; status: string; mime: string; digest: string; length: number; snapshotUrl: string }

/**
 * Parse a CDX JSON response collapsed by content digest: each row is a
 * version of the page whose content differed from the previous capture.
 */
export function parseCdx(rows: unknown): Snapshot[] {
  if (!Array.isArray(rows) || !rows.length) return [];
  const [header, ...data] = rows as string[][];
  const col = (name: string) => header.indexOf(name);
  return data.map(r => {
    const timestamp = r[col('timestamp')], original = r[col('original')];
    return { timestamp, capturedAt: waybackTime(timestamp), original, status: r[col('statuscode')] || '', mime: r[col('mimetype')] || '', digest: r[col('digest')] || '', length: Number(r[col('length')]) || 0, snapshotUrl: `${WAYBACK}/web/${timestamp}/${original}` };
  }).filter(s => s.capturedAt);
}

/**
 * Summarize versions (oldest first). When the history was longer than the cap,
 * `snapshots` holds the newest versions and `first` comes from a separate query.
 */
export function summarize(url: string, snapshots: Snapshot[], opts: { truncated?: boolean; first?: string } = {}) {
  const byYear: Record<string, number> = {};
  for (const s of snapshots) { const y = s.capturedAt.slice(0, 4); byYear[y] = (byYear[y] || 0) + 1; }
  return { url, source: 'wayback' as const, versions: snapshots.length, first: opts.first || snapshots[0]?.capturedAt || '', last: snapshots.at(-1)?.capturedAt || '', byYear, truncated: !!opts.truncated, snapshots };
}

// A polite client: one CDX request at a time, at least a second apart.
let chain: Promise<unknown> = Promise.resolve();
let lastCdx = 0;
function paced<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(async () => {
    const wait = lastCdx + 1000 - Date.now();
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
    lastCdx = Date.now();
    return fn();
  });
  chain = run.catch(() => {});
  return run;
}

async function cdx(params: Record<string, string>, fetcher: typeof fetch, attempt = 1): Promise<Snapshot[]> {
  let res: Response;
  try {
    res = await paced(() => fetcher(`${WAYBACK}/cdx/search/cdx?${new URLSearchParams(params)}`, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(60_000) }));
  } catch (error) {
    // The CDX service is sometimes slow or drops connections; try once more.
    if (attempt < 2) { await new Promise(r => setTimeout(r, 3000)); return cdx(params, fetcher, attempt + 1); }
    const e = error as Error;
    throw new HttpError(504, e.name === 'TimeoutError' || e.name === 'AbortError' ? 'The Wayback Machine did not respond in time. Try again shortly.' : `Could not reach the Wayback Machine (${e.message})`);
  }
  if (res.status === 429) throw new HttpError(429, 'The Wayback Machine is rate limiting requests. Try again in a minute.');
  if (!res.ok) throw new HttpError(502, `The Wayback Machine returned ${res.status}`);
  const text = await res.text();
  if (!text.trim()) return [];
  try { return parseCdx(JSON.parse(text)); } catch { throw new HttpError(502, 'Unreadable response from the Wayback Machine'); }
}

/** Distinct content versions of a URL; the newest `max` are kept when there are more. */
export async function fetchWaybackHistory(url: string, fetcher: typeof fetch = fetch, max = MAX_SNAPSHOTS) {
  const fl = 'timestamp,original,statuscode,mimetype,digest,length';
  // A negative limit returns the newest versions: those matter most to an investigation.
  const snapshots = await cdx({ url, output: 'json', fl, filter: 'statuscode:200', collapse: 'digest', limit: String(-max) }, fetcher);
  if (snapshots.length < max) return summarize(url, snapshots);
  const [earliest] = await cdx({ url, output: 'json', fl, filter: 'statuscode:200', limit: '1' }, fetcher);
  return summarize(url, snapshots, { truncated: true, first: earliest?.capturedAt || '' });
}

export async function lookup(graph: Graph, url: string, opts: { refresh?: boolean; fetcher?: typeof fetch } = {}) {
  const [cached] = await graph.sql<Row & { checkedAt: string }>('SELECT FROM ArchiveHistory WHERE url=:url LIMIT 1', { url });
  if (cached && !opts.refresh && Date.now() - Date.parse(cached.checkedAt) < HISTORY_TTL_MS) return clean(cached);
  const history = { ...(await fetchWaybackHistory(url, opts.fetcher)), checkedAt: new Date().toISOString() };
  if (cached) await graph.sql('UPDATE ArchiveHistory CONTENT :h WHERE url=:url', { h: { ...history, id: cached.id }, url });
  else await graph.sql('INSERT INTO ArchiveHistory CONTENT :h', { h: { ...history, id: randomUUID() } });
  return history;
}

export const saveConfigured = (keys: Config['archiveOrg']) => !!(keys.accessKey && keys.secretKey);

export interface SaveResult { jobId: string; timestamp: string; capturedAt: string; snapshotUrl: string }

/**
 * Ask the Wayback Machine to capture a URL now (Save Page Now 2) and wait for
 * the result. Throws RetryableError when rate limited.
 */
export async function savePageNow(url: string, keys: Config['archiveOrg'], opts: { fetcher?: typeof fetch; sleep?: (ms: number) => Promise<void>; pollMs?: number; timeoutMs?: number } = {}): Promise<SaveResult> {
  const { fetcher = fetch, sleep = ms => new Promise(r => setTimeout(r, ms)), pollMs = 5000, timeoutMs = 180_000 } = opts;
  if (!saveConfigured(keys)) throw Error('Archive now needs archive.org API keys (ARCHIVE_ORG_ACCESS_KEY and ARCHIVE_ORG_SECRET_KEY in .env).');
  const headers = { Accept: 'application/json', Authorization: `LOW ${keys.accessKey}:${keys.secretKey}`, 'User-Agent': USER_AGENT };
  const res = await fetcher(`${WAYBACK}/save`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ url, skip_first_archive: '1' }).toString(), signal: AbortSignal.timeout(60_000) });
  if (res.status === 429) throw new RetryableError('Save Page Now is rate limiting requests', 60_000);
  const body = (await res.json().catch(() => ({}))) as { job_id?: string; message?: string };
  if (res.status === 401 || res.status === 403) throw Error('archive.org rejected the API keys. Check ARCHIVE_ORG_ACCESS_KEY and ARCHIVE_ORG_SECRET_KEY.');
  if (!res.ok || !body.job_id) throw Error(body.message || `Save Page Now returned ${res.status}`);
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    await sleep(pollMs);
    const s = await fetcher(`${WAYBACK}/save/status/${encodeURIComponent(body.job_id)}`, { headers, signal: AbortSignal.timeout(30_000) });
    if (s.status === 429) { if (Date.now() > deadline) throw new RetryableError('Save Page Now status is rate limited', 60_000); continue; }
    const status = (await s.json().catch(() => ({}))) as { status?: string; timestamp?: string; original_url?: string; message?: string; status_ext?: string };
    if (status.status === 'success') {
      return { jobId: body.job_id, timestamp: String(status.timestamp), capturedAt: waybackTime(status.timestamp), snapshotUrl: `${WAYBACK}/web/${status.timestamp}/${status.original_url || url}` };
    }
    if (status.status === 'error') {
      const detail = status.message || status.status_ext || 'capture failed';
      if (/too-many|rate/i.test(status.status_ext || '')) throw new RetryableError(detail, 120_000);
      throw Error(`Save Page Now could not capture the page: ${detail}`);
    }
    if (Date.now() > deadline) throw Error('Save Page Now did not finish within 3 minutes');
  }
}

/** Queue handler: capture, then record the snapshot on the capture it was requested for. */
export function archiveJobs(graph: Graph, keys: Config['archiveOrg'], save = savePageNow): Record<string, JobHandler<{ url: string; intakeId: string }, SaveResult>> {
  return {
    'archive.save': {
      minIntervalMs: 10_000,
      maxAttempts: 3,
      run: ({ url }) => save(url, keys),
      async onDone(job, result) {
        await graph.sql('UPDATE ArchiveHistory SET checkedAt=:stale WHERE url=:url', { url: job.payload.url, stale: new Date(0).toISOString() });
        if (job.payload.intakeId) {
          await graph.sql('UPDATE Intake SET archive=:archive WHERE id=:id AND workspaceId=:ws', { id: job.payload.intakeId, ws: job.workspaceId, archive: { source: 'wayback', snapshotUrl: result.snapshotUrl, capturedAt: result.capturedAt, requestedAt: job.createdAt } });
        }
      },
    },
  };
}

const SnapshotSchema = z.object({ timestamp: z.string(), capturedAt: z.string(), original: z.string(), status: z.string(), mime: z.string(), digest: z.string(), length: z.number(), snapshotUrl: z.string() });
const History = z.looseObject({
  url: z.string(), source: z.literal('wayback'), checkedAt: z.string(), versions: z.number(), first: z.string(), last: z.string(),
  byYear: z.record(z.string(), z.number()), truncated: z.boolean(), snapshots: z.array(SnapshotSchema),
}).describe('What the Wayback Machine holds for a URL: one snapshot per distinct content version');
const JobSchema = z.looseObject({
  id: z.string(), kind: z.string(), workspaceId: z.string(), investigationId: z.string(), state: z.enum(['queued', 'running', 'done', 'failed']),
  payload: z.looseObject({}), result: z.any().nullable(), error: z.string(), attempts: z.number(), createdAt: z.string(), updatedAt: z.string(),
});

export function archiveRoutes(api: Api, deps: Deps) {
  const { graph, jobs, entitlements, config } = deps;

  api.route({
    method: 'get', path: '/api/archive/status', summary: 'Archive sources and whether "archive now" is configured', tags: ['Archive'],
    response: z.object({ history: z.literal('wayback'), saveConfigured: z.boolean() }),
    handler: () => ({ history: 'wayback' as const, saveConfigured: saveConfigured(config.archiveOrg) }),
  });

  api.route({
    method: 'post', path: '/api/archive/lookup', summary: 'Wayback Machine history of a URL (cached 12 hours; sends the URL to the Internet Archive)', tags: ['Archive'],
    body: z.object({ url: z.string().max(8000), refresh: z.boolean().optional(), investigationId: z.string().max(100).optional().describe("Look it up through this case's network route") }), response: History,
    handler: async ({ body, workspaceId }) => {
      let fetcher: typeof fetch | undefined;
      if (body.investigationId) {
        const route = await effectiveRoute(deps, await investigationIn(graph, workspaceId, body.investigationId));
        if (route) fetcher = routedFetch(route);
      }
      return lookup(graph, archiveUrl(body.url), { refresh: body.refresh === true, fetcher });
    },
  });

  api.route({
    method: 'post', path: '/api/archive/save', summary: 'Queue a Wayback Machine capture of a URL (needs archive.org keys)', tags: ['Archive'],
    body: z.object({ investigationId: z.string().max(100), url: z.string().max(8000), intakeId: z.string().max(100).optional() }), response: JobSchema, status: 202,
    handler: async ({ body, workspaceId }) => {
      const url = archiveUrl(body.url);
      await investigationIn(graph, workspaceId, body.investigationId);
      if (!saveConfigured(config.archiveOrg)) throw new HttpError(503, KEYS_HELP, 'not_configured');
      const intakeId = body.intakeId ?? '';
      if (intakeId) {
        const [i] = await graph.sql('SELECT investigationId FROM Intake WHERE id=:id AND workspaceId=:ws', { id: intakeId, ws: workspaceId });
        if (!i || i.investigationId !== body.investigationId) throw notFound('Capture not found in this investigation');
      }
      await entitlements.require(workspaceId, 'archive.saves.monthly');
      const job = await jobs.enqueue('archive.save', { url, intakeId }, { workspaceId, investigationId: body.investigationId });
      await entitlements.record(workspaceId, 'archive.saves.monthly');
      return job;
    },
  });

  api.route({
    method: 'get', path: '/api/investigations/:id/archive', summary: "Archive jobs and cached history for every URL the case touched (no network requests)", tags: ['Archive'],
    params: idParam, response: z.object({ jobs: z.array(JobSchema), histories: z.array(History) }),
    handler: async ({ params, workspaceId }) => {
      await investigationIn(graph, workspaceId, params.id);
      const scope = { id: params.id, ws: workspaceId };
      const urls = new Set<string>();
      for (const r of await graph.sql<{ url: string }>('SELECT url FROM PageVisit WHERE investigationId=:id AND workspaceId=:ws', scope)) if (r.url) urls.add(r.url);
      for (const t of ['Intake', 'Record']) for (const r of await graph.sql<{ sourceUrl: string }>(`SELECT sourceUrl FROM ${t} WHERE investigationId=:id AND workspaceId=:ws`, scope)) if (r.sourceUrl) urls.add(r.sourceUrl);
      const histories = urls.size ? (await graph.sql('SELECT FROM ArchiveHistory WHERE url IN :urls', { urls: [...urls] })).map(clean) : [];
      return { jobs: await jobs.list(workspaceId, params.id), histories };
    },
  });
}
