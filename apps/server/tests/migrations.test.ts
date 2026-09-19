// Migrations on a brand-new database: what a first-time user gets.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadConfig } from '../src/config.ts';
import { MIGRATIONS, SCOPED, migrate } from '../src/db/migrations.ts';
import { arcadeGraph } from '../src/seams/graph.ts';
import { connectDatabase } from '../src/seams/database.ts';

test('a fresh database migrates to the latest schema, and migrating again changes nothing', async () => {
  // ARCADEDB_URL set: that ArcadeDB. Unset: a built-in database in a throwaway data directory.
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hvnt33-migrate-'));
  const base = loadConfig({ ...process.env, HVNT33_DATA_DIR: dataDir });
  const database = await connectDatabase(base);
  const graph = arcadeGraph({ ...base.arcade, database: `hvnt33_fresh_${randomBytes(4).toString('hex')}` });
  try {
    const applied = await migrate(graph);
    assert.deepEqual(applied, MIGRATIONS.map(m => m.version));
    const types = new Map((await graph.sql<{ name: string; indexes?: { properties: string[] }[] }>('SELECT name, indexes FROM schema:types')).map(t => [t.name, t]));
    for (const t of SCOPED) {
      assert.ok(types.has(t), `${t} exists`);
      const indexed = JSON.stringify(types.get(t)!.indexes ?? []);
      assert.ok(indexed.includes('"workspaceId"'), `${t} is indexed by workspace`);
      assert.ok(indexed.includes('"id"'), `${t} has a unique id index`);
    }
    assert.deepEqual(await migrate(graph), []);
    const [local] = await graph.sql('SELECT plan FROM Workspace WHERE id=:id', { id: 'local' });
    assert.equal(local.plan, 'unlimited');
  } finally {
    await graph.server(`drop database ${graph.database}`).catch(() => {});
    await database?.stop();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
