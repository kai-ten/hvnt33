import type { Request, Response, RequestHandler, Router } from 'express';
import { z } from 'zod';
import type { Principal } from './seams/auth.ts';

/** An error with an HTTP status and a message safe to show the researcher. */
export class HttpError extends Error {
  status: number;
  code: string;
  details: Record<string, unknown> | undefined;
  constructor(status: number, message: string, code = '', details?: Record<string, unknown>) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (message: string) => new HttpError(400, message);
export const notFound = (message: string) => new HttpError(404, message, 'not_found');
export const conflict = (message: string) => new HttpError(409, message, 'conflict');

/** Drop ArcadeDB's internal fields (`@rid`, `@type`, …) before returning a row. */
export function clean<T extends object>(row: T): T {
  return Object.fromEntries(Object.entries(row).filter(([key]) => !key.startsWith('@'))) as T;
}

export interface Ctx<P, Q, B> {
  params: P;
  query: Q;
  body: B;
  principal: Principal;
  /** The workspace every read and write in this request is scoped to. */
  workspaceId: string;
  req: Request;
  res: Response;
}

type Method = 'get' | 'post' | 'patch' | 'delete';

export interface RouteSpec<P extends z.ZodType = z.ZodType, Q extends z.ZodType = z.ZodType, B extends z.ZodType = z.ZodType> {
  method: Method;
  /** Express path, e.g. `/api/records/:id`. */
  path: string;
  summary: string;
  tags: string[];
  params?: P;
  query?: Q;
  body?: B;
  /** Multipart upload: the named file field, alongside `body` fields sent as form text. */
  upload?: { field: string; description: string; middleware: RequestHandler };
  response?: z.ZodType;
  /** Non-JSON responses, e.g. `{ 'application/zip': 'The export' }`. */
  produces?: Record<string, string>;
  status?: number;
  /** Health checks and the spec itself are readable without a principal. */
  public?: boolean;
  handler: (ctx: Ctx<z.output<P>, z.output<Q>, z.output<B>>) => Promise<unknown> | unknown;
}

/** Handler return value meaning "I wrote the response myself". */
export const RAW = Symbol('raw-response');

function zodMessage(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) return 'Invalid request';
  const where = issue.path.length ? `${issue.path.join('.')}: ` : '';
  return `${where}${issue.message}`;
}

/**
 * The API's routes. Each route declares its inputs and output with zod; the
 * same declarations validate requests at runtime and generate `openapi.json`.
 */
export class Api {
  readonly routes: RouteSpec[] = [];
  /** Validate responses against their schemas (enabled in tests). */
  checkResponses = process.env.HVNT33_CONTRACT_CHECK === '1';

  route<P extends z.ZodType, Q extends z.ZodType, B extends z.ZodType>(spec: RouteSpec<P, Q, B>): void {
    this.routes.push(spec as unknown as RouteSpec);
  }

  mount(router: Router): void {
    for (const spec of this.routes) {
      const handlers: RequestHandler[] = [];
      if (spec.upload) handlers.push(spec.upload.middleware);
      handlers.push(async (req, res) => {
        const parse = <T extends z.ZodType>(schema: T | undefined, value: unknown) => {
          if (!schema) return value;
          const result = schema.safeParse(value ?? {});
          if (!result.success) throw new HttpError(400, zodMessage(result.error), 'invalid_request');
          return result.data;
        };
        const principal = res.locals.principal as Principal | undefined;
        if (!principal && !spec.public) throw new HttpError(401, 'Authentication required', 'unauthenticated');
        const result = await spec.handler({
          params: parse(spec.params, req.params),
          query: parse(spec.query, req.query),
          body: parse(spec.body, req.body),
          principal: principal as Principal,
          workspaceId: principal?.workspaceId ?? '',
          req,
          res,
        } as Ctx<unknown, unknown, unknown>);
        if (result === RAW || res.headersSent) return;
        // Contract check (tests): every JSON response must match its declared schema.
        if (this.checkResponses && spec.response) {
          const check = spec.response.safeParse(result);
          if (!check.success) throw new HttpError(500, `Response of ${spec.method.toUpperCase()} ${spec.path} breaks its contract: ${zodMessage(check.error)}`, 'contract');
        }
        // A handler may set res.locals.status, e.g. 200 when a create merged into an existing record.
        res.status((res.locals.status as number | undefined) ?? spec.status ?? 200).json(result);
      });
      router[spec.method](spec.path, ...handlers);
    }
  }

  /** OpenAPI 3.1 description of every route. */
  openapi(info: { title: string; version: string; description: string }): Record<string, unknown> {
    const json = (schema: z.ZodType, io: 'input' | 'output') =>
      z.toJSONSchema(schema, { io, unrepresentable: 'any', target: 'draft-2020-12' }) as Record<string, unknown>;
    const strip = (s: Record<string, unknown>) => { const { $schema: _, ...rest } = s; return rest; };
    const paths: Record<string, Record<string, unknown>> = {};
    for (const r of this.routes) {
      const path = r.path.replace(/:([A-Za-z]+)/g, '{$1}');
      const parameters: unknown[] = [];
      for (const [where, schema] of [['path', r.params], ['query', r.query]] as const) {
        if (!schema) continue;
        const s = json(schema, 'input') as { properties?: Record<string, Record<string, unknown>>; required?: string[] };
        for (const [name, prop] of Object.entries(s.properties ?? {})) {
          parameters.push({ name, in: where, required: where === 'path' || !!s.required?.includes(name), schema: prop, description: prop.description });
        }
      }
      const op: Record<string, unknown> = {
        summary: r.summary,
        tags: r.tags,
        operationId: `${r.method}${path.replace(/[{}]/g, '').split(/[/-]/).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join('')}`,
        ...(parameters.length ? { parameters } : {}),
        ...(r.public ? { security: [] } : {}),
      };
      if (r.body || r.upload) {
        if (r.upload) {
          const fields = r.body ? strip(json(r.body, 'input')) : { type: 'object', properties: {} };
          const props = { ...(fields.properties as Record<string, unknown>), [r.upload.field]: { type: 'string', format: 'binary', description: r.upload.description } };
          op.requestBody = { required: true, content: { 'multipart/form-data': { schema: { ...fields, properties: props } } } };
        } else {
          op.requestBody = { required: true, content: { 'application/json': { schema: strip(json(r.body!, 'input')) } } };
        }
      }
      const ok: Record<string, unknown> = { description: 'Success' };
      if (r.produces) ok.content = Object.fromEntries(Object.entries(r.produces).map(([type, description]) => [type, { schema: { type: 'string', format: 'binary', description } }]));
      else if (r.response) ok.content = { 'application/json': { schema: strip(json(r.response, 'output')) } };
      op.responses = {
        [String(r.status ?? 200)]: ok,
        default: { description: 'Error', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
      };
      (paths[path] ??= {})[r.method] = op;
    }
    return {
      openapi: '3.1.0',
      info,
      servers: [{ url: 'http://localhost:4310', description: 'Local hvnt33 server' }],
      security: [{ bearerAuth: [] }],
      paths,
      components: {
        securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', description: 'API token (token mode). Local mode trusts loopback requests and needs no token.' } },
        schemas: {
          Error: {
            type: 'object',
            required: ['error'],
            properties: { error: { type: 'string' }, code: { type: 'string' }, details: { type: 'object' } },
          },
        },
      },
    };
  }
}
