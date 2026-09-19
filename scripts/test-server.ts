// Run the server tests in one profile, on any platform:
//   node scripts/test-server.ts local|token      every test file
//   node scripts/test-server.ts live             the live checks (real pages, timestamp authorities, Tor)
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const mode = process.argv[2];
if (!['local', 'token', 'live'].includes(mode)) throw Error('Usage: node scripts/test-server.ts local|token|live');
const dir = path.join(root, 'apps/server/tests');
const files = mode === 'live' ? [path.join(dir, 'live.test.ts')] : fs.readdirSync(dir).filter(f => f.endsWith('.test.ts')).sort().map(f => path.join(dir, f));
const env = { ...process.env, HVNT33_TEST_PROFILE: mode === 'token' ? 'token' : 'local', ...(mode === 'live' ? { HVNT33_LIVE: '1' } : {}) };
const result = spawnSync(process.execPath, ['--env-file-if-exists=.env', '--test', '--test-concurrency=1', ...files], { cwd: root, env, stdio: 'inherit' });
process.exit(result.status ?? 1);
