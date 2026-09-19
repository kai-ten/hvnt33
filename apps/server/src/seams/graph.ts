import type { Config } from '../config.ts';

/**
 * GraphStore seam: the ArcadeDB database behind the server, reached over its
 * authenticated HTTP API. Locally the built-in database (seams/database.ts)
 * or one named by ARCADEDB_URL; in a hosted deployment a managed instance. Only this module knows how to talk to it.
 */
export type Row = Record<string, unknown>;

export interface Graph {
  readonly database: string;
  /** One SQL command with named parameters. */
  sql<T = Row>(command: string, params?: Record<string, unknown>): Promise<T[]>;
  /** Several statements in one transaction (`BEGIN; …; COMMIT`), as ArcadeDB sqlscript. */
  script<T = Row>(statements: string[], params?: Record<string, unknown>): Promise<T[]>;
  /** Server-level commands (`list databases`, `create database …`). */
  server<T = unknown>(command: string): Promise<T>;
}

// ArcadeDB reports transactional conflicts with these; they are safe to retry.
const RETRYABLE = /NeedRetryException|ConcurrentModificationException|Concurrent modification on page/;

export function arcadeGraph(config: Config['arcade'], fetcher: typeof fetch = fetch): Graph {
  const auth = 'Basic ' + Buffer.from(`${config.user}:${config.password}`).toString('base64');

  async function request<T>(path: string, body: unknown): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      const response = await fetcher(config.url + path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: auth },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30_000),
      });
      const data = (await response.json()) as { result?: T; error?: string; detail?: string; exception?: string };
      if (response.ok && !data.error) return data.result as T;
      const message = data.detail || data.error || 'Database request failed';
      // Retry only explicit transactional conflicts, never ambiguous network failures.
      if (attempt < 3 && RETRYABLE.test(`${data.exception ?? ''} ${message}`)) {
        await new Promise(resolve => setTimeout(resolve, 100 * (attempt + 1)));
        continue;
      }
      throw Error(message);
    }
  }

  const command = `/api/v1/command/${config.database}`;
  return {
    database: config.database,
    sql: (text, params = {}) => request(command, { language: 'sql', command: text, params }),
    script: (statements, params = {}) =>
      request(command, { language: 'sqlscript', command: ['BEGIN;', ...statements, 'COMMIT RETRY 3;'].join('\n'), params }),
    server: text => request('/api/v1/server', { command: text }),
  };
}
