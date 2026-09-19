import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { type Api, badRequest, clean } from '../http.ts';
import type { Row } from '../seams/graph.ts';
import { ENGINES, type Deps, httpUrl, idParam, investigationIn, limitQuery, line, listIn, now } from './common.ts';
import { ownedDoc } from './searches.ts';

// Pages the researcher opened while working a case, with the metadata the page
// declared. One document per case and URL; repeat visits update it. A visit is
// browsing history, not a source: capture a page to make it evidence.

const count = (v: unknown) => (Number.isInteger(v) && (v as number) >= 0 ? Math.min(v as number, 10_000_000) : 0);

export function validateVisit(body: any) {
  const url = httpUrl(body.url);
  if (!url) throw badRequest('Visited page URL must start with http:// or https://');
  const m = body.meta && typeof body.meta === 'object' ? body.meta : {};
  const meta = {
    canonical: httpUrl(m.canonical), author: line(m.author, 300), published: line(m.published, 60), modified: line(m.modified, 60),
    siteName: line(m.siteName, 200), type: line(m.type, 60), lang: line(m.lang, 20), description: line(m.description, 1000),
    schemaTypes: Array.isArray(m.schemaTypes) ? m.schemaTypes.filter((t: unknown) => typeof t === 'string').slice(0, 10).map((t: string) => line(t, 80)) : [],
    wordCount: count(m.wordCount), linksExternal: count(m.links?.external),
    topDomains: Array.isArray(m.links?.domains) ? m.links.domains.slice(0, 15).filter((d: any) => typeof d?.domain === 'string').map((d: any) => ({ domain: line(d.domain, 253), count: count(d.count) })) : [],
  };
  let found: { engine: string; query: string } | null = null;
  if (body.found && typeof body.found === 'object') {
    const engine = line(body.found.engine, 30), query = line(body.found.query, 1000);
    if ((ENGINES as readonly string[]).includes(engine) && query) found = { engine, query };
  }
  return { url, title: line(body.title, 300), referrer: httpUrl(body.referrer), meta, found };
}

const PageVisit = z.looseObject({
  id: z.string(), workspaceId: z.string(), investigationId: z.string(), url: z.string(), title: z.string(), referrer: z.string(),
  found: z.object({ engine: z.string(), query: z.string() }).nullable(), meta: z.looseObject({}),
  firstVisitedAt: z.string(), lastVisitedAt: z.string(), visits: z.number(),
}).describe('A page opened while working a case, with its declared metadata');

const VisitBody = z.object({
  investigationId: z.string().max(100), url: z.string().max(8000), title: z.string().max(5000).optional(), referrer: z.string().max(8000).optional(),
  found: z.object({ engine: z.string(), query: z.string() }).nullable().optional().describe('The search that led to the page'),
  meta: z.looseObject({}).optional().describe('What the page declares: author, dates, schema types, link counts…'),
});

export function visitRoutes(api: Api, deps: Deps) {
  const { graph } = deps;

  api.route({
    method: 'post', path: '/api/visits', summary: 'Log a page visit (one per case and URL; repeats update it)', tags: ['Visits'],
    body: VisitBody, response: PageVisit, status: 201,
    handler: async ({ body, res, workspaceId }) => {
      await investigationIn(graph, workspaceId, body.investigationId);
      const visit = validateVisit(body), t = now();
      const [existing] = await graph.sql<Row>('SELECT FROM PageVisit WHERE investigationId=:id AND workspaceId=:ws AND url=:url LIMIT 1', { id: body.investigationId, ws: workspaceId, url: visit.url });
      if (existing) {
        // Keep the first way the page was found; refresh what it declares now.
        await graph.sql('UPDATE PageVisit SET title=:title, meta=:meta, lastVisitedAt=:t, visits=visits+1 WHERE id=:vid', { title: visit.title || existing.title, meta: visit.meta, t, vid: existing.id });
        res.locals.status = 200;
        return clean(await ownedDoc(deps, 'PageVisit', workspaceId, String(existing.id), 'Visit'));
      }
      const data = { id: randomUUID(), workspaceId, investigationId: body.investigationId, ...visit, firstVisitedAt: t, lastVisitedAt: t, visits: 1, via: 'hvnt33-desktop' };
      await graph.sql('INSERT INTO PageVisit CONTENT :data', { data });
      return data;
    },
  });

  api.route({
    method: 'get', path: '/api/investigations/:id/visits', summary: 'Pages opened in this case, most recent first', tags: ['Visits'],
    params: idParam, query: limitQuery(5000, 1000), response: z.array(PageVisit),
    handler: async ({ params, query, workspaceId }) => {
      await investigationIn(graph, workspaceId, params.id);
      return listIn(graph, 'PageVisit', workspaceId, params.id, 'lastVisitedAt DESC', query.limit);
    },
  });

  api.route({
    method: 'delete', path: '/api/visits/:id', summary: 'Forget a visit', tags: ['Visits'],
    params: idParam, response: z.object({ deleted: z.string() }),
    handler: async ({ params, workspaceId }) => {
      await ownedDoc(deps, 'PageVisit', workspaceId, params.id, 'Visit');
      await graph.sql('DELETE FROM PageVisit WHERE id=:id', { id: params.id });
      return { deleted: params.id };
    },
  });
}
