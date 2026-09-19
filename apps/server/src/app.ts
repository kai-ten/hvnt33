import fs from 'node:fs';
import express, { type NextFunction, type Request, type Response } from 'express';
import multer from 'multer';
import { z } from 'zod';
import type { Config } from './config.ts';
import { Api, HttpError, clean } from './http.ts';
import { migrate } from './db/migrations.ts';
import { archiveJobs, archiveRoutes } from './domain/archive.ts';
import type { Deps } from './domain/common.ts';
import { intakeRoutes } from './domain/intake.ts';
import { investigationRoutes } from './domain/investigations.ts';
import { searchRoutes } from './domain/searches.ts';
import { visitRoutes } from './domain/visits.ts';
import { replaySite, snapshotJobs, snapshotRoutes } from './domain/snapshots.ts';
import { caseNetworkRoutes } from './domain/caseNetwork.ts';
import { RouteRelays } from './seams/relay.ts';
import { fileSecrets } from './seams/secrets.ts';
import { BuiltinTor } from './seams/tor.ts';
import { type CaptureService, chooseCapture } from './seams/capture.ts';
import { timestamp } from './seams/timestamps.ts';
import { type AuthProvider, localAuth, tokenAuth } from './seams/auth.ts';
import { localBlobStore } from './seams/blobs.ts';
import { type Entitlements, planEntitlements, unlimited } from './seams/entitlements.ts';
import { type Graph, arcadeGraph } from './seams/graph.ts';
import { arcadeJobStore, createJobQueue, type JobQueue } from './seams/jobs.ts';

export const VERSION = '0.2.0';
/** Capabilities clients can rely on; the desktop app checks these. */
export const FEATURES = ['search-runs', 'browser-capture', 'page-visits', 'saved-searches', 'archive', 'workspaces', 'openapi', 'snapshots', 'watches'];

export interface Server {
  app: express.Express;
  api: Api;
  deps: Deps;
  auth: AuthProvider;
  jobs: JobQueue;
  /** The replay site, served on its own origin (see config.replay). */
  replay: express.Express;
  /** Case route relays (closed with the server). */
  relays: RouteRelays;
}

/**
 * Assemble the server for a configuration. Every deployment difference is a
 * seam chosen here: auth (local or token), entitlements (unlimited or plans),
 * blobs, graph and jobs. Tests pass overrides to build both configurations.
 */
export function createServer(config: Config, overrides: Partial<{ graph: Graph; auth: AuthProvider; entitlements: Entitlements; jobs: JobQueue; capture: CaptureService; timestamper: Deps['timestamper'] }> = {}): Server {
  const graph = overrides.graph ?? arcadeGraph(config.arcade);
  const blobs = localBlobStore(config.vaultDir);
  const auth = overrides.auth ?? (config.auth === 'token' ? tokenAuth(graph) : localAuth());
  const entitlements = overrides.entitlements ?? (config.auth === 'token' ? planEntitlements(graph, config.plans) : unlimited());
  const uploader = multer({ dest: blobs.uploadDir, limits: { fileSize: 2 * 1024 * 1024 * 1024, files: 1 } });
  let capture: CaptureService | null = overrides.capture ?? null;
  const deps: Deps = {
    config, graph, blobs, entitlements, jobs: null as unknown as JobQueue, upload: field => uploader.single(field),
    // Chosen on first use: inside the desktop app, its browser; otherwise the server's own fetch.
    captureService: async () => (capture ??= chooseCapture(config.snapshots.capture)),
    timestamper: overrides.timestamper ?? (digest => timestamp(digest, config.snapshots.timestampAuthorities)),
    relays: new RouteRelays(),
    secrets: fileSecrets(config.network.secretsDir),
    tor: new BuiltinTor(config.network.torBinary, config.network.torDataDir),
  };
  const jobs = overrides.jobs ?? createJobQueue({ store: arcadeJobStore(graph), handlers: { ...archiveJobs(graph, config.archiveOrg), ...snapshotJobs(deps) } });
  deps.jobs = jobs;

  const api = new Api();
  api.route({
    method: 'get', path: '/api/health', summary: 'Server and database health, and the features this server supports', tags: ['Server'], public: true,
    response: z.object({ ok: z.boolean(), database: z.string(), version: z.string(), auth: z.enum(['local', 'token']), features: z.array(z.string()), replayUrl: z.string().describe('Origin of the snapshot replay site') }),
    handler: async () => {
      await graph.sql('SELECT FROM Investigation LIMIT 1');
      return { ok: true, database: 'ArcadeDB', version: VERSION, auth: auth.mode, features: FEATURES, replayUrl: config.replay.publicUrl };
    },
  });
  api.route({
    method: 'get', path: '/api/workspace', summary: 'The workspace this request acts in, with plan usage', tags: ['Server'],
    response: z.object({ id: z.string(), name: z.string(), plan: z.string(), usage: z.looseObject({}) }),
    handler: async ({ workspaceId }) => {
      const [ws] = await graph.sql('SELECT FROM Workspace WHERE id=:id', { id: workspaceId });
      if (!ws) throw new HttpError(404, 'Workspace not found');
      const w = clean(ws) as { id: string; name: string; plan?: string };
      return { id: w.id, name: w.name, plan: w.plan || 'unlimited', usage: await entitlements.usage(workspaceId) };
    },
  });
  investigationRoutes(api, deps);
  intakeRoutes(api, deps);
  searchRoutes(api, deps);
  visitRoutes(api, deps);
  archiveRoutes(api, deps);
  caseNetworkRoutes(api, deps);

  const spec = () => api.openapi({ title: 'hvnt33 API', version: VERSION, description: 'Investigations, evidence, intake, observed search results, visits and web archive. Local mode trusts loopback requests; token mode requires a bearer API token and scopes every request to its workspace.' });
  api.route({
    method: 'get', path: '/api/openapi.json', summary: 'This API description (OpenAPI 3.1)', tags: ['Server'], public: true,
    handler: () => spec(),
  });

  const app = express();
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    // Local mode is only reachable as localhost; token mode may sit behind a proxy.
    const host = (req.headers.host || '').split(':')[0];
    if (config.auth === 'local' && !['127.0.0.1', 'localhost'].includes(host)) return void res.status(403).json({ error: 'Local access only' });
    // Browsers from other sites may not call the API (CSRF); non-browser clients send no Origin.
    if (req.headers.origin && !config.allowedOrigins.includes(req.headers.origin)) return void res.status(403).json({ error: 'Origin rejected' });
    // Other sites' pages may not use the API on ambient trust, including
    // snapshots replayed on the replay origin (same site, other port) and
    // requests without an Origin such as images and navigations. Browsers set
    // Sec-Fetch-Site and scripts cannot remove it. The web workspace, served
    // from this origin, is same-origin.
    const site = req.headers['sec-fetch-site'];
    if (req.path.startsWith('/api/') && site && site !== 'none' && site !== 'same-origin' && !req.headers.origin) return void res.status(403).json({ error: 'The API is not available to other sites', code: 'forbidden' });
    next();
  });
  app.use(express.json({ limit: '2mb' }));
  app.use(async (req, res, next) => {
    try { res.locals.principal = await auth.authenticate(req); next(); } catch (e) { next(e); }
  });
  const router = express.Router();
  snapshotRoutes(api, deps);
  api.mount(router);
  app.use(router);
  app.use('/api', (req, res) => void res.status(404).json({ error: `No route ${req.method} ${req.originalUrl}`, code: 'not_found' }));
  if (fs.existsSync(config.publicDir)) app.use(express.static(config.publicDir));
  app.use((error: unknown, req: Request, res: Response, _next: NextFunction) => {
    if (res.headersSent) return void res.destroy();
    if (error instanceof HttpError) return void res.status(error.status).json({ error: error.message, ...(error.code ? { code: error.code } : {}), ...(error.details ? { details: error.details } : {}) });
    if (error instanceof multer.MulterError) return void res.status(400).json({ error: error.message, code: 'upload' });
    if ((error as { type?: string }).type === 'entity.parse.failed') return void res.status(400).json({ error: 'Request body is not valid JSON', code: 'invalid_request' });
    console.error(`${req.method} ${req.originalUrl}: ${(error as Error).stack ?? error}`);
    res.status(500).json({ error: 'The operation failed. Check the server log.', code: 'internal' });
  });
  return { app, api, deps, auth, jobs, replay: replaySite(deps), relays: deps.relays };
}

/** Wait for ArcadeDB (it may still be starting) and apply migrations. */
export async function prepareDatabase(graph: Graph, log: (m: string) => void = console.log): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try { await migrate(graph, undefined, log); return; } catch (error) {
      if (attempt >= 30) throw error;
      await new Promise(r => setTimeout(r, 1000));
    }
  }
}
