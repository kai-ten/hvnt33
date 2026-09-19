// Test harness: starts a real server in-process on a free port, against the
// real ArcadeDB, in one of two profiles.
//
//   HVNT33_TEST_PROFILE=local  single researcher on loopback (the open-source default)
//   HVNT33_TEST_PROFILE=token  hosted shape: bearer tokens, isolated workspaces, plan limits
//
// The same API tests run under both; tenancy tests use the extra workspaces.
import type { AddressInfo } from 'node:net';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { loadConfig, type Config } from '../src/config.ts';
import { createServer, prepareDatabase } from '../src/app.ts';
import { createWorkspace, issueToken } from '../src/seams/auth.ts';
import type { Graph } from '../src/seams/graph.ts';
import { fetchCapture } from '../src/seams/capture.ts';
import { connectDatabase } from '../src/seams/database.ts';

export const profile: 'local' | 'token' = process.env.HVNT33_TEST_PROFILE === 'token' ? 'token' : 'local';
export const testDatabase = process.env.HVNT33_TEST_DATABASE || `${process.env.ARCADEDB_DATABASE || 'newsroom'}_test`;
process.env.HVNT33_CONTRACT_CHECK = '1';

export interface Client {
  headers: Record<string, string>;
  workspaceId: string;
  token: string;
  /** Fetch a route; JSON bodies are encoded, FormData passed through. */
  call(route: string, body?: unknown, method?: string, extra?: Record<string, string>): Promise<{ status: number; json: any; res: Response }>;
  /** Like call, but asserts success and returns the JSON. */
  api(route: string, body?: unknown, method?: string): Promise<any>;
  /** Run the research CLI against this server as this client. */
  cli(...args: string[]): Promise<any>;
}

export interface Harness {
  base: string;
  /** The snapshot replay site's origin (a second listener). */
  replayBase: string;
  config: Config;
  graph: Graph;
  /** Workspace A (local mode: the local workspace). */
  a: Client;
  /** Workspace B (token mode only): must never see A's data. */
  b: Client | null;
  /** A workspace on a tiny plan (token mode only), for entitlement tests. */
  limited: Client | null;
  close(): Promise<void>;
}

const run = promisify(execFile);
const root = path.resolve(import.meta.dirname, '../../..');

function client(base: string, workspaceId: string, token: string): Client {
  const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
  const call: Client['call'] = async (route, body, method, extra = {}) => {
    const form = body instanceof FormData;
    const res = await fetch(base + route, {
      method: method ?? (body === undefined ? 'GET' : 'POST'),
      headers: { ...headers, ...(body !== undefined && !form ? { 'Content-Type': 'application/json' } : {}), ...extra },
      body: body === undefined ? undefined : form ? body : JSON.stringify(body),
    });
    const text = await res.clone().text();
    let json: any = null;
    try { json = text ? JSON.parse(text) : null; } catch { json = text; }
    return { status: res.status, json, res };
  };
  return {
    headers, workspaceId, token, call,
    async api(route, body, method) {
      const { status, json } = await call(route, body, method);
      if (status >= 400) throw Error(`${method ?? (body === undefined ? 'GET' : 'POST')} ${route} → ${status}: ${JSON.stringify(json)}`);
      return json;
    },
    async cli(...args) {
      const { stdout } = await run(process.execPath, ['--env-file=.env', 'apps/server/scripts/research.ts', ...args], {
        cwd: root, env: { ...process.env, HVNT33_URL: base, ...(token ? { HVNT33_TOKEN: token } : {}) },
      });
      return JSON.parse(stdout);
    },
  };
}

export async function start(): Promise<Harness> {
  // Files (uploads, archives) go to a throwaway data directory, never the researcher's vault.
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hvnt33-test-'));
  const config = loadConfig({
    ...process.env,
    HVNT33_DATA_DIR: dataDir,
    // Its own database (created on first run), so tests never touch research
    // and no other hvnt33 server picks up their jobs or watches.
    ARCADEDB_DATABASE: testDatabase,
    HVNT33_AUTH: profile,
    // The fixture web pages are on loopback; the private-address guard is tested by switching it on.
    HVNT33_ALLOW_PRIVATE_URLS: '1',
    // Offline: never the real Tor network (npm run test:live does that).
    HVNT33_TOR_BUILTIN: process.env.HVNT33_LIVE === '1' ? '' : '0',
    HVNT33_PLANS: JSON.stringify({ tiny: { limits: { investigations: 1, 'captures.monthly': 1, 'archive.saves.monthly': 0, 'snapshots.monthly': 1, watches: 0 } } }),
  });
  // ARCADEDB_URL set: that ArcadeDB. Unset: a built-in database of the test's own, in its data directory.
  const database = await connectDatabase(config);
  // Offline and fast: pages are archived by fetch (the test web server is on
  // this machine), and trusted timestamps are simulated as unavailable. The
  // live checks (npm run test:live) use the real crawler and authorities.
  const server = createServer(config, process.env.HVNT33_LIVE === '1' ? {} : {
    capture: fetchCapture(),
    timestamper: async () => ({ tokens: [], errors: [{ tsa: 'offline-test', error: 'Timestamps are not requested in offline tests' }] }),
  });
  await prepareDatabase(server.deps.graph, () => {});
  const listener = server.app.listen(0, '127.0.0.1');
  await new Promise(resolve => listener.once('listening', resolve));
  const base = `http://localhost:${(listener.address() as AddressInfo).port}`;
  const replayListener = server.replay.listen(0, '127.0.0.1');
  await new Promise(resolve => replayListener.once('listening', resolve));
  const replayBase = `http://localhost:${(replayListener.address() as AddressInfo).port}`;
  config.replay.publicUrl = replayBase;
  const graph = server.deps.graph;
  const workspaces: string[] = [];

  let a: Client, b: Client | null = null, limited: Client | null = null;
  if (profile === 'local') {
    a = client(base, 'local', '');
  } else {
    const make = async (name: string, plan = 'unlimited') => {
      const ws = await createWorkspace(graph, `TEST — ${name}`, plan);
      workspaces.push(ws.id);
      return client(base, ws.id, (await issueToken(graph, ws.id, `${name}@test.invalid`)).token);
    };
    a = await make('workspace A');
    b = await make('workspace B');
    limited = await make('tiny plan', 'tiny');
  }

  return {
    base, replayBase, config, graph, a, b, limited,
    async close() {
      server.jobs.stop();
      await server.relays.close();
      await server.deps.tor.stop();
      await new Promise(resolve => { listener.close(resolve); listener.closeAllConnections(); });
      await new Promise(resolve => { replayListener.close(resolve); replayListener.closeAllConnections(); });
      for (const ws of workspaces) {
        for (const type of ['Connection', 'Record', 'Intake', 'SearchRun', 'PageVisit', 'SavedSearch', 'Job', 'Snapshot', 'Watch', 'PageChange', 'Investigation', 'Usage', 'ApiToken']) {
          await graph.sql(`DELETE FROM ${type} WHERE workspaceId=:ws`, { ws });
        }
        await graph.sql('DELETE FROM Workspace WHERE id=:ws', { ws });
      }
      await database?.stop();
      fs.rmSync(dataDir, { recursive: true, force: true });
    },
  };
}

/** Remove everything a test created in one investigation, in any workspace. */
export async function removeInvestigation(graph: Graph, id: string): Promise<void> {
  for (const type of ['Connection', 'Record', 'Intake', 'SearchRun', 'PageVisit', 'SavedSearch', 'Job', 'Snapshot', 'Watch', 'PageChange']) await graph.sql(`DELETE FROM ${type} WHERE investigationId=:id`, { id });
  await graph.sql('DELETE FROM Investigation WHERE id=:id', { id });
}
