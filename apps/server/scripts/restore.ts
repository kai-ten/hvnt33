// Restore a recovery backup (npm run backup) into a NEW database, never over an existing one.
//   npm run restore -- path/to/hvnt33-backup-….zip newsroom_restored
// Stop the app or `npm start` first: the built-in database must not be running.
// Then set ARCADEDB_DATABASE=<name> in .env and start again.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import yauzl from 'yauzl';
import { loadConfig } from '../src/config.ts';
import { findRuntime } from '../src/seams/database.ts';

const [zipArg, name] = process.argv.slice(2);
if (!zipArg || !name || !/^[a-zA-Z][a-zA-Z0-9_]*$/.test(name)) throw Error('Usage: npm run restore -- <recovery backup .zip> <new database name>');
const config = loadConfig();
if (config.arcade.url) throw Error('ARCADEDB_URL is set: restore into that ArcadeDB with its own tools');
const runtime = findRuntime(config.database.runtimeDir);
if (!runtime) throw Error('The built-in database is not installed: run npm run setup');
if (fs.existsSync(path.join(config.database.home, 'instance.json'))) throw Error('The database is running: quit the app (or stop npm start) first');
const target = path.join(config.database.home, 'databases', name);
if (fs.existsSync(target)) throw Error(`${name} already exists; choose a new name`);

// ArcadeDB's restore tool takes paths relative to where it runs: the database's own folder.
fs.mkdirSync(config.database.home, { recursive: true });
const work = fs.mkdtempSync(path.join(config.database.home, 'restore-'));
try {
  // The recovery ZIP holds database.zip (ArcadeDB's native backup) and vault/.
  const zip: yauzl.ZipFile = await new Promise((res, rej) => yauzl.open(path.resolve(zipArg), { lazyEntries: true }, (e, z) => (e ? rej(e) : res(z!))));
  let restoredFiles = 0;
  await new Promise<void>((resolve, reject) => {
    zip.on('entry', (entry: yauzl.Entry) => {
      const inVault = entry.fileName.startsWith('vault/') && !entry.fileName.endsWith('/');
      if (entry.fileName !== 'database.zip' && !inVault) { zip.readEntry(); return; }
      // Vault files keep their names; an existing file is never replaced (originals are append-only).
      const out = entry.fileName === 'database.zip' ? path.join(work, 'database.zip') : path.resolve(config.vaultDir, entry.fileName.slice('vault/'.length));
      if (!out.startsWith(path.resolve(work)) && !out.startsWith(path.resolve(config.vaultDir) + path.sep)) { reject(Error(`Unsafe path in backup: ${entry.fileName}`)); return; }
      if (inVault && fs.existsSync(out)) { zip.readEntry(); return; }
      fs.mkdirSync(path.dirname(out), { recursive: true });
      zip.openReadStream(entry, (e, stream) => {
        if (e) { reject(e); return; }
        stream!.pipe(fs.createWriteStream(out)).on('finish', () => { if (inVault) restoredFiles++; zip.readEntry(); }).on('error', reject);
      });
    });
    zip.on('end', resolve);
    zip.on('error', reject);
    zip.readEntry();
  });
  if (!fs.existsSync(path.join(work, 'database.zip'))) throw Error('Not a recovery backup: database.zip is missing');
  execFileSync(runtime.java, ['-cp', path.join(runtime.lib, '*'), 'com.arcadedb.integration.restore.Restore', '-f', path.join(path.basename(work), 'database.zip'), '-d', path.join('databases', name)], { cwd: config.database.home, stdio: 'inherit' });
  console.log(`Restored into ${name}, and ${restoredFiles} evidence files into the vault. Set ARCADEDB_DATABASE=${name} in .env and start hvnt33.`);
} finally {
  fs.rmSync(work, { recursive: true, force: true });
}
