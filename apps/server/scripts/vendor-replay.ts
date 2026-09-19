// Refresh the vendored ReplayWeb.page bundle used to replay snapshots:
//   node apps/server/scripts/vendor-replay.ts 2.5.3
// ReplayWeb.page (Webrecorder, AGPL-3.0) is served as static files; nothing
// from it runs on the server.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const version = process.argv[2];
if (!version) throw Error('Usage: vendor-replay.ts VERSION');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rwp-'));
execFileSync('npm', ['pack', `replaywebpage@${version}`, '--silent'], { cwd: dir });
const tgz = fs.readdirSync(dir).find(f => f.endsWith('.tgz'))!;
execFileSync('tar', ['-xzf', tgz], { cwd: dir });
const out = path.resolve(import.meta.dirname, '../vendor/replaywebpage');
fs.mkdirSync(out, { recursive: true });
for (const f of ['ui.js', 'sw.js', 'LICENSE']) fs.copyFileSync(path.join(dir, 'package', f), path.join(out, f));
fs.writeFileSync(path.join(out, 'VERSION'), version + '\n');
fs.rmSync(dir, { recursive: true, force: true });
console.log(`Vendored ReplayWeb.page ${version} into ${out}`);
