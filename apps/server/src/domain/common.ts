import type { RouteRelays } from '../seams/relay.ts';
import type { SecretStore } from '../seams/secrets.ts';
import type { BuiltinTor } from '../seams/tor.ts';
import { z } from 'zod';
import type { RequestHandler } from 'express';
import type { Config } from '../config.ts';
import { badRequest, clean, notFound } from '../http.ts';
import type { BlobStore } from '../seams/blobs.ts';
import type { Entitlements } from '../seams/entitlements.ts';
import type { Graph, Row } from '../seams/graph.ts';
import type { JobQueue } from '../seams/jobs.ts';
import type { CaptureService } from '../seams/capture.ts';
import type { TimestampToken } from '../seams/timestamps.ts';

/** Everything a route module needs, injected so tests can build any configuration. */
export interface Deps {
  config: Config;
  graph: Graph;
  blobs: BlobStore;
  entitlements: Entitlements;
  jobs: JobQueue;
  /** Multer middleware for a single file field. */
  upload(field: string): RequestHandler;
  /** How pages are captured into snapshots (the app's browser, or fetch). */
  captureService(): Promise<CaptureService>;
  /** Trusted timestamps for a SHA-256 digest from the configured authorities. */
  timestamper(sha256: Buffer): Promise<{ tokens: TimestampToken[]; errors: { tsa: string; error: string }[] }>;
  /** Local relays that log in to cases' routes (credentials, Tor circuits). */
  relays: RouteRelays;
  /** Route credentials, kept outside the database. */
  secrets: SecretStore;
  /** Tor built into hvnt33, started when a case uses it. */
  tor: BuiltinTor;
}

export const KINDS = ['Person', 'Organization', 'Place', 'Event', 'Claim', 'Document', 'Image', 'Video', 'Link', 'Note'] as const;
export const ENTITY_KINDS = new Set(['Person', 'Organization', 'Place']);
export const STATUSES = ['Unverified', 'Corroborated', 'Verified', 'Disputed'] as const;
export const ENGINES = ['google', 'duckduckgo', 'bing', 'brave', 'startpage', 'mojeek', 'yandex'] as const;

/** Trimmed text cut to `max` characters; missing or non-text values become ''. */
export function text(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

/** Text with whitespace collapsed, cut to `max`. */
export function line(value: unknown, max: number): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '';
}

/** An http(s) URL, or '' for anything else. */
export function httpUrl(value: unknown): string {
  if (typeof value !== 'string' || !value) return '';
  try { const u = new URL(value); if (u.protocol === 'http:' || u.protocol === 'https:') return u.href; } catch { /* invalid */ }
  return '';
}

/** An optional source URL: '' when absent, 400 when present but not http(s). */
export function sourceUrl(value: unknown): string {
  if (value === undefined || value === null || value === '') return '';
  const url = httpUrl(value);
  if (!url) throw badRequest('Source URL must start with http:// or https://');
  return url;
}

export function isoDate(value: unknown, message = 'Date must be YYYY-MM-DD'): string {
  const d = text(value, 10);
  if (d && (!/^\d{4}-\d{2}-\d{2}$/.test(d) || Number.isNaN(Date.parse(d)) || new Date(d).toISOString().slice(0, 10) !== d)) throw badRequest(message);
  return d;
}

export const truthy = (v: unknown) => v === true || v === 'true';
export const now = () => new Date().toISOString();

/** The investigation, if it exists in this workspace and is not deleted; otherwise 404. */
export async function investigationIn(graph: Graph, workspaceId: string, id: string): Promise<Row> {
  const [row] = await graph.sql('SELECT FROM Investigation WHERE id=:id AND workspaceId=:ws AND deletedAt=:live', { id, ws: workspaceId, live: '' });
  if (!row) throw notFound('Investigation not found');
  return row;
}

export async function recordIn(graph: Graph, workspaceId: string, id: string): Promise<Row> {
  const [row] = await graph.sql('SELECT FROM Record WHERE id=:id AND workspaceId=:ws AND deletedAt=:live', { id, ws: workspaceId, live: '' });
  if (!row) throw notFound('Record not found');
  return row;
}

export async function listIn<T = Row>(graph: Graph, type: string, workspaceId: string, investigationId: string, order = 'createdAt DESC', limit?: number): Promise<T[]> {
  const live = ['Record', 'Connection'].includes(type) ? ' AND deletedAt=:live' : '';
  const rows = await graph.sql<T & Row>(`SELECT FROM ${type} WHERE investigationId=:id AND workspaceId=:ws${live} ORDER BY ${order}${limit ? ` LIMIT ${Math.trunc(limit)}` : ''}`, { id: investigationId, ws: workspaceId, live: '' });
  return rows.map(r => clean(r) as T);
}

export const idParam = z.object({ id: z.string().min(1).max(100).describe('Identifier') });
export const limitQuery = (max: number, fallback: number) => z.object({
  limit: z.coerce.number().int().min(1).max(max).default(fallback).describe(`Maximum rows (1–${max}, default ${fallback})`),
});

// ── Entity schemas (responses) ───────────────────────────────────────────────
// Loose objects: stored documents may carry more fields than documented.

export const CaseNetwork = z.looseObject({
  route: z.string().max(300).describe("Proxy the case's traffic goes through: socks5://host:port or http://host:port; empty for direct"),
  label: z.string().max(100).describe('A name for the route, e.g. "Tor" or "Mullvad Sweden"'),
  lock: z.object({ country: z.string().max(100), org: z.string().max(200) }).nullable().describe('Pause the case when its exit leaves this country or network'),
  tor: z.boolean().optional().describe('Route through Tor (a running Tor Browser or tor service), on its own circuit'),
  circuit: z.number().int().optional().describe('Tor circuit number; "New exit" increases it'),
  hasCredentials: z.boolean().optional().describe('The route logs in with a username and password (kept on this machine, never returned)'),
}).describe("The case's network route and exit lock");

export const Investigation = z.looseObject({
  id: z.string(), workspaceId: z.string(), title: z.string(), description: z.string(),
  createdAt: z.string(), updatedAt: z.string(), version: z.number(), deletedAt: z.string(),
  network: CaseNetwork.optional(),
}).describe('An investigation (case)');

export const RecordItem = z.looseObject({
  id: z.string(), workspaceId: z.string(), investigationId: z.string(), title: z.string(),
  kind: z.enum(KINDS), status: z.enum(STATUSES), notes: z.string(), sourceUrl: z.string(), sourceLabel: z.string(),
  eventDate: z.string(), tags: z.string(), public: z.boolean(),
  fileKey: z.string().optional(), filename: z.string().optional(), mime: z.string().optional(), size: z.number().optional(), sha256: z.string().optional(),
  sourceQuote: z.string().optional(), sourceId: z.string().optional(), intakeId: z.string().optional(), filedBy: z.string().optional(), contentOrigin: z.string().optional(),
  createdAt: z.string(), updatedAt: z.string(), version: z.number(), deletedAt: z.string(),
  reviewedAt: z.string().optional().describe('When a person last reviewed this; empty or absent: never'), reviewedBy: z.string().optional(),
}).describe('A person, organization, place, event, claim, document, image, video, link or note');

export const Connection = z.looseObject({
  id: z.string(), workspaceId: z.string(), investigationId: z.string(), fromId: z.string(), toId: z.string(),
  label: z.string(), status: z.enum(STATUSES), notes: z.string(), evidenceId: z.string(), public: z.boolean(),
  sourceQuote: z.string().optional(), createdAt: z.string(), updatedAt: z.string(), version: z.number(), deletedAt: z.string(),
  reviewedAt: z.string().optional(), reviewedBy: z.string().optional(),
}).describe('A sourced relationship between two records');

export const Dossier = z.object({ investigation: Investigation, records: z.array(RecordItem), connections: z.array(Connection) });
