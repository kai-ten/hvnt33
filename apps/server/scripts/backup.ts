// Recovery backup: an ArcadeDB native snapshot packed with the evidence vault
// and a manifest into data/exports/. See docs/operations.md to restore.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { ZipArchive } from 'archiver';
import { loadConfig } from '../src/config.ts';
import { arcadeGraph } from '../src/seams/graph.ts';
import { connectDatabase } from '../src/seams/database.ts';

const config = loadConfig();
const database = await connectDatabase(config);
const graph = arcadeGraph(config.arcade);

async function files(dir: string): Promise<string[]> {
  const list: string[] = [];
  for (const entry of await fsp.readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) list.push(...(await files(file)));
    else list.push(file);
  }
  return list;
}

const before = new Set(await files(config.arcadeBackups));
await graph.sql('BACKUP DATABASE');
const added = (await files(config.arcadeBackups)).filter(f => !before.has(f) && f.endsWith('.zip'));
if (added.length !== 1) throw Error(`Could not identify the new native backup in ${config.arcadeBackups}`);
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
await fsp.mkdir(config.exportsDir, { recursive: true });
const destination = path.join(config.exportsDir, `hvnt33-backup-${stamp}.zip`);
const zip = new ZipArchive({ zlib: { level: 5 } });
const done = pipeline(zip, fs.createWriteStream(destination, { mode: 0o600 }));
zip.file(added[0], { name: 'database.zip' });
// Skip in-progress uploads; everything else in the vault is evidence.
zip.glob('**/*', { cwd: config.vaultDir, ignore: ['.uploads/**'], dot: false }, { prefix: 'vault' });
zip.append(JSON.stringify({ database: config.arcade.database, arcadedbVersion: database?.version ?? 'external', createdAt: new Date().toISOString(), nativeFile: path.basename(added[0]) }, null, 2), { name: 'manifest.json' });
zip.append('This is a private recovery backup. Restore database.zip using ArcadeDB bin/restore.sh to a NEW database directory while the server is stopped, and copy vault/ to data/vault. See docs/operations.md for tested restoration commands. No credentials are included.\n', { name: 'RESTORE.txt' });
await zip.finalize();
await done;
console.log(`Recovery backup saved: ${destination}`);
await database?.stop();
