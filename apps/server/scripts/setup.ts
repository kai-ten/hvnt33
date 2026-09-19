// First-run configuration: writes .env with a random database password for the
// built-in database. Existing configuration is never overwritten. To use your
// own ArcadeDB instead, add ARCADEDB_URL (and its user and password) to .env.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const env = path.resolve(import.meta.dirname, '../../../.env');
if (!fs.existsSync(env)) {
  fs.writeFileSync(env, `ARCADEDB_PASSWORD=${crypto.randomBytes(24).toString('hex')}\nARCADEDB_DATABASE=newsroom\nPORT=4310\n`, { mode: 0o600 });
}
console.log('Configuration ready.');
