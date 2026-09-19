import fsp from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { ZipArchive } from 'archiver';
import { z } from 'zod';
import { type Api, RAW, badRequest, clean, notFound } from '../http.ts';
import type { Row } from '../seams/graph.ts';
import {
  Connection, Dossier, Investigation, KINDS, RecordItem, STATUSES, type Deps,
  idParam, investigationIn, isoDate, listIn, now, recordIn, sourceUrl, text, truthy,
} from './common.ts';
import { csv, graphSvg, report } from './presentation.ts';
import { NetworkBody, applyNetwork, publicNetwork } from './caseNetwork.ts';

const Flag = z.union([z.boolean(), z.enum(['true', 'false'])]).optional();

const CreateInvestigation = z.object({
  title: z.string().max(1000).optional().describe('What you are investigating (up to 200 characters)'),
  description: z.string().max(20000).optional().describe('Research question or context'),
});

const CreateRecord = z.object({
  investigationId: z.string().max(100),
  title: z.string().max(1000).optional(),
  kind: z.enum(KINDS).optional(),
  status: z.enum(STATUSES).optional().describe('Editorial assessment; default Unverified'),
  notes: z.string().max(200000).optional(),
  sourceUrl: z.string().max(4000).optional(),
  sourceLabel: z.string().max(1000).optional(),
  eventDate: z.string().max(20).optional().describe('YYYY-MM-DD'),
  tags: z.string().max(4000).optional().describe('Comma separated'),
  public: Flag.describe('Include in presentation exports'),
});

const UpdateRecord = z.object({
  title: z.string().max(1000).optional(), notes: z.string().max(200000).optional(), sourceLabel: z.string().max(1000).optional(),
  tags: z.string().max(4000).optional(), eventDate: z.string().max(20).optional(), sourceUrl: z.string().max(4000).optional(),
  status: z.enum(STATUSES).optional(), public: z.boolean().optional(),
  reviewed: z.boolean().optional().describe('true: a person has reviewed this (recorded with who and when); false: clear it'),
});

/** A person's review, recorded apart from agent filing. Setting a verification status is a review. */
function review(body: { reviewed?: boolean; status?: string }, userId: string): Row {
  if (body.reviewed === false) return { reviewedAt: '', reviewedBy: '' };
  if (body.reviewed === true || body.status) return { reviewedAt: now(), reviewedBy: userId };
  return {};
}

const CreateConnection = z.object({
  fromId: z.string().max(100), toId: z.string().max(100),
  label: z.string().max(1000).optional().describe('e.g. "owns", "paid", "contradicts"'),
  evidenceId: z.string().max(100).optional().describe('Record supporting this relationship'),
  notes: z.string().max(20000).optional(), status: z.enum(STATUSES).optional(), public: z.boolean().optional(),
});

const UpdateConnection = z.object({
  label: z.string().max(1000).optional(), notes: z.string().max(20000).optional(), status: z.enum(STATUSES).optional(),
  public: z.boolean().optional(), evidenceId: z.string().max(100).optional(),
  reviewed: z.boolean().optional().describe('true: a person has reviewed this; false: clear it'),
});

const Changes = z.object({
  since: z.string().optional().describe('ISO time; omit for everything'),
});

const PREVIEWABLE = /^(image\/(png|jpeg|gif|webp)|video\/(mp4|webm)|audio\/(mpeg|wav)|application\/pdf)$/;
const RID = /^#\d+:\d+$/;

export async function dossier(deps: Deps, workspaceId: string, id: string) {
  const row = clean(await investigationIn(deps.graph, workspaceId, id)) as Row & { title: string };
  const investigation = { ...row, network: publicNetwork(deps, row) };
  const records = await listIn(deps.graph, 'Record', workspaceId, id);
  const connections = await listIn(deps.graph, 'Connection', workspaceId, id, 'createdAt ASC');
  return { investigation, records, connections };
}

/** Apply a partial update with an incremented version (the sync groundwork). */
async function update(deps: Deps, type: 'Record' | 'Connection' | 'Investigation', id: string, changes: Record<string, unknown>) {
  const fields = { ...changes, updatedAt: now() };
  await deps.graph.sql(`UPDATE ${type} SET ${Object.keys(fields).map(k => `${k}=:${k}`).join(', ')}, version=ifnull(version, 1) + 1 WHERE id=:id`, { ...fields, id });
  const [row] = await deps.graph.sql(`SELECT FROM ${type} WHERE id=:id`, { id });
  return clean(row);
}

export function investigationRoutes(api: Api, deps: Deps) {
  const { graph, blobs, entitlements } = deps;

  api.route({
    method: 'get', path: '/api/investigations', summary: 'List investigations in the workspace', tags: ['Investigations'],
    response: z.array(Investigation),
    handler: async ({ workspaceId }) =>
      (await graph.sql('SELECT FROM Investigation WHERE workspaceId=:ws AND deletedAt=:live ORDER BY createdAt DESC', { ws: workspaceId, live: '' })).map(clean).map(r => ({ ...r, network: publicNetwork(deps, r as Row) })),
  });

  api.route({
    method: 'get', path: '/api/investigations/archived', summary: 'List recoverably archived investigations in the workspace', tags: ['Investigations'],
    response: z.array(Investigation),
    handler: async ({ workspaceId }) =>
      (await graph.sql('SELECT FROM Investigation WHERE workspaceId=:ws AND deletedAt<>:live ORDER BY deletedAt DESC', { ws: workspaceId, live: '' })).map(clean).map(r => ({ ...r, network: publicNetwork(deps, r as Row) })),
  });

  api.route({
    method: 'post', path: '/api/investigations', summary: 'Open an investigation', tags: ['Investigations'],
    body: CreateInvestigation, response: Investigation, status: 201,
    handler: async ({ body, workspaceId }) => {
      const title = text(body.title, 200);
      if (!title) throw badRequest('Give your investigation a title');
      await entitlements.require(workspaceId, 'investigations');
      const t = now();
      const data = { id: randomUUID(), workspaceId, title, description: text(body.description, 10000), createdAt: t, updatedAt: t, version: 1, deletedAt: '' };
      await graph.sql('CREATE VERTEX Investigation CONTENT :data', { data });
      await entitlements.record(workspaceId, 'investigations');
      return data;
    },
  });

  api.route({
    method: 'get', path: '/api/investigations/:id', summary: 'An investigation with all its records and connections', tags: ['Investigations'],
    params: idParam, response: Dossier,
    handler: ({ params, workspaceId }) => dossier(deps, workspaceId, params.id),
  });

  api.route({
    method: 'patch', path: '/api/investigations/:id', summary: "Edit an investigation: title, question, and its network route and exit lock", tags: ['Investigations'],
    params: idParam,
    body: z.object({ title: z.string().max(200).optional(), description: z.string().max(4000).optional(), network: NetworkBody.optional() }),
    response: Investigation,
    handler: async ({ params, body, workspaceId }) => {
      const inv = await investigationIn(graph, workspaceId, params.id);
      if (body.network) await applyNetwork(deps, inv, body.network);
      const data: Row = {};
      if (body.title !== undefined) { data.title = text(body.title, 200); if (!data.title) throw badRequest('Title required'); }
      if (body.description !== undefined) data.description = text(body.description, 4000);
      const updated = await update(deps, 'Investigation', params.id, data) as Row;
      return { ...updated, network: publicNetwork(deps, updated) };
    },
  });

  api.route({
    method: 'delete', path: '/api/investigations/:id', summary: 'Archive an investigation recoverably; its research and evidence are retained', tags: ['Investigations'],
    params: idParam, response: Investigation,
    handler: async ({ params, workspaceId }) => {
      await investigationIn(graph, workspaceId, params.id);
      return update(deps, 'Investigation', params.id, { deletedAt: now() });
    },
  });

  api.route({
    method: 'post', path: '/api/investigations/:id/restore', summary: 'Restore an archived investigation', tags: ['Investigations'],
    params: idParam, response: Investigation,
    handler: async ({ params, workspaceId }) => {
      const [inv] = await graph.sql<Row>('SELECT FROM Investigation WHERE id=:id AND workspaceId=:ws AND deletedAt<>:live', { id: params.id, ws: workspaceId, live: '' });
      if (!inv) throw notFound('Archived investigation not found');
      return update(deps, 'Investigation', params.id, { deletedAt: '' });
    },
  });

  api.route({
    method: 'get', path: '/api/investigations/:id/changes', summary: 'Records and connections changed since a time, including deletions (for sync)', tags: ['Investigations'],
    params: idParam, query: Changes,
    response: z.object({ serverTime: z.string(), investigation: Investigation, records: z.array(RecordItem), connections: z.array(Connection) }),
    handler: async ({ params, query, workspaceId }) => {
      const serverTime = now();
      const investigation = clean(await investigationIn(graph, workspaceId, params.id));
      const since = query.since && !Number.isNaN(Date.parse(query.since)) ? new Date(query.since).toISOString() : '';
      const changed = async (type: string) => (await graph.sql(`SELECT FROM ${type} WHERE investigationId=:id AND workspaceId=:ws AND updatedAt > :since ORDER BY updatedAt ASC`, { id: params.id, ws: workspaceId, since })).map(clean);
      return { serverTime, investigation, records: await changed('Record'), connections: await changed('Connection') };
    },
  });

  api.route({
    method: 'post', path: '/api/records', summary: 'Add a record, optionally with an evidence file (multipart)', tags: ['Records'],
    body: CreateRecord, response: RecordItem, status: 201,
    upload: { field: 'file', description: 'Evidence original, up to 2 GB; stored by SHA-256', middleware: deps.upload('file') },
    handler: async ({ body, req, workspaceId }) => {
      const file = req.file;
      let stored = false;
      try {
        await investigationIn(graph, workspaceId, body.investigationId);
        const title = text(body.title, 200), kind = body.kind, status = body.status ?? 'Unverified';
        if (!title || !kind) throw badRequest('Title, valid record type and verification status required');
        const t = now();
        const data: Row = {
          id: randomUUID(), workspaceId, investigationId: body.investigationId, title, kind, status,
          notes: text(body.notes, 100000), sourceUrl: sourceUrl(body.sourceUrl), sourceLabel: text(body.sourceLabel, 300),
          eventDate: isoDate(body.eventDate), tags: text(body.tags, 1000), public: truthy(body.public),
          createdAt: t, updatedAt: t, version: 1, deletedAt: '',
        };
        if (file) {
          await entitlements.require(workspaceId, 'storage.bytes', file.size);
          const blob = await blobs.putFile(file.path);
          stored = true;
          Object.assign(data, { fileKey: blob.key, filename: path.basename(file.originalname), mime: file.mimetype, size: blob.size, sha256: blob.sha256 });
          await entitlements.record(workspaceId, 'storage.bytes', blob.size);
        }
        await graph.sql('CREATE VERTEX Record CONTENT :data', { data });
        return data;
      } finally {
        if (file && !stored) await fsp.unlink(file.path).catch(() => {});
      }
    },
  });

  api.route({
    method: 'patch', path: '/api/records/:id', summary: 'Edit a record', tags: ['Records'],
    params: idParam, body: UpdateRecord, response: RecordItem,
    handler: async ({ params, body, workspaceId, principal }) => {
      await recordIn(graph, workspaceId, params.id);
      const data: Row = review(body, principal.userId);
      for (const key of ['title', 'notes', 'sourceLabel', 'tags', 'eventDate'] as const) if (key in body) data[key] = text(body[key], key === 'notes' ? 100000 : 1000);
      if ('eventDate' in data) data.eventDate = isoDate(data.eventDate);
      if ('sourceUrl' in body) data.sourceUrl = sourceUrl(body.sourceUrl);
      if (body.status) data.status = body.status;
      if ('public' in body) data.public = body.public === true;
      if (data.title === '') throw badRequest('Title required');
      return update(deps, 'Record', params.id, data);
    },
  });

  api.route({
    method: 'delete', path: '/api/records/:id', summary: 'Delete a record (kept as a tombstone for sync; its connections are deleted too)', tags: ['Records'],
    params: idParam, response: z.object({ deleted: z.string(), connections: z.number() }),
    handler: async ({ params, workspaceId }) => {
      await recordIn(graph, workspaceId, params.id);
      const t = now();
      const [edges] = await graph.sql<{ count: number }>('UPDATE Connection SET deletedAt=:t, updatedAt=:t, version=ifnull(version, 1) + 1 WHERE workspaceId=:ws AND deletedAt=:live AND (fromId=:id OR toId=:id)', { t, ws: workspaceId, live: '', id: params.id });
      await update(deps, 'Record', params.id, { deletedAt: t });
      return { deleted: params.id, connections: edges?.count ?? 0 };
    },
  });

  api.route({
    method: 'post', path: '/api/connections', summary: 'Connect two records in the same investigation', tags: ['Connections'],
    body: CreateConnection, response: Connection, status: 201,
    handler: async ({ body, workspaceId }) => {
      const from = await recordIn(graph, workspaceId, body.fromId), to = await recordIn(graph, workspaceId, body.toId);
      if (from.investigationId !== to.investigationId || from.id === to.id) throw badRequest('Connect two different records in the same investigation');
      const label = text(body.label, 200);
      if (!label) throw badRequest('Connection label required');
      const evidenceId = text(body.evidenceId, 100);
      if (evidenceId && (await recordIn(graph, workspaceId, evidenceId)).investigationId !== from.investigationId) throw badRequest('Evidence must belong to this investigation');
      if (!RID.test(String(from['@rid'])) || !RID.test(String(to['@rid']))) throw Error('Invalid database record identity');
      const t = now();
      const data = {
        id: randomUUID(), workspaceId, investigationId: from.investigationId, fromId: from.id, toId: to.id, label, evidenceId,
        notes: text(body.notes, 10000), status: body.status ?? 'Unverified', public: body.public === true,
        createdAt: t, updatedAt: t, version: 1, deletedAt: '',
      };
      await graph.sql(`CREATE EDGE Connection FROM ${from['@rid']} TO ${to['@rid']} CONTENT :data`, { data });
      return data;
    },
  });

  api.route({
    method: 'patch', path: '/api/connections/:id', summary: 'Edit a connection', tags: ['Connections'],
    params: idParam, body: UpdateConnection, response: Connection,
    handler: async ({ params, body, workspaceId, principal }) => {
      const [existing] = await graph.sql('SELECT FROM Connection WHERE id=:id AND workspaceId=:ws AND deletedAt=:live', { id: params.id, ws: workspaceId, live: '' });
      if (!existing) throw notFound('Connection not found');
      const data: Row = review(body, principal.userId);
      if ('label' in body) data.label = text(body.label, 200);
      if ('notes' in body) data.notes = text(body.notes, 10000);
      if (data.label === '') throw badRequest('Connection label required');
      if (body.status) data.status = body.status;
      if ('public' in body) data.public = body.public === true;
      if ('evidenceId' in body) {
        data.evidenceId = text(body.evidenceId, 100);
        if (data.evidenceId && (await recordIn(graph, workspaceId, String(data.evidenceId))).investigationId !== existing.investigationId) throw badRequest('Evidence must belong to this investigation');
      }
      return update(deps, 'Connection', params.id, data);
    },
  });

  api.route({
    method: 'delete', path: '/api/connections/:id', summary: 'Delete a connection (kept as a tombstone for sync)', tags: ['Connections'],
    params: idParam, response: z.object({ deleted: z.string() }),
    handler: async ({ params, workspaceId }) => {
      const [existing] = await graph.sql('SELECT id FROM Connection WHERE id=:id AND workspaceId=:ws AND deletedAt=:live', { id: params.id, ws: workspaceId, live: '' });
      if (!existing) throw notFound('Connection not found');
      await update(deps, 'Connection', params.id, { deletedAt: now() });
      return { deleted: params.id };
    },
  });

  api.route({
    method: 'get', path: '/api/files/:id', summary: "A record's evidence original", tags: ['Records'],
    params: idParam, query: z.object({ download: z.string().optional().describe('Any value forces a download') }),
    produces: { 'application/octet-stream': 'The original bytes (images, video, audio and PDF are served with their type)' },
    handler: async ({ params, query, res, workspaceId }) => {
      const r = await recordIn(graph, workspaceId, params.id);
      if (!r.fileKey) throw notFound('No file attached');
      res.setHeader('Content-Security-Policy', "default-src 'none'; media-src 'self'; style-src 'unsafe-inline'; sandbox");
      const mime = PREVIEWABLE.test(String(r.mime)) ? String(r.mime) : 'application/octet-stream';
      res.type(mime);
      if (mime === 'application/octet-stream' || query.download) res.attachment(String(r.filename));
      res.sendFile(blobs.path(String(r.fileKey)));
      return RAW;
    },
  });

  api.route({
    method: 'get', path: '/api/investigations/:id/export', summary: 'Portable ZIP: dossier, map, CSV, JSON and originals', tags: ['Investigations'],
    params: idParam, query: z.object({ scope: z.enum(['selected', 'all']).optional().describe('selected (default): records marked for presentation; all: everything, private') }),
    produces: { 'application/zip': 'index.html, connection-map.svg, records.csv, connections.csv, investigation.json and files/' },
    handler: async ({ params, query, res, workspaceId }) => {
      const d = await dossier(deps, workspaceId, params.id);
      // How the researcher connected is not part of what they share.
      delete (d.investigation as { network?: unknown }).network;
      if (query.scope !== 'all') {
        d.records = d.records.filter(x => x.public);
        const ids = new Set(d.records.map(x => x.id));
        d.connections = d.connections.filter(x => x.public && ids.has(x.fromId) && ids.has(x.toId) && (!x.evidenceId || ids.has(x.evidenceId)));
      }
      res.attachment(`${String(d.investigation.title).replace(/[^a-z0-9]/gi, '-') || 'investigation'}.zip`);
      const zip = new ZipArchive({ zlib: { level: 5 } });
      zip.on('error', e => res.destroy(e));
      zip.pipe(res);
      zip.append(JSON.stringify(d, null, 2), { name: 'investigation.json' });
      zip.append(report(d), { name: 'index.html' });
      zip.append(graphSvg(d.records, d.connections), { name: 'connection-map.svg' });
      zip.append(csv(d.records, ['id', 'title', 'kind', 'status', 'eventDate', 'notes', 'sourceLabel', 'sourceUrl', 'sourceId', 'sourceQuote', 'tags', 'filename', 'sha256', 'createdAt']), { name: 'records.csv' });
      zip.append(csv(d.connections, ['id', 'fromId', 'label', 'toId', 'status', 'evidenceId', 'notes', 'sourceQuote']), { name: 'connections.csv' });
      for (const r of d.records) if (r.fileKey) zip.file(blobs.path(String(r.fileKey)), { name: `files/${r.id}/${path.basename(String(r.filename))}` });
      await zip.finalize();
      return RAW;
    },
  });
}
