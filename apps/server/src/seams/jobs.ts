import { randomUUID } from 'node:crypto';
import { clean } from '../http.ts';
import type { Graph } from './graph.ts';

/**
 * JobQueue seam: persistent background work. Jobs survive restarts, run one
 * at a time per server, keep a minimum spacing per kind (to respect services
 * like the Wayback Machine) and retry with backoff when a handler asks. Claims
 * are atomic, so several servers can share one database. A hosted deployment
 * replaces the store and runs a worker fleet with the same handlers.
 */
export class RetryableError extends Error {
  retryAfterMs: number;
  constructor(message: string, retryAfterMs: number) { super(message); this.retryAfterMs = retryAfterMs; }
}

export type JobState = 'queued' | 'running' | 'done' | 'failed';

export interface Job<P = Record<string, unknown>, R = unknown> {
  id: string; kind: string; workspaceId: string; investigationId: string; payload: P; state: JobState;
  attempts: number; runAfter: string; createdAt: string; updatedAt: string; result: R | null; error: string;
}

export interface JobHandler<P = any, R = any> {
  run(payload: P, job: Job<P, R>): Promise<R>;
  minIntervalMs?: number;
  maxAttempts?: number;
  onDone?(job: Job<P, R>, result: R): Promise<void>;
  onFailed?(job: Job<P, R>, error: Error): Promise<void>;
}

export interface JobStore {
  insert(job: Job): Promise<void>;
  update(id: string, changes: Partial<Job>): Promise<void>;
  /** Atomically move a queued job to running; false if another worker took it. */
  claim(id: string, changes: Partial<Job>): Promise<boolean>;
  get(id: string): Promise<Job | null>;
  nextQueued(): Promise<Job | null>;
  requeueRunning(before: string): Promise<void>;
  list(workspaceId: string, investigationId: string, limit: number): Promise<Job[]>;
}

const setClause = (changes: object) => Object.keys(changes).map(k => `${k}=:${k}`).join(', ');

export function arcadeJobStore(graph: Graph): JobStore {
  const one = async (sql: string, params: Record<string, unknown>) => { const [row] = await graph.sql<Job>(sql, params); return row ? clean(row) : null; };
  return {
    async insert(job) { await graph.sql('INSERT INTO Job CONTENT :job', { job }); },
    async update(id, changes) { await graph.sql(`UPDATE Job SET ${setClause(changes)} WHERE id=:id`, { ...changes, id }); },
    async claim(id, changes) {
      const [r] = await graph.sql<{ count: number }>(`UPDATE Job SET ${setClause(changes)} WHERE id=:id AND state=:queued`, { ...changes, id, queued: 'queued' });
      return (r?.count ?? 0) === 1;
    },
    get: id => one('SELECT FROM Job WHERE id=:id', { id }),
    nextQueued: () => one('SELECT FROM Job WHERE state=:queued ORDER BY runAfter ASC LIMIT 1', { queued: 'queued' }),
    // Note: `:before` is reserved in ArcadeDB SQL; use another parameter name.
    async requeueRunning(before) { await graph.sql('UPDATE Job SET state=:queued WHERE state=:running AND updatedAt < :cutoff', { queued: 'queued', running: 'running', cutoff: before }); },
    async list(workspaceId, investigationId, limit) {
      return (await graph.sql<Job>(`SELECT FROM Job WHERE workspaceId=:ws AND investigationId=:id ORDER BY createdAt DESC LIMIT ${Math.trunc(limit)}`, { ws: workspaceId, id: investigationId })).map(clean);
    },
  };
}

/** In-memory store with the same behaviour, for tests. */
export function memoryJobStore(): JobStore & { jobs: Map<string, Job> } {
  const jobs = new Map<string, Job>();
  return {
    jobs,
    async insert(job) { jobs.set(job.id, { ...job }); },
    async update(id, changes) { Object.assign(jobs.get(id)!, changes); },
    async claim(id, changes) { const j = jobs.get(id); if (!j || j.state !== 'queued') return false; Object.assign(j, changes); return true; },
    async get(id) { const j = jobs.get(id); return j ? { ...j } : null; },
    async nextQueued() { const j = [...jobs.values()].filter(x => x.state === 'queued').sort((a, b) => a.runAfter.localeCompare(b.runAfter))[0]; return j ? { ...j } : null; },
    async requeueRunning(before) { for (const j of jobs.values()) if (j.state === 'running' && j.updatedAt < before) j.state = 'queued'; },
    async list(workspaceId, investigationId) { return [...jobs.values()].filter(j => j.workspaceId === workspaceId && j.investigationId === investigationId).sort((a, b) => b.createdAt.localeCompare(a.createdAt)); },
  };
}

const STALE_MS = 10 * 60 * 1000;

export interface JobQueue {
  enqueue<P extends Record<string, unknown>>(kind: string, payload: P, scope: { workspaceId: string; investigationId?: string }): Promise<Job<P>>;
  get(id: string): Promise<Job | null>;
  list(workspaceId: string, investigationId: string, limit?: number): Promise<Job[]>;
  start(): Promise<void>;
  stop(): void;
}

export function createJobQueue(opts: { store: JobStore; handlers: Record<string, JobHandler>; now?: () => number; log?: Pick<Console, 'error'> }): JobQueue {
  const { store, handlers, now = () => Date.now(), log = console } = opts;
  const lastRun = new Map<string, number>();
  const iso = (ms: number) => new Date(ms).toISOString();
  let working = false, stopped = false, timer: NodeJS.Timeout | undefined;

  const kick = () => { if (!working && !stopped) void drain(); };
  const wake = (atMs: number) => { clearTimeout(timer); timer = setTimeout(kick, Math.max(0, atMs - now())); timer.unref?.(); };

  async function drain() {
    working = true;
    try {
      for (;;) {
        const job = await store.nextQueued();
        if (!job || stopped) return;
        const handler = handlers[job.kind];
        if (!handler) { await store.update(job.id, { state: 'failed', error: `No handler for ${job.kind}`, updatedAt: iso(now()) }); continue; }
        const earliest = Math.max(Date.parse(job.runAfter), (lastRun.get(job.kind) ?? -Infinity) + (handler.minIntervalMs ?? 0));
        if (earliest > now()) { wake(earliest); return; }
        const attempt = job.attempts + 1;
        if (!(await store.claim(job.id, { state: 'running', attempts: attempt, updatedAt: iso(now()) }))) continue;
        lastRun.set(job.kind, now());
        try {
          const result = await handler.run(job.payload, job);
          await store.update(job.id, { state: 'done', result, error: '', updatedAt: iso(now()) });
          await handler.onDone?.({ ...job, result }, result);
        } catch (e) {
          const error = e as Error & { retryAfterMs?: number };
          if (error.retryAfterMs && attempt < (handler.maxAttempts ?? 3)) {
            await store.update(job.id, { state: 'queued', error: error.message, runAfter: iso(now() + error.retryAfterMs * attempt), updatedAt: iso(now()) });
          } else {
            await store.update(job.id, { state: 'failed', error: error.message || String(error), updatedAt: iso(now()) });
            await handler.onFailed?.(job, error);
          }
        }
      }
    } catch (error) {
      log.error(`job queue: ${(error as Error).message}`);
      wake(now() + 5000);
    } finally {
      working = false;
    }
  }

  return {
    async enqueue(kind, payload, scope) {
      if (!handlers[kind]) throw Error(`Unknown job kind ${kind}`);
      const t = iso(now());
      const job: Job<typeof payload> = { id: randomUUID(), kind, workspaceId: scope.workspaceId, investigationId: scope.investigationId ?? '', payload, state: 'queued', attempts: 0, runAfter: t, createdAt: t, updatedAt: t, result: null, error: '' };
      await store.insert(job as Job);
      kick();
      return job;
    },
    get: id => store.get(id),
    list: (workspaceId, investigationId, limit = 200) => store.list(workspaceId, investigationId, limit),
    // Only jobs untouched for STALE_MS are taken back, so another live server's jobs are left alone.
    async start() { await store.requeueRunning(iso(now() - STALE_MS)); kick(); },
    stop() { stopped = true; clearTimeout(timer); },
  };
}
