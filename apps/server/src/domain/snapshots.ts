import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { ZipArchive } from 'archiver';
import { diffLines } from 'diff';
import express from 'express';
import { z } from 'zod';
import { type Api, HttpError, RAW, clean, notFound } from '../http.ts';
import type { Row } from '../seams/graph.ts';
import type { Job, JobHandler } from '../seams/jobs.ts';
import { type Deps, idParam, investigationIn, listIn, now } from './common.ts';
import { archiveUrl } from './archive.ts';
import { PrivateAddressError, assertPublicUrl } from '../seams/netguard.ts';
import { exitOf, lockBroken, routedFetch, type Lock } from '../seams/network.ts';
import { effectiveRoute } from './caseNetwork.ts';

// hvnt33's own archive: snapshots of pages (WACZ + text + screenshot), each
// with a manifest stamped by RFC 3161 timestamp authorities; watches that
// re-capture pages on a schedule; and detected changes between snapshots.

const VERSION = 1;

export interface BlobRef { key: string; sha256: string; size: number }
export interface SnapshotDoc {
  id: string; workspaceId: string; investigationId: string; url: string; finalUrl: string; status: number; title: string;
  method: string; capturedAt: string; trigger: 'manual' | 'watch' | 'capture'; requestedBy: string; watchId: string; intakeId: string;
  files: { wacz: BlobRef; text: BlobRef; manifest: BlobRef; screenshot: BlobRef | null };
  textSha256: string; textLines: number; notes: string[];
  resources: { count: number; domains: string[]; statuses: string[]; mimeTypes: string[]; responseHeaders: string[] };
  timestamps: { tsa: string; genTime: string; token: BlobRef }[]; timestampErrors: { tsa: string; error: string }[];
  previousId: string; changed: boolean | null; changeId: string;
  /** The case's route and where it left the internet (no IP address), when the case has a route or lock. */
  network?: { route: string; country: string; org: string } | null;
}

// ── Change detection ─────────────────────────────────────────────────────────

export interface LineDiff { added: number; removed: number; unchanged: number; similarity: number; addedLines: string[]; removedLines: string[] }

/** Line-level comparison of two page texts (whitespace already normalized). */
export function compareText(before: string, after: string, excerpt = 8): LineDiff {
  let added = 0, removed = 0, unchanged = 0;
  const addedLines: string[] = [], removedLines: string[] = [];
  for (const part of diffLines(before.endsWith('\n') ? before : before + '\n', after.endsWith('\n') ? after : after + '\n')) {
    const lines = part.value.split('\n').filter(Boolean);
    if (part.added) { added += lines.length; addedLines.push(...lines.slice(0, excerpt - addedLines.length)); }
    else if (part.removed) { removed += lines.length; removedLines.push(...lines.slice(0, excerpt - removedLines.length)); }
    else unchanged += lines.length;
  }
  const total = Math.max(unchanged + added, unchanged + removed, 1);
  const clip = (l: string) => (l.length > 300 ? l.slice(0, 299) + '…' : l);
  return { added, removed, unchanged, similarity: Math.round((unchanged / total) * 1000) / 1000, addedLines: addedLines.map(clip), removedLines: removedLines.map(clip) };
}

const normalizeText = (text: string) => text.split('\n').map(l => l.replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n');
const sha256 = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');

// ── Replay links ─────────────────────────────────────────────────────────────

/** A signed, expiring grant to read one snapshot's files (for replay in a browser tab). */
export function replayToken(secret: string, snapshotId: string, ttlMs = 60 * 60 * 1000, nowMs = Date.now()): string {
  const exp = Math.floor((nowMs + ttlMs) / 1000);
  const mac = createHmac('sha256', secret).update(`${snapshotId}.${exp}`).digest('base64url');
  return `${exp}.${mac}`;
}

export function checkReplayToken(secret: string, snapshotId: string, token: string, nowMs = Date.now()): boolean {
  const [exp, mac] = token.split('.');
  if (!exp || !mac || !/^\d+$/.test(exp) || Number(exp) * 1000 < nowMs) return false;
  // Compare the exact encoding: base64url has spare bits, so decoding would accept variant spellings.
  const expected = Buffer.from(createHmac('sha256', secret).update(`${snapshotId}.${exp}`).digest('base64url'));
  const given = Buffer.from(mac);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

// ── The capture job ──────────────────────────────────────────────────────────

export interface CapturePayload extends Record<string, unknown> { url: string; trigger: SnapshotDoc['trigger']; requestedBy: string; watchId: string; intakeId: string }

async function putBuffer(deps: Deps, workDir: string, name: string, data: Buffer | string): Promise<BlobRef> {
  const file = path.join(workDir, name);
  await fsp.writeFile(file, data);
  const b = await deps.blobs.putFile(file);
  return { key: b.key, sha256: b.sha256, size: b.size };
}

async function putPath(deps: Deps, file: string): Promise<BlobRef> {
  const b = await deps.blobs.putFile(file);
  return { key: b.key, sha256: b.sha256, size: b.size };
}

export function snapshotJobs(deps: Deps): Record<string, JobHandler<CapturePayload, { snapshotId: string; changed: boolean | null }>> {
  return {
    'archive.capture': {
      minIntervalMs: 2000,
      maxAttempts: 2,
      async run(_payload, job) {
        const doc = await takeSnapshot(deps, job as Job<CapturePayload>);
        return { snapshotId: doc.id, changed: doc.changed };
      },
      async onFailed(job, error) {
        if (job.payload.watchId) await deps.graph.sql('UPDATE Watch SET lastError=:e, lastRunAt=:t WHERE id=:id', { id: job.payload.watchId, e: error.message.slice(0, 500), t: now() });
      },
    },
  };
}

/** Capture a page, store everything by hash, timestamp the manifest and detect changes. */
export async function takeSnapshot(deps: Deps, job: Job<CapturePayload>): Promise<SnapshotDoc> {
  const { graph } = deps;
  const { url, trigger, requestedBy, watchId, intakeId } = job.payload;
  const workDir = path.join(deps.config.snapshots.tmpDir, `${job.id}-${job.attempts}`);
  await fsp.mkdir(workDir, { recursive: true });
  try {
    const guard = deps.config.snapshots.allowPrivateUrls ? undefined : (u: string) => assertPublicUrl(u);
    await guard?.(url);
    // The case's route: captures leave from the same place as its browsing, and
    // a locked case is not captured at all while its exit is elsewhere.
    const [inv] = await graph.sql<Row & { network?: { route: string; label: string; lock: Lock | null } }>('SELECT FROM Investigation WHERE id=:id AND workspaceId=:ws', { id: job.investigationId, ws: job.workspaceId });
    const net = inv?.network;
    const route = inv ? await effectiveRoute(deps, inv) : null;
    let via: SnapshotDoc['network'] = null;
    if (route || net?.lock) {
      const exit = await exitOf(routedFetch(route), deps.config.network.exitCheckUrl);
      const broken = lockBroken(net?.lock, exit);
      if (broken) throw Error(`Not captured: this case is locked to ${[net!.lock!.country, net!.lock!.org].filter(Boolean).join(', ')}, but ${broken}. Check the connection and try again.`);
      via = { route: net?.label || (route ? `${route.kind} proxy` : 'direct'), country: exit.country, org: exit.org };
    }
    const service = await deps.captureService();
    const capture = await service.capture(url, workDir, { guard, route });
    const text = normalizeText(capture.text);
    const files = {
      wacz: await putPath(deps, capture.waczPath),
      text: await putBuffer(deps, workDir, 'text.txt', text),
      screenshot: capture.screenshotPath ? await putPath(deps, capture.screenshotPath) : null,
    };
    // The manifest is what gets timestamped: it names every file by its hash.
    const manifest = {
      format: 'hvnt33-snapshot', version: VERSION,
      url, finalUrl: capture.finalUrl, status: capture.status, title: capture.title, mime: capture.mime,
      capturedAt: capture.capturedAt, method: capture.method, ...(via ? { network: via } : {}),
      resources: capture.resources,
      files: { wacz: { sha256: files.wacz.sha256, bytes: files.wacz.size }, text: { sha256: files.text.sha256, bytes: files.text.size }, ...(files.screenshot ? { screenshot: { sha256: files.screenshot.sha256, bytes: files.screenshot.size } } : {}) },
      requestedBy, trigger, workspaceId: job.workspaceId, investigationId: job.investigationId, notes: capture.notes,
    };
    const manifestBytes = Buffer.from(JSON.stringify(manifest, null, 2) + '\n');
    const manifestRef = await putBuffer(deps, workDir, 'manifest.json', manifestBytes);
    const stamped = await deps.timestamper(createHash('sha256').update(manifestBytes).digest());
    const timestamps = [];
    for (const [i, t] of stamped.tokens.entries()) timestamps.push({ tsa: t.tsa, genTime: t.genTime, token: await putBuffer(deps, workDir, `timestamp-${i}.tsr`, t.token) });

    const [previous] = await graph.sql<SnapshotDoc & Row>('SELECT FROM Snapshot WHERE workspaceId=:ws AND investigationId=:inv AND url=:url ORDER BY capturedAt DESC LIMIT 1', { ws: job.workspaceId, inv: job.investigationId, url });
    const doc: SnapshotDoc = {
      id: randomUUID(), workspaceId: job.workspaceId, investigationId: job.investigationId, url, finalUrl: capture.finalUrl, status: capture.status,
      title: capture.title, method: capture.method, capturedAt: capture.capturedAt, trigger, requestedBy, watchId, intakeId,
      files: { ...files, manifest: manifestRef }, textSha256: sha256(text), textLines: text ? text.split('\n').length : 0, notes: capture.notes,
      resources: capture.resources,
      timestamps, timestampErrors: stamped.errors, previousId: previous?.id ?? '', changed: previous ? previous.textSha256 !== sha256(text) : null, changeId: '', network: via,
    };
    if (previous && doc.changed) {
      const before = await fsp.readFile(deps.blobs.path(previous.files.text.key), 'utf8');
      const d = compareText(before, text);
      const change = {
        id: randomUUID(), workspaceId: job.workspaceId, investigationId: job.investigationId, url, watchId,
        fromSnapshotId: previous.id, toSnapshotId: doc.id, fromAt: previous.capturedAt, toAt: doc.capturedAt,
        title: doc.title || previous.title, ...d, detectedAt: now(), seen: false,
      };
      await graph.sql('INSERT INTO PageChange CONTENT :c', { c: change });
      doc.changeId = change.id;
    }
    await graph.sql('INSERT INTO Snapshot CONTENT :doc', { doc });
    if (watchId) await graph.sql('UPDATE Watch SET lastRunAt=:t, lastSnapshotId=:s, lastError=:e' + (doc.changed ? ', lastChangeAt=:t' : '') + ' WHERE id=:id', { id: watchId, t: now(), s: doc.id, e: '' });
    if (intakeId) await graph.sql('UPDATE Intake SET snapshot=:s WHERE id=:id AND workspaceId=:ws', { id: intakeId, ws: job.workspaceId, s: { id: doc.id, capturedAt: doc.capturedAt, method: doc.method } });
    return doc;
  } finally {
    await fsp.rm(workDir, { recursive: true, force: true });
  }
}

// ── Watches ──────────────────────────────────────────────────────────────────

/**
 * Queue a capture for every watch that is due. A watch is claimed by moving its
 * next run forward with a conditional update, so servers sharing a database
 * never capture the same watch twice.
 */
export async function runDueWatches(deps: Deps, at = new Date()): Promise<number> {
  const due = await deps.graph.sql<Row>('SELECT FROM Watch WHERE active=true AND nextRunAt <= :t ORDER BY nextRunAt ASC LIMIT 50', { t: at.toISOString() });
  let queued = 0;
  for (const w of due) {
    const next = new Date(at.getTime() + Number(w.everyHours) * 3600_000).toISOString();
    const [claim] = await deps.graph.sql<{ count: number }>('UPDATE Watch SET nextRunAt=:next WHERE id=:id AND nextRunAt=:old', { id: w.id, next, old: w.nextRunAt });
    if ((claim?.count ?? 0) !== 1) continue;
    try {
      await deps.entitlements.require(String(w.workspaceId), 'snapshots.monthly');
    } catch (e) {
      await deps.graph.sql('UPDATE Watch SET lastError=:e WHERE id=:id', { id: w.id, e: (e as Error).message });
      continue;
    }
    await deps.jobs.enqueue('archive.capture', { url: String(w.url), trigger: 'watch', requestedBy: String(w.createdBy ?? ''), watchId: String(w.id), intakeId: '' } satisfies CapturePayload, { workspaceId: String(w.workspaceId), investigationId: String(w.investigationId) });
    await deps.entitlements.record(String(w.workspaceId), 'snapshots.monthly');
    queued++;
  }
  return queued;
}

export function startWatchScheduler(deps: Deps, everyMs = 60_000): () => void {
  const tick = () => { runDueWatches(deps).catch(e => console.error(`watch scheduler: ${(e as Error).message}`)); };
  tick();
  const timer = setInterval(tick, everyMs);
  timer.unref();
  return () => clearInterval(timer);
}

// ── Evidence export ──────────────────────────────────────────────────────────

const VERIFY = (doc: SnapshotDoc) => `hvnt33 snapshot evidence
========================

Page:        ${doc.url}
Captured:    ${doc.capturedAt} (${doc.method})
Snapshot id: ${doc.id}

What this package contains
- manifest.json   What was captured, when, how, and the SHA-256 of every file.
- snapshot.wacz   The web archive. Open it in https://replayweb.page (offline capable).
- text.txt        The page's readable text, used for change detection.
${doc.files.screenshot ? '- screenshot.png  What the page looked like when captured.\n' : ''}- timestamps/     RFC 3161 tokens: signed statements by independent timestamp
                  authorities that manifest.json existed at the stated time.
- SHA256SUMS      Checksums of every file.

How to verify
1. Files are unchanged:
     shasum -a 256 -c SHA256SUMS
   and compare each file's hash with manifest.json.
2. The manifest existed at the attested time (OpenSSL 3):
${doc.timestamps.map((t, i) => `     openssl ts -verify -data manifest.json -in timestamps/${i + 1}-${new URL(t.tsa).hostname}.tsr -CAfile <CA bundle for ${new URL(t.tsa).hostname}>`).join('\n') || '     (no timestamp tokens were obtained for this snapshot)'}
   DigiCert tokens verify against a standard CA bundle (e.g. /etc/ssl/cert.pem).
   FreeTSA tokens verify against https://freetsa.org/files/cacert.pem with
   -untrusted https://freetsa.org/files/tsa.crt.
   Show a token's contents:  openssl ts -reply -in <token>.tsr -text

What this proves, and what it does not
- It shows these exact bytes existed no later than the attested time and were
  served for the URL above to the capturing software.
- It does not show that the content is true, who wrote it, or that the site
  would have served the same content to everyone.
`;

export function snapshotRoutes(api: Api, deps: Deps) {
  const { graph, entitlements, jobs, blobs, config } = deps;

  const SnapshotSchema = z.looseObject({
    id: z.string(), workspaceId: z.string(), investigationId: z.string(), url: z.string(), finalUrl: z.string(), status: z.number(), title: z.string(),
    method: z.string(), capturedAt: z.string(), trigger: z.string(), changed: z.boolean().nullable(), changeId: z.string(), previousId: z.string(),
    textLines: z.number(), notes: z.array(z.string()),
    resources: z.looseObject({ count: z.number(), domains: z.array(z.string()), statuses: z.array(z.string()), mimeTypes: z.array(z.string()), responseHeaders: z.array(z.string()) }).optional(),
    timestamps: z.array(z.looseObject({ tsa: z.string(), genTime: z.string() })), timestampErrors: z.array(z.looseObject({ tsa: z.string(), error: z.string() })),
    files: z.looseObject({}),
  }).describe('A capture of a page by hvnt33: archive, text, screenshot and timestamped manifest');
  const WatchSchema = z.looseObject({
    id: z.string(), investigationId: z.string(), url: z.string(), everyHours: z.number(), active: z.boolean(), nextRunAt: z.string(),
    lastRunAt: z.string(), lastSnapshotId: z.string(), lastChangeAt: z.string(), lastError: z.string(), createdAt: z.string(),
  });
  const ChangeSchema = z.looseObject({
    id: z.string(), investigationId: z.string(), url: z.string(), title: z.string(), fromSnapshotId: z.string(), toSnapshotId: z.string(),
    fromAt: z.string(), toAt: z.string(), added: z.number(), removed: z.number(), similarity: z.number(),
    addedLines: z.array(z.string()), removedLines: z.array(z.string()), seen: z.boolean(), detectedAt: z.string(),
  }).describe('A difference between two consecutive snapshots of a page');

  /** An http(s) URL this server may archive (hosted servers: public addresses only). */
  const snapshotUrl = async (value: string) => {
    const url = archiveUrl(value);
    if (!config.snapshots.allowPrivateUrls) await assertPublicUrl(url).catch(e => { throw e instanceof PrivateAddressError ? new HttpError(400, e.message, 'private_address') : e; });
    return url;
  };
  const snapshotIn = async (workspaceId: string, id: string) => {
    const [row] = await graph.sql<SnapshotDoc & Row>('SELECT FROM Snapshot WHERE id=:id AND workspaceId=:ws', { id, ws: workspaceId });
    if (!row) throw notFound('Snapshot not found');
    return clean(row) as SnapshotDoc;
  };
  const owned = async (type: 'Watch' | 'PageChange', workspaceId: string, id: string) => {
    const [row] = await graph.sql<Row>(`SELECT FROM ${type} WHERE id=:id AND workspaceId=:ws`, { id, ws: workspaceId });
    if (!row) throw notFound(type === 'Watch' ? 'Watch not found' : 'Change not found');
    return clean(row);
  };

  api.route({
    method: 'post', path: '/api/snapshots', summary: 'Queue a snapshot of a page (archive, text, screenshot, trusted timestamps)', tags: ['Snapshots'],
    body: z.object({ investigationId: z.string().max(100), url: z.string().max(8000), intakeId: z.string().max(100).optional() }), status: 202,
    response: z.looseObject({ id: z.string(), kind: z.string(), state: z.string() }),
    handler: async ({ body, principal, workspaceId }) => {
      const url = await snapshotUrl(body.url);
      await investigationIn(graph, workspaceId, body.investigationId);
      if (body.intakeId) {
        const [i] = await graph.sql('SELECT investigationId FROM Intake WHERE id=:id AND workspaceId=:ws', { id: body.intakeId, ws: workspaceId });
        if (!i || i.investigationId !== body.investigationId) throw notFound('Capture not found in this investigation');
      }
      await entitlements.require(workspaceId, 'snapshots.monthly');
      const job = await jobs.enqueue('archive.capture', { url, trigger: body.intakeId ? 'capture' : 'manual', requestedBy: principal.userId, watchId: '', intakeId: body.intakeId ?? '' } satisfies CapturePayload, { workspaceId, investigationId: body.investigationId });
      await entitlements.record(workspaceId, 'snapshots.monthly');
      return job;
    },
  });

  api.route({
    method: 'get', path: '/api/investigations/:id/snapshots', summary: "The case's snapshots, newest first", tags: ['Snapshots'],
    params: idParam, response: z.array(SnapshotSchema),
    handler: async ({ params, workspaceId }) => { await investigationIn(graph, workspaceId, params.id); return listIn(graph, 'Snapshot', workspaceId, params.id, 'capturedAt DESC', 1000); },
  });

  api.route({
    method: 'get', path: '/api/snapshots/:id', summary: 'A snapshot', tags: ['Snapshots'],
    params: idParam, response: SnapshotSchema,
    handler: ({ params, workspaceId }) => snapshotIn(workspaceId, params.id),
  });

  api.route({
    method: 'get', path: '/api/snapshots/:id/replay-url', summary: 'A signed link (valid one hour) that replays the snapshot in a browser, on the separate replay origin', tags: ['Snapshots'],
    params: idParam, response: z.object({ url: z.string(), expiresAt: z.string() }),
    handler: async ({ params, workspaceId }) => {
      await snapshotIn(workspaceId, params.id);
      const token = replayToken(config.snapshots.secret, params.id);
      return { url: `${config.replay.publicUrl}/replay/${params.id}?t=${encodeURIComponent(token)}`, expiresAt: new Date(Number(token.split('.')[0]) * 1000).toISOString() };
    },
  });

  const FILES = { wacz: 'application/wacz', text: 'text/plain; charset=utf-8', screenshot: 'image/png', manifest: 'application/json' } as const;
  api.route({
    method: 'get', path: '/api/snapshots/:id/files/:file', summary: "A snapshot's file: wacz, text, screenshot, manifest, or timestamp-N (also readable with a replay token)", tags: ['Snapshots'],
    params: z.object({ id: z.string().max(100), file: z.string().regex(/^(wacz|text|screenshot|manifest|timestamp-\d)$/) }),
    query: z.object({ t: z.string().max(200).optional().describe('Replay token instead of credentials') }),
    public: true,
    produces: { 'application/octet-stream': 'The file' },
    handler: async ({ params, query, principal, res }) => {
      let doc: SnapshotDoc;
      // A presented link must be valid, credentials or not: a tampered link fails the same way for everyone.
      if (query.t !== undefined && !checkReplayToken(config.snapshots.secret, params.id, query.t)) throw new HttpError(401, 'This replay link is invalid or has expired', 'unauthenticated');
      if (principal && query.t === undefined) doc = await snapshotIn(principal.workspaceId, params.id);
      else {
        if (!query.t || !checkReplayToken(config.snapshots.secret, params.id, query.t)) throw new HttpError(401, 'Authentication required', 'unauthenticated');
        const [row] = await graph.sql<SnapshotDoc & Row>('SELECT FROM Snapshot WHERE id=:id', { id: params.id });
        if (!row) throw notFound('Snapshot not found');
        doc = row;
      }
      const m = /^timestamp-(\d)$/.exec(params.file);
      const ref = m ? doc.timestamps[Number(m[1])]?.token : doc.files[params.file as keyof typeof FILES];
      if (!ref) throw notFound('This snapshot has no such file');
      res.type(m ? 'application/timestamp-reply' : FILES[params.file as keyof typeof FILES]);
      res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
      res.setHeader('Cache-Control', 'private, max-age=3600');
      res.sendFile(blobs.path(ref.key));
      return RAW;
    },
  });

  api.route({
    method: 'get', path: '/api/snapshots/:id/evidence', summary: 'Evidence package: archive, text, screenshot, manifest, timestamp tokens, checksums and verification steps', tags: ['Snapshots'],
    params: idParam, produces: { 'application/zip': 'The evidence package' },
    handler: async ({ params, res, workspaceId }) => {
      const doc = await snapshotIn(workspaceId, params.id);
      const entries: [string, string][] = [['manifest.json', doc.files.manifest.key], ['snapshot.wacz', doc.files.wacz.key], ['text.txt', doc.files.text.key]];
      if (doc.files.screenshot) entries.push(['screenshot.png', doc.files.screenshot.key]);
      doc.timestamps.forEach((t, i) => entries.push([`timestamps/${i + 1}-${new URL(t.tsa).hostname}.tsr`, t.token.key]));
      const sums: string[] = [];
      for (const [name, key] of entries) sums.push(`${key.replace('sha256/', '')}  ${name}`);
      res.attachment(`hvnt33-snapshot-${doc.capturedAt.slice(0, 10)}-${doc.id.slice(0, 8)}.zip`);
      const zip = new ZipArchive({ zlib: { level: 6 } });
      zip.on('error', e => res.destroy(e));
      zip.pipe(res);
      for (const [name, key] of entries) zip.file(blobs.path(key), { name });
      zip.append(sums.join('\n') + '\n', { name: 'SHA256SUMS' });
      zip.append(VERIFY(doc), { name: 'VERIFY.txt' });
      zip.append(JSON.stringify({ snapshot: doc, exportedAt: now() }, null, 2), { name: 'custody.json' });
      await zip.finalize();
      return RAW;
    },
  });

  // Watches
  const WatchBody = z.object({ investigationId: z.string().max(100), url: z.string().max(8000), everyHours: z.number().int().min(1).max(24 * 30).default(24).describe('Hours between captures (1–720)') });
  api.route({
    method: 'post', path: '/api/watches', summary: 'Watch a page: capture it now and then every N hours, recording changes', tags: ['Watches'],
    body: WatchBody, response: WatchSchema, status: 201,
    handler: async ({ body, principal, res, workspaceId }) => {
      const url = await snapshotUrl(body.url);
      await investigationIn(graph, workspaceId, body.investigationId);
      const [existing] = await graph.sql('SELECT FROM Watch WHERE workspaceId=:ws AND investigationId=:inv AND url=:url LIMIT 1', { ws: workspaceId, inv: body.investigationId, url });
      if (existing) { res.locals.status = 200; return clean(existing); }
      await entitlements.require(workspaceId, 'watches');
      const t = now();
      const watch = { id: randomUUID(), workspaceId, investigationId: body.investigationId, url, everyHours: body.everyHours, active: true, nextRunAt: t, lastRunAt: '', lastSnapshotId: '', lastChangeAt: '', lastError: '', createdBy: principal.userId, createdAt: t };
      await graph.sql('INSERT INTO Watch CONTENT :w', { w: watch });
      await entitlements.record(workspaceId, 'watches');
      void runDueWatches(deps).catch(() => {});
      return watch;
    },
  });
  api.route({
    method: 'get', path: '/api/investigations/:id/watches', summary: 'Watched pages in the case', tags: ['Watches'],
    params: idParam, response: z.array(WatchSchema),
    handler: async ({ params, workspaceId }) => { await investigationIn(graph, workspaceId, params.id); return listIn(graph, 'Watch', workspaceId, params.id); },
  });
  api.route({
    method: 'patch', path: '/api/watches/:id', summary: 'Pause, resume or change how often a page is captured', tags: ['Watches'],
    params: idParam, body: z.object({ everyHours: z.number().int().min(1).max(720).optional(), active: z.boolean().optional() }), response: WatchSchema,
    handler: async ({ params, body, workspaceId }) => {
      const w = await owned('Watch', workspaceId, params.id);
      const changes: Row = {};
      if (body.everyHours) { changes.everyHours = body.everyHours; changes.nextRunAt = new Date((w.lastRunAt ? Date.parse(String(w.lastRunAt)) : Date.now()) + body.everyHours * 3600_000).toISOString(); }
      if (body.active !== undefined) changes.active = body.active;
      if (Object.keys(changes).length) await graph.sql(`UPDATE Watch SET ${Object.keys(changes).map(k => `${k}=:${k}`).join(', ')} WHERE id=:id`, { ...changes, id: params.id });
      return owned('Watch', workspaceId, params.id);
    },
  });
  api.route({
    method: 'post', path: '/api/watches/:id/run', summary: 'Capture a watched page now', tags: ['Watches'],
    params: idParam, response: WatchSchema,
    handler: async ({ params, workspaceId }) => {
      await owned('Watch', workspaceId, params.id);
      await graph.sql('UPDATE Watch SET nextRunAt=:t WHERE id=:id', { id: params.id, t: new Date(0).toISOString() });
      await runDueWatches(deps);
      return owned('Watch', workspaceId, params.id);
    },
  });
  api.route({
    method: 'delete', path: '/api/watches/:id', summary: 'Stop watching a page (its snapshots are kept)', tags: ['Watches'],
    params: idParam, response: z.object({ deleted: z.string() }),
    handler: async ({ params, workspaceId }) => {
      await owned('Watch', workspaceId, params.id);
      await graph.sql('DELETE FROM Watch WHERE id=:id', { id: params.id });
      await entitlements.record(workspaceId, 'watches', -1);
      return { deleted: params.id };
    },
  });

  // Changes
  api.route({
    method: 'get', path: '/api/investigations/:id/page-changes', summary: 'Detected page changes in the case, newest first', tags: ['Watches'],
    params: idParam, response: z.array(ChangeSchema),
    handler: async ({ params, workspaceId }) => { await investigationIn(graph, workspaceId, params.id); return listIn(graph, 'PageChange', workspaceId, params.id, 'toAt DESC', 1000); },
  });
  api.route({
    method: 'get', path: '/api/page-changes/:id/diff', summary: 'The full line diff between the two snapshots of a change', tags: ['Watches'],
    params: idParam, response: z.object({ parts: z.array(z.object({ kind: z.enum(['added', 'removed', 'same']), lines: z.array(z.string()) })) }),
    handler: async ({ params, workspaceId }) => {
      const c = await owned('PageChange', workspaceId, params.id);
      const [from, to] = [await snapshotIn(workspaceId, String(c.fromSnapshotId)), await snapshotIn(workspaceId, String(c.toSnapshotId))];
      const [a, b] = await Promise.all([fsp.readFile(blobs.path(from.files.text.key), 'utf8'), fsp.readFile(blobs.path(to.files.text.key), 'utf8')]);
      const parts = diffLines(a.endsWith('\n') ? a : a + '\n', b.endsWith('\n') ? b : b + '\n').map(p => ({ kind: p.added ? 'added' as const : p.removed ? 'removed' as const : 'same' as const, lines: p.value.split('\n').filter(Boolean) }));
      return { parts };
    },
  });
  api.route({
    method: 'patch', path: '/api/page-changes/:id', summary: 'Mark a change as seen', tags: ['Watches'],
    params: idParam, body: z.object({ seen: z.boolean() }), response: ChangeSchema,
    handler: async ({ params, body, workspaceId }) => {
      await owned('PageChange', workspaceId, params.id);
      await graph.sql('UPDATE PageChange SET seen=:seen WHERE id=:id', { id: params.id, seen: body.seen });
      return owned('PageChange', workspaceId, params.id);
    },
  });
}

/**
 * The replay site, served on its own origin (HVNT33_REPLAY_PORT / HVNT33_REPLAY_URL).
 * Replayed pages run the archived site's scripts, so they must not share an
 * origin with the API or the web workspace: this site serves only
 * ReplayWeb.page (vendored) and, for a valid signed link, one snapshot's
 * archive. It has no API and no credentials.
 */
export function replaySite(deps: Deps): express.Express {
  const { config, graph, blobs } = deps;
  const vendor = path.resolve(import.meta.dirname, '../../vendor/replaywebpage');
  const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
  const app = express();
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    const host = (req.headers.host || '').split(':')[0];
    if (config.auth === 'local' && !['127.0.0.1', 'localhost'].includes(host)) return void res.status(403).type('text').send('Local access only');
    next();
  });
  /** The snapshot a signed link grants, or an error response. */
  const granted = async (req: express.Request, res: express.Response): Promise<(SnapshotDoc & Row) | null> => {
    const id = String(req.params.id), token = String(req.query.t ?? '');
    if (!/^[0-9a-f-]{36}$/.test(id) || !checkReplayToken(config.snapshots.secret, id, token)) {
      res.status(401).type('text').send('This replay link is invalid or has expired. Open the snapshot again from hvnt33.');
      return null;
    }
    const [row] = await graph.sql<SnapshotDoc & Row>('SELECT FROM Snapshot WHERE id=:id', { id });
    if (!row) { res.status(404).type('text').send('Snapshot not found'); return null; }
    return row;
  };
  app.get('/replay/sw.js', (_req, res) => { res.type('application/javascript'); res.setHeader('Service-Worker-Allowed', '/replay/'); res.sendFile(path.join(vendor, 'sw.js')); });
  app.get('/replay/ui.js', (_req, res) => { res.type('application/javascript'); res.sendFile(path.join(vendor, 'ui.js')); });
  app.get('/replay/:id/archive.wacz', async (req, res, next) => {
    try {
      const doc = await granted(req, res);
      if (!doc) return;
      res.type('application/wacz');
      res.setHeader('Cache-Control', 'private, max-age=3600');
      res.sendFile(blobs.path(doc.files.wacz.key));
    } catch (e) { next(e); }
  });
  app.get('/replay/:id', async (req, res, next) => {
    try {
      const doc = await granted(req, res);
      if (!doc) return;
      const token = String(req.query.t);
      const source = `/replay/${doc.id}/archive.wacz?t=${encodeURIComponent(token)}`;
      const ts = String(doc.capturedAt).replace(/[-:TZ.]/g, '').slice(0, 14);
      res.type('html').send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Snapshot · ${esc(String(doc.title || doc.url))}</title>
<style>html,body{margin:0;height:100%;font:13px -apple-system,system-ui,sans-serif;background:#0b100f;color:#e6e2d6}header{padding:6px 12px;border-bottom:1px solid #24312f;display:flex;gap:12px;align-items:center}b{color:#f2a65a}replay-web-page{display:block;height:calc(100% - 33px)}</style>
<script src="/replay/ui.js"></script></head><body>
<header><b>hvnt33 snapshot</b><span>${esc(String(doc.url))}</span><span>captured ${esc(String(doc.capturedAt))}</span></header>
<replay-web-page source="${esc(source)}" url="${esc(String(doc.url))}" ts="${ts}" replayBase="/replay/" embed="replayonly"></replay-web-page>
</body></html>`);
    } catch (e) { next(e); }
  });
  app.use((_req, res) => void res.status(404).type('text').send('Not found'));
  app.use((error: unknown, req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error(`replay ${req.method} ${req.originalUrl}: ${(error as Error).stack ?? error}`);
    if (!res.headersSent) res.status(500).type('text').send('Replay failed. Check the server log.');
  });
  return app;
}
