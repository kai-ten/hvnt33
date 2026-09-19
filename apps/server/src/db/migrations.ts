import { LOCAL_WORKSPACE } from '../config.ts';
import type { Graph } from '../seams/graph.ts';

/**
 * Versioned schema migrations for ArcadeDB, applied in order at startup and
 * recorded in `SchemaMigration`. A migration never changes once released;
 * later changes are new migrations. Every statement is idempotent so a
 * migration interrupted part-way can safely run again.
 */
export interface Migration { version: number; name: string; up(graph: Graph): Promise<void> }

const VERTICES = ['Investigation', 'Record'];
const EDGES = ['Connection'];
const DOCUMENTS = ['Intake', 'SearchRun', 'PageVisit', 'SavedSearch', 'ArchiveHistory', 'Job'];
/** Types owned by a workspace. ArchiveHistory is public data about a URL and is shared. */
export const SCOPED = ['Investigation', 'Record', 'Connection', 'Intake', 'SearchRun', 'PageVisit', 'SavedSearch', 'Job', 'Snapshot', 'Watch', 'PageChange'];
const BY_INVESTIGATION = ['Record', 'Connection', 'Intake', 'SearchRun', 'PageVisit', 'SavedSearch', 'Job'];
// A migration must behave the same forever: it names the types that existed
// when it was written, never a list that later migrations extend.
const SCOPED_AT_V2 = ['Investigation', 'Record', 'Connection', 'Intake', 'SearchRun', 'PageVisit', 'SavedSearch', 'Job'];

async function index(graph: Graph, type: string, property: string, kind: 'UNIQUE' | 'NOTUNIQUE', dataType = 'STRING') {
  await graph.sql(`CREATE PROPERTY ${type}.${property} IF NOT EXISTS ${dataType}`);
  await graph.sql(`CREATE INDEX IF NOT EXISTS ON ${type} (${property}) ${kind}`);
}

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: 'Base schema: investigations, records, connections, intake, search runs, visits, saved searches, archive, jobs',
    async up(graph) {
      for (const t of VERTICES) await graph.sql(`CREATE VERTEX TYPE ${t} IF NOT EXISTS`);
      for (const t of EDGES) await graph.sql(`CREATE EDGE TYPE ${t} IF NOT EXISTS`);
      for (const t of DOCUMENTS) await graph.sql(`CREATE DOCUMENT TYPE ${t} IF NOT EXISTS`);
      for (const t of [...VERTICES, ...EDGES, ...DOCUMENTS]) await index(graph, t, 'id', 'UNIQUE');
      for (const t of BY_INVESTIGATION) await index(graph, t, 'investigationId', 'NOTUNIQUE');
      await index(graph, 'ArchiveHistory', 'url', 'UNIQUE');
      await index(graph, 'Job', 'state', 'NOTUNIQUE');
    },
  },
  {
    version: 2,
    name: 'Workspaces: every owned record belongs to a workspace; existing data joins the local workspace',
    async up(graph) {
      await graph.sql('CREATE DOCUMENT TYPE Workspace IF NOT EXISTS');
      await index(graph, 'Workspace', 'id', 'UNIQUE');
      const [local] = await graph.sql('SELECT id FROM Workspace WHERE id=:id', { id: LOCAL_WORKSPACE });
      if (!local) await graph.sql('INSERT INTO Workspace CONTENT :ws', { ws: { id: LOCAL_WORKSPACE, name: 'Local workspace', plan: 'unlimited', createdAt: new Date().toISOString() } });
      for (const t of SCOPED_AT_V2) {
        await index(graph, t, 'workspaceId', 'NOTUNIQUE');
        await graph.sql(`UPDATE ${t} SET workspaceId=:ws WHERE workspaceId IS NULL`, { ws: LOCAL_WORKSPACE });
      }
    },
  },
  {
    version: 3,
    name: 'Sync groundwork: version, updatedAt and deletedAt tombstones on investigations, records and connections',
    async up(graph) {
      for (const t of ['Investigation', 'Record', 'Connection']) {
        await graph.sql(`UPDATE ${t} SET version=1 WHERE version IS NULL`);
        await graph.sql(`UPDATE ${t} SET updatedAt=createdAt WHERE updatedAt IS NULL`);
        await graph.sql(`UPDATE ${t} SET deletedAt='' WHERE deletedAt IS NULL`);
        await index(graph, t, 'updatedAt', 'NOTUNIQUE');
      }
    },
  },
  {
    version: 4,
    name: 'API tokens and metered usage',
    async up(graph) {
      await graph.sql('CREATE DOCUMENT TYPE ApiToken IF NOT EXISTS');
      await index(graph, 'ApiToken', 'id', 'UNIQUE');
      await index(graph, 'ApiToken', 'tokenHash', 'UNIQUE');
      await graph.sql('CREATE DOCUMENT TYPE Usage IF NOT EXISTS');
      await index(graph, 'Usage', 'workspaceId', 'NOTUNIQUE');
    },
  },
  {
    version: 5,
    name: 'Usage rows keyed by workspace, metric and period (ArcadeDB upserts need a unique index)',
    async up(graph) {
      await index(graph, 'Usage', 'key', 'UNIQUE');
    },
  },
  {
    version: 6,
    name: 'Own archive: snapshots, watched pages and detected page changes',
    async up(graph) {
      for (const t of ['Snapshot', 'Watch', 'PageChange']) {
        await graph.sql(`CREATE DOCUMENT TYPE ${t} IF NOT EXISTS`);
        await index(graph, t, 'id', 'UNIQUE');
        await index(graph, t, 'investigationId', 'NOTUNIQUE');
        await index(graph, t, 'workspaceId', 'NOTUNIQUE');
      }
      await index(graph, 'Snapshot', 'url', 'NOTUNIQUE');
      await index(graph, 'Watch', 'nextRunAt', 'NOTUNIQUE');
    },
  },
];

const LOCK_ID = 'lock';
const LOCK_STALE_MS = 2 * 60 * 1000;

/** Create the database if needed and apply pending migrations. Returns the versions applied now. */
export async function migrate(graph: Graph, migrations = MIGRATIONS, log: (m: string) => void = () => {}): Promise<number[]> {
  const databases = await graph.server<unknown>('list databases');
  if (!JSON.stringify(databases).includes(`"${graph.database}"`)) await graph.server(`create database ${graph.database}`);
  await graph.sql('CREATE DOCUMENT TYPE SchemaMigration IF NOT EXISTS');
  await index(graph, 'SchemaMigration', 'id', 'UNIQUE');

  // One migrator at a time across servers sharing the database.
  for (let waited = 0; ; waited += 500) {
    try {
      await graph.sql('INSERT INTO SchemaMigration CONTENT :l', { l: { id: LOCK_ID, lockedAt: new Date().toISOString() } });
      break;
    } catch {
      const [lock] = await graph.sql<{ lockedAt: string }>('SELECT lockedAt FROM SchemaMigration WHERE id=:id', { id: LOCK_ID });
      if (lock && Date.now() - Date.parse(lock.lockedAt) > LOCK_STALE_MS) await graph.sql('DELETE FROM SchemaMigration WHERE id=:id', { id: LOCK_ID });
      else if (waited > LOCK_STALE_MS) throw Error('Timed out waiting for another server to finish migrating the database');
      await new Promise(r => setTimeout(r, 500));
    }
  }
  const applied: number[] = [];
  try {
    const done = new Set((await graph.sql<{ id: string }>('SELECT id FROM SchemaMigration')).map(r => r.id));
    for (const m of [...migrations].sort((a, b) => a.version - b.version)) {
      if (done.has(String(m.version))) continue;
      log(`Applying migration ${m.version}: ${m.name}`);
      await m.up(graph);
      await graph.sql('INSERT INTO SchemaMigration CONTENT :m', { m: { id: String(m.version), name: m.name, appliedAt: new Date().toISOString() } });
      applied.push(m.version);
    }
  } finally {
    await graph.sql('DELETE FROM SchemaMigration WHERE id=:id', { id: LOCK_ID });
  }
  return applied;
}
