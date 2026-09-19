import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { type Api, HttpError, badRequest, clean, notFound } from '../http.ts';
import type { Row } from '../seams/graph.ts';
import { ENGINES, type Deps, httpUrl, idParam, investigationIn, limitQuery, listIn, now } from './common.ts';

// Observed search-engine result pages. A run records what one engine showed for
// one query at one moment in the researcher's browser; it is not a claim about
// the engine's full index. Saved searches are queries kept to re-run.

const QUALITIES = ['exact', 'display', 'truncated', 'opaque'] as const;

function words(value: unknown, max: number): string {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') throw badRequest('Expected text');
  return value.replace(/\s+/g, ' ').trim().slice(0, max);
}

export interface SerpResult { rank: number; title: string; url: string; snippet: string; domain: string; quality?: string; link?: string }

/**
 * Clean the results a page reported: http(s) only, de-duplicated, re-ranked.
 * `quality` says how the URL was obtained: exact (the result's own link),
 * display/truncated (rebuilt from what the engine displayed; `link` holds the
 * engine's redirect), or opaque (only the redirect is known).
 */
export function validateRun(body: any) {
  const engine = words(body.engine, 30), query = words(body.query, 1000), url = httpUrl(body.url);
  if (!(ENGINES as readonly string[]).includes(engine)) throw badRequest('Unknown search engine');
  if (!query) throw badRequest('Search query required');
  if (!url) throw badRequest('Results page URL must start with http:// or https://');
  if (!Array.isArray(body.results) || body.results.length > 100) throw badRequest('Results must be a list of up to 100 items');
  const seen = new Set<string>(), results: SerpResult[] = [];
  for (const item of body.results) {
    const link = httpUrl(item?.url);
    if (!link || seen.has(link)) continue;
    seen.add(link);
    const title = words(item.title, 300);
    if (!title) continue;
    const quality = (QUALITIES as readonly string[]).includes(item.quality) ? item.quality : 'exact';
    const result: SerpResult = { rank: results.length + 1, title, url: link, snippet: words(item.snippet, 1000), domain: quality === 'opaque' ? '' : new URL(link).hostname.toLowerCase().replace(/^www\./, '') };
    if (quality !== 'exact') { result.quality = quality; const redirect = httpUrl(item.link); if (redirect) result.link = redirect; }
    results.push(result);
  }
  return { engine, query, url, pageTitle: words(body.pageTitle, 300), results };
}

export function validateSaved(body: any) {
  const kind = body.kind === 'lab' ? 'lab' : body.kind === 'web' ? 'web' : '';
  if (!kind) throw badRequest('Saved search kind must be web or lab');
  const query = words(body.query, kind === 'lab' ? 4000 : 1000);
  if (!query) throw badRequest('Search query required');
  const engines = Array.isArray(body.engines) ? [...new Set(body.engines.filter((e: string) => (ENGINES as readonly string[]).includes(e)))] as string[] : [];
  if (kind === 'web' && !engines.length) throw badRequest('Choose at least one engine');
  return { kind, query, engines: kind === 'web' ? engines : [], label: words(body.label, 200) };
}

const Result = z.object({ rank: z.number(), title: z.string(), url: z.string(), snippet: z.string(), domain: z.string(), quality: z.enum(QUALITIES).optional(), link: z.string().optional() });
const SearchRun = z.looseObject({
  id: z.string(), workspaceId: z.string(), investigationId: z.string(), engine: z.enum(ENGINES), query: z.string(), url: z.string(),
  pageTitle: z.string(), results: z.array(Result), observedAt: z.string(), duplicate: z.boolean().optional(),
}).describe('What one engine displayed for one query at one time');
const SavedSearch = z.looseObject({
  id: z.string(), investigationId: z.string(), kind: z.enum(['web', 'lab']), query: z.string(), engines: z.array(z.string()),
  label: z.string(), createdAt: z.string(), lastRunAt: z.string(),
});

const RunBody = z.object({
  investigationId: z.string().max(100), engine: z.enum(ENGINES), query: z.string().max(5000), url: z.string().max(8000),
  pageTitle: z.string().max(5000).optional(),
  results: z.array(z.object({
    title: z.string().optional(), url: z.string().optional(), snippet: z.string().optional(),
    rank: z.number().optional().describe('Ignored: results are re-ranked in the order given'), domain: z.string().optional().describe('Ignored: derived from the URL'),
    quality: z.string().optional().describe('exact, display, truncated or opaque'), link: z.string().optional().describe("The engine's redirect link when the destination was hidden"),
  })).max(100),
});
const SavedBody = z.object({
  investigationId: z.string().max(100), kind: z.enum(['web', 'lab']), query: z.string().max(10000),
  engines: z.array(z.string()).max(20).optional(), label: z.string().max(1000).optional(),
});

const sameResults = (a: SerpResult[], b: SerpResult[]) => a.length === b.length && a.every((r, i) => r.url === b[i].url);

async function ownedDoc(deps: Deps, type: string, workspaceId: string, id: string, what: string) {
  const [row] = await deps.graph.sql(`SELECT FROM ${type} WHERE id=:id AND workspaceId=:ws`, { id, ws: workspaceId });
  if (!row) throw notFound(`${what} not found`);
  return row;
}

export function searchRoutes(api: Api, deps: Deps) {
  const { graph } = deps;

  api.route({
    method: 'post', path: '/api/searches', summary: 'Record what a results page showed (repeat reports within 10 minutes are merged)', tags: ['Searches'],
    body: RunBody, response: SearchRun, status: 201,
    handler: async ({ body, res, workspaceId }) => {
      await investigationIn(graph, workspaceId, body.investigationId);
      let run;
      try { run = validateRun(body); } catch (e) { throw e instanceof HttpError ? e : badRequest(String(e)); }
      // Page reloads and client-side re-renders report the same page repeatedly; keep one run.
      const since = new Date(Date.now() - 10 * 60 * 1000).toISOString();
      const [recent] = await graph.sql<Row & { results: SerpResult[] }>(
        'SELECT FROM SearchRun WHERE investigationId=:id AND workspaceId=:ws AND engine=:engine AND query=:query AND observedAt>=:since ORDER BY observedAt DESC LIMIT 1',
        { id: body.investigationId, ws: workspaceId, engine: run.engine, query: run.query, since });
      if (recent && sameResults(recent.results ?? [], run.results)) { res.locals.status = 200; return { ...clean(recent), duplicate: true }; }
      const data = { id: randomUUID(), workspaceId, investigationId: body.investigationId, ...run, observedAt: now(), via: 'hvnt33-desktop' };
      await graph.sql('INSERT INTO SearchRun CONTENT :data', { data });
      return data;
    },
  });

  api.route({
    method: 'get', path: '/api/investigations/:id/searches', summary: 'Recorded search runs, newest first', tags: ['Searches'],
    params: idParam, query: limitQuery(2000, 500), response: z.array(SearchRun),
    handler: async ({ params, query, workspaceId }) => {
      await investigationIn(graph, workspaceId, params.id);
      return listIn(graph, 'SearchRun', workspaceId, params.id, 'observedAt DESC', query.limit);
    },
  });

  api.route({
    method: 'delete', path: '/api/searches/:id', summary: 'Delete a recorded search run', tags: ['Searches'],
    params: idParam, response: z.object({ deleted: z.string() }),
    handler: async ({ params, workspaceId }) => {
      await ownedDoc(deps, 'SearchRun', workspaceId, params.id, 'Search run');
      await graph.sql('DELETE FROM SearchRun WHERE id=:id', { id: params.id });
      return { deleted: params.id };
    },
  });

  api.route({
    method: 'post', path: '/api/saved-searches', summary: 'Keep a web query (to re-run on engines) or a Search Lab query', tags: ['Searches'],
    body: SavedBody, response: SavedSearch, status: 201,
    handler: async ({ body, res, workspaceId }) => {
      await investigationIn(graph, workspaceId, body.investigationId);
      const saved = validateSaved(body);
      const [existing] = await graph.sql('SELECT FROM SavedSearch WHERE investigationId=:id AND workspaceId=:ws AND kind=:kind AND query=:query LIMIT 1', { id: body.investigationId, ws: workspaceId, kind: saved.kind, query: saved.query });
      if (existing) { res.locals.status = 200; return clean(existing); }
      const data = { id: randomUUID(), workspaceId, investigationId: body.investigationId, ...saved, createdAt: now(), lastRunAt: '' };
      await graph.sql('INSERT INTO SavedSearch CONTENT :data', { data });
      return data;
    },
  });

  api.route({
    method: 'get', path: '/api/investigations/:id/saved-searches', summary: 'Saved searches in an investigation', tags: ['Searches'],
    params: idParam, response: z.array(SavedSearch),
    handler: async ({ params, workspaceId }) => {
      await investigationIn(graph, workspaceId, params.id);
      return listIn(graph, 'SavedSearch', workspaceId, params.id);
    },
  });

  api.route({
    method: 'post', path: '/api/saved-searches/:id/run', summary: 'Mark a saved search as re-run now', tags: ['Searches'],
    params: idParam, response: SavedSearch,
    handler: async ({ params, workspaceId }) => {
      await ownedDoc(deps, 'SavedSearch', workspaceId, params.id, 'Saved search');
      await graph.sql('UPDATE SavedSearch SET lastRunAt=:t WHERE id=:id', { id: params.id, t: now() });
      return clean(await ownedDoc(deps, 'SavedSearch', workspaceId, params.id, 'Saved search'));
    },
  });

  api.route({
    method: 'delete', path: '/api/saved-searches/:id', summary: 'Remove a saved search', tags: ['Searches'],
    params: idParam, response: z.object({ deleted: z.string() }),
    handler: async ({ params, workspaceId }) => {
      await ownedDoc(deps, 'SavedSearch', workspaceId, params.id, 'Saved search');
      await graph.sql('DELETE FROM SavedSearch WHERE id=:id', { id: params.id });
      return { deleted: params.id };
    },
  });
}

export { ownedDoc };
