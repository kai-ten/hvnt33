// Typed client for the hvnt33 API. `schema.d.ts` is generated from the
// server's OpenAPI description (`npm run openapi` at the repository root), so a
// route or shape change on the server shows up as a type error here.
import createFetchClient from 'openapi-fetch';
import type { components, paths } from './schema.d.ts';

export type { components, paths };

export interface ClientOptions {
  /** Server base URL, e.g. http://localhost:4310 or a hosted endpoint. */
  baseUrl: string;
  /** Bearer API token (token-mode servers). */
  token?: string;
  /** Custom transport, e.g. the desktop app's native bridge. */
  fetch?: typeof fetch;
}

/** The error body every route returns on failure. */
export type ApiError = components['schemas']['Error'];

export function createClient(options: ClientOptions) {
  return createFetchClient<paths>({
    baseUrl: options.baseUrl.replace(/\/$/, ''),
    headers: options.token ? { Authorization: `Bearer ${options.token}` } : {},
    ...(options.fetch ? { fetch: options.fetch } : {}),
  });
}

export type Client = ReturnType<typeof createClient>;

/** Unwrap a response: the data, or an Error carrying the server's message. */
export async function unwrap<T>(pending: Promise<{ data?: T; error?: unknown; response: Response }>): Promise<T> {
  const { data, error, response } = await pending;
  if (error !== undefined || !response.ok) {
    const message = (error as ApiError | undefined)?.error ?? `Request failed (${response.status})`;
    throw Object.assign(new Error(message), { status: response.status, code: (error as ApiError | undefined)?.code });
  }
  return data as T;
}
