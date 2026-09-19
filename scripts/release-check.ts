// Pre-publication gate: `npm run release:check`. Everything here must pass
// before the repository is made public or a release is tagged.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
// Inspect the working tree. Files intentionally deleted but not committed yet
// are still reported by `git ls-files`; they are not release contents.
const tracked = git('ls-files', '-z').split('\0').filter(Boolean).filter(f => fs.existsSync(path.join(root, f)));
const read = (f: string) => fs.readFileSync(path.join(root, f), 'utf8');

const results: { name: string; ok: boolean; detail?: string }[] = [];
const check = (name: string, fn: () => string | true) => {
  try {
    const r = fn();
    results.push(r === true ? { name, ok: true } : { name, ok: false, detail: r });
  } catch (e) {
    results.push({ name, ok: false, detail: (e as Error).message });
  }
};

check('LICENSE is the GNU AGPL v3', () => /GNU AFFERO GENERAL PUBLIC LICENSE\s+Version 3, 19 November 2007/.test(read('LICENSE')) || 'LICENSE is missing or not AGPL-3.0');

check('every package declares AGPL-3.0-only', () => {
  const manifests = tracked.filter(f => /(^|\/)package\.json$/.test(f) && !f.includes('node_modules'));
  const wrong = manifests.filter(f => JSON.parse(read(f)).license !== 'AGPL-3.0-only');
  return wrong.length ? `wrong or missing license: ${wrong.join(', ')}` : true;
});

check('no release placeholders left', () => {
  const releaseFiles = ['README.md', 'CODE_OF_CONDUCT.md'];
  const hits = releaseFiles.flatMap(f => [...read(f).matchAll(/\{\{[A-Z][A-Z0-9_]+\}\}/g)].map(m => `${f}: ${m[0]}`));
  return hits.length ? hits.join('\n') : true;
});

check('no private files are tracked', () => {
  const bad = tracked.filter(f => /^(data\/|docs\/notes\/)|(^|\/)\.env$|\.(p12|pem|key)$/.test(f) && !f.startsWith('apps/server/tests/fixtures/'));
  return bad.length ? bad.join(', ') : true;
});

check('personal notes are absent from history', () => {
  const touched = git('log', '--all', '--format=', '--name-only', '--', 'docs/notes').trim();
  return touched ? `docs/notes appears in history (${[...new Set(touched.split('\n'))].join(', ')}): publish from a fresh history` : true;
});

check('no secrets in history (gitleaks)', () => {
  try {
    execFileSync('gitleaks', ['git', '.', '--no-banner', '--redact', '--log-level', 'error'], { cwd: root, stdio: 'pipe' });
    return true;
  } catch (e) {
    const err = e as { code?: string; stdout?: Buffer };
    return err.code === 'ENOENT' ? 'gitleaks is not installed (brew install gitleaks)' : `leaks found: run gitleaks git . for details`;
  }
});

check('the app and the repository versions agree', () => {
  const app = JSON.parse(read('apps/desktop/package.json')).version;
  const repo = JSON.parse(read('package.json')).version;
  return app === repo ? true : `apps/desktop ${app}, package.json ${repo}`;
});

check('no telemetry or analytics', () => {
  const code = tracked.filter(f => /\.(ts|tsx|js|mjs|html|json)$/.test(f) && !f.startsWith('apps/server/vendor/') && !f.endsWith('package-lock.json') && f !== 'scripts/release-check.ts');
  const pattern = /posthog|segment\.(io|com)|mixpanel|amplitude|google-analytics|googletagmanager|gtag\(|plausible\.io|sentry\.io|@sentry\/|datadoghq|bugsnag|@opentelemetry\/|\bOTEL_[A-Z_]+/i;
  const hits = code.filter(f => pattern.test(read(f)));
  return hits.length ? `review: ${hits.join(', ')}` : true;
});

check('installed apps never fall back to the build repository', () => (/const devRoot = \(\) => \(app\.isPackaged \? null :/.test(read('apps/desktop/src/main/workspace.ts')) ? true : 'the development workspace fallback is not limited to unpackaged runs'));

check('setup repairs a missing Electron binary', () => (/scripts\/electron\.ts/.test(read('package.json')) ? true : 'npm run setup does not verify the Electron platform binary'));

check('the built-in database is pinned with checksums', () => {
  const pins = JSON.parse(read('apps/server/vendor/runtime.json'));
  const missing = Object.entries(pins.java.files as Record<string, { sha256: string }>).filter(([, f]) => !/^[0-9a-f]{64}$/.test(f.sha256)).map(([p]) => p);
  if (!/^[0-9a-f]{64}$/.test(pins.arcadedb.sha256)) missing.push('arcadedb');
  return missing.length ? `no checksum for ${missing.join(', ')}` : true;
});

for (const r of results) console.log(`${r.ok ? '✓' : '✗'} ${r.name}${r.detail ? `\n    ${r.detail.split('\n').join('\n    ')}` : ''}`);
const failed = results.filter(r => !r.ok).length;
console.log(failed ? `\n✗ ${failed} of ${results.length} checks failed: not ready to publish` : `\n✓ ready to publish (${results.length} checks)`);
process.exitCode = failed ? 1 : 0;
