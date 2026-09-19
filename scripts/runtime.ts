// The database built into hvnt33: ArcadeDB and the Java runtime it runs on.
//   npm run runtime:fetch                    install the pinned versions for this computer (npm run setup does this)
//   npm run runtime:fetch -- macos-x86_64    install another platform's Java (packaging for that platform)
//   npm run runtime:update                   pin the newest Temurin JRE 25 and ArcadeDB releases
// Downloads are checked against pinned SHA-256 hashes before anything is installed.
// ArcadeDB's jars are platform independent; only the parts hvnt33 uses are kept
// (the high-availability module, the MCP server, the JavaScript engine and the
// console are left out).
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runtimePlatform } from '../apps/server/src/seams/database.ts';

const root = path.resolve(import.meta.dirname, '..');
const pinsFile = path.join(root, 'apps/server/vendor/runtime.json');
const target = path.resolve(process.env.HVNT33_RUNTIME_DIR || path.join(root, 'apps/server/vendor/runtime'));

interface Pins {
  comment: string;
  java: { feature: number; release: string; files: Record<string, { url: string; sha256: string }> };
  arcadedb: { version: string; url: string; sha256: string; exclude: string[] };
}
const PLATFORMS: Record<string, { os: string; arch: string }> = {
  'macos-aarch64': { os: 'mac', arch: 'aarch64' },
  'macos-x86_64': { os: 'mac', arch: 'x64' },
  'linux-x86_64': { os: 'linux', arch: 'x64' },
  'linux-aarch64': { os: 'linux', arch: 'aarch64' },
  'windows-x86_64': { os: 'windows', arch: 'x64' },
  'windows-aarch64': { os: 'windows', arch: 'aarch64' },
};

async function download(url: string, file: string, sha256: string) {
  const res = await fetch(url, { signal: AbortSignal.timeout(600_000) });
  if (!res.ok) throw Error(`${url}: ${res.status}`);
  fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  const got = createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  if (got !== sha256) throw Error(`Checksum mismatch for ${path.basename(file)}: got ${got}, expected ${sha256}. Not installing.`);
}

/** Extract an archive (.tar.gz or .zip; bsdtar reads both, including on Windows 10+). */
function extract(archive: string, into: string) {
  fs.mkdirSync(into, { recursive: true });
  execFileSync('tar', ['-xf', archive, '-C', into]);
}

/** The single top-level folder an archive unpacked into. */
function only(dir: string): string {
  const entries = fs.readdirSync(dir).filter(n => !n.startsWith('.'));
  if (entries.length !== 1) throw Error(`Unexpected archive layout in ${dir}: ${entries.join(', ')}`);
  return path.join(dir, entries[0]);
}

const installed = (stamp: string, version: string) => fs.existsSync(stamp) && fs.readFileSync(stamp, 'utf8').trim() === version;

async function fetchJava(pins: Pins, platform: string, tmp: string) {
  const dir = path.join(target, 'java', platform);
  const stamp = path.join(dir, 'VERSION');
  if (installed(stamp, pins.java.release)) { console.log(`Java ${pins.java.release} (${platform}) is installed.`); return; }
  const pin = pins.java.files[platform];
  if (!pin) throw Error(`No Java runtime is pinned for ${platform}`);
  const archive = path.join(tmp, path.basename(new URL(pin.url).pathname));
  console.log(`Downloading Java ${pins.java.release} for ${platform}…`);
  await download(pin.url, archive, pin.sha256);
  const out = path.join(tmp, 'java');
  extract(archive, out);
  // macOS builds are bundles (Contents/Home); keep just the runtime.
  let home = only(out);
  if (fs.existsSync(path.join(home, 'Contents', 'Home'))) home = path.join(home, 'Contents', 'Home');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(dir), { recursive: true });
  fs.renameSync(home, dir);
  fs.writeFileSync(stamp, `${pins.java.release}\n`);
  console.log(`Installed Java ${pins.java.release} for ${platform} (checksum verified).`);
}

async function fetchArcade(pins: Pins, tmp: string) {
  const dir = path.join(target, 'arcadedb');
  const stamp = path.join(dir, 'VERSION');
  if (installed(stamp, pins.arcadedb.version)) { console.log(`ArcadeDB ${pins.arcadedb.version} is installed.`); return; }
  const archive = path.join(tmp, 'arcadedb.tar.gz');
  console.log(`Downloading ArcadeDB ${pins.arcadedb.version}…`);
  await download(pins.arcadedb.url, archive, pins.arcadedb.sha256);
  const out = path.join(tmp, 'arcadedb');
  extract(archive, out);
  const dist = only(out);
  const excluded = pins.arcadedb.exclude.map(p => new RegExp(`^${p.replace(/[.+]/g, '\\$&').replace(/\*/g, '.*')}$`));
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(path.join(dir, 'lib'), { recursive: true });
  let kept = 0;
  for (const jar of fs.readdirSync(path.join(dist, 'lib'))) {
    if (!jar.endsWith('.jar') || excluded.some(re => re.test(jar))) continue;
    fs.copyFileSync(path.join(dist, 'lib', jar), path.join(dir, 'lib', jar));
    kept++;
  }
  for (const f of ['LICENSE', 'NOTICE', 'ATTRIBUTIONS.md']) if (fs.existsSync(path.join(dist, f))) fs.copyFileSync(path.join(dist, f), path.join(dir, f));
  fs.writeFileSync(stamp, `${pins.arcadedb.version}\n`);
  console.log(`Installed ArcadeDB ${pins.arcadedb.version}: ${kept} jars (checksum verified).`);
}

async function fetchRuntime(platform: string | null) {
  const pins = JSON.parse(fs.readFileSync(pinsFile, 'utf8')) as Pins;
  const p = platform ?? runtimePlatform();
  if (!p || !PLATFORMS[p]) throw Error(`The built-in database is not available for ${process.platform}-${process.arch}; set ARCADEDB_URL to use your own ArcadeDB.`);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hvnt33-runtime-'));
  try {
    await fetchJava(pins, p, tmp);
    await fetchArcade(pins, tmp);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

async function json<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': 'hvnt33-runtime-update' } });
  if (!res.ok) throw Error(`${url}: ${res.status}`);
  return res.json() as Promise<T>;
}

async function update() {
  const pins = JSON.parse(fs.readFileSync(pinsFile, 'utf8')) as Pins;
  const feature = pins.java.feature;
  const files: Pins['java']['files'] = {};
  let release = '';
  for (const [p, { os: o, arch }] of Object.entries(PLATFORMS)) {
    const [asset] = await json<{ release_name: string; binary: { package: { link: string; checksum: string } } }[]>(
      `https://api.adoptium.net/v3/assets/latest/${feature}/hotspot?architecture=${arch}&image_type=jre&os=${o}&vendor=eclipse`);
    if (!asset) { console.log(`- no Temurin ${feature} JRE for ${p}`); continue; }
    if (release && asset.release_name !== release) throw Error(`Temurin releases differ across platforms (${release}, ${asset.release_name}); try again later`);
    release = asset.release_name;
    files[p] = { url: asset.binary.package.link, sha256: asset.binary.package.checksum };
    console.log(`✓ ${p}: ${asset.release_name}`);
  }
  const latest = await json<{ tag_name: string }>('https://api.github.com/repos/ArcadeData/arcadedb/releases/latest');
  const version = latest.tag_name;
  const url = `https://github.com/ArcadeData/arcadedb/releases/download/${version}/arcadedb-${version}-base.tar.gz`;
  const sha256 = (await (await fetch(`${url}.sha256`)).text()).trim().split(/\s+/)[0];
  if (!/^[0-9a-f]{64}$/.test(sha256)) throw Error(`No checksum published for ArcadeDB ${version}`);
  console.log(`✓ ArcadeDB ${version}`);
  fs.writeFileSync(pinsFile, JSON.stringify({ ...pins, java: { feature, release, files }, arcadedb: { ...pins.arcadedb, version, url, sha256 } }, null, 2) + '\n');
  console.log(`Pinned. Run npm run runtime:fetch and npm test before committing ${path.relative(root, pinsFile)}.`);
}

const [cmd, arg] = process.argv.slice(2);
if (cmd === 'update') await update();
else await fetchRuntime(cmd === 'fetch' ? arg ?? null : cmd ?? null);
