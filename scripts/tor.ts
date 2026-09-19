// Tor, built into hvnt33: the Tor Project's Expert Bundle (the tor inside Tor Browser),
// for macOS (Apple Silicon, Intel), Windows x86_64 and Linux x86_64.
//   npm run tor:fetch             install the pinned version for this computer (npm run setup does this)
//   npm run tor:fetch -- linux-x86_64   another platform's (packaging for it)
//   npm run tor:update -- 15.1    verify a new release's GPG signatures and pin it
// Downloads are checked against pinned SHA-256 hashes; pins are only ever
// written after the Tor Browser Developers' signatures verify.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runtimePlatform } from '../apps/server/src/seams/database.ts';

const root = path.resolve(import.meta.dirname, '..');
const pinsFile = path.join(root, 'apps/server/vendor/tor.json');
const pins = JSON.parse(fs.readFileSync(pinsFile, 'utf8'));
// Public Tor Browser Developers signing-key fingerprint, not a credential. gitleaks:allow
const KEY = 'EF6E286DDA85EA2A4BA7DE684E2C6E8793298290';
// The Tor Project publishes no Expert Bundle for Windows or Linux on ARM.
const PLATFORMS = ['macos-aarch64', 'macos-x86_64', 'windows-x86_64', 'linux-x86_64'];

export function platform(): string | null {
  const p = runtimePlatform();
  return p && PLATFORMS.includes(p) ? p : null;
}

const bundle = (version: string, p: string) => `tor-expert-bundle-${p}-${version}.tar.gz`;

async function download(url: string, file: string) {
  const res = await fetch(url, { signal: AbortSignal.timeout(300_000) });
  if (!res.ok) throw Error(`${url}: ${res.status}`);
  fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
}

async function fetchTor(requested: string | null) {
  const p = requested ?? platform();
  if (!p || !PLATFORMS.includes(p)) { console.log(`Built-in Tor is not available for ${requested ?? `${process.platform}-${process.arch}`}; skipping (proxies and a Tor Browser you run still work).`); return; }
  if (!pins.sha256[p]) throw Error(`No Tor bundle is pinned for ${p}: run npm run tor:update -- ${pins.version}`);
  const dir = path.join(root, 'apps/server/vendor/tor', p);
  const stamp = path.join(dir, 'VERSION');
  if (fs.existsSync(stamp) && fs.readFileSync(stamp, 'utf8').trim() === pins.version) { console.log(`Tor ${pins.tor} is installed.`); return; }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hvnt33-tor-'));
  try {
    const name = bundle(pins.version, p);
    console.log(`Downloading Tor ${pins.tor} (${name})…`);
    await download(`${pins.base}/${pins.version}/${name}`, path.join(tmp, name));
    const sha = createHash('sha256').update(fs.readFileSync(path.join(tmp, name))).digest('hex');
    if (sha !== pins.sha256[p]) throw Error(`Checksum mismatch for ${name}: got ${sha}, expected ${pins.sha256[p]}. Not installing.`);
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    execFileSync('tar', ['-xzf', path.join(tmp, name), '-C', dir, 'tor', 'data']);
    if (p.startsWith('macos-') && process.platform === 'darwin') {
      // The bundle's binaries are unsigned (Tor Browser signs its app instead); macOS on Apple
      // Silicon runs only signed code, so sign them locally (ad hoc) after the checksum passed.
      // Release builds are signed again with the app.
      const bins = ['tor/tor', 'tor/libevent-2.1.7.dylib', 'tor/pluggable_transports/lyrebird', 'tor/pluggable_transports/conjure-client'].map(f => path.join(dir, f)).filter(f => fs.existsSync(f));
      execFileSync('codesign', ['--force', '--sign', '-', ...bins], { stdio: 'ignore' });
    }
    fs.writeFileSync(stamp, `${pins.version}\n`);
    // Run it only when it is this computer's own build.
    const exe = path.join(dir, 'tor', p.startsWith('windows-') ? 'tor.exe' : 'tor');
    const env = p.startsWith('linux-') ? { ...process.env, LD_LIBRARY_PATH: path.dirname(exe) } : process.env;
    const version = p === platform() ? execFileSync(exe, ['--version'], { env }).toString().split('\n')[0] : `Tor for ${p}`;
    console.log(`Installed ${version} (checksum verified).`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

async function update(version: string) {
  if (!/^\d+\.\d+(\.\d+)?$/.test(version)) throw Error('Usage: npm run tor:update -- <Tor Browser version, e.g. 15.0.24>');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hvnt33-tor-'));
  const gnupg = path.join(tmp, 'g');
  fs.mkdirSync(gnupg, { mode: 0o700 });
  const gpg = (...args: string[]) => execFileSync('gpg', ['--homedir', gnupg, '--batch', ...args], { stdio: ['pipe', 'pipe', 'pipe'] }).toString();
  try {
    const key = await (await fetch(`https://keys.openpgp.org/vks/v1/by-fingerprint/${KEY}`)).text();
    execFileSync('gpg', ['--homedir', gnupg, '--batch', '--import'], { input: key, stdio: ['pipe', 'ignore', 'ignore'] });
    if (!gpg('--with-colons', '--fingerprint').includes(KEY)) throw Error('Could not import the Tor Browser Developers signing key');
    const sha256: Record<string, string> = {};
    for (const p of PLATFORMS) {
      const name = bundle(version, p);
      await download(`${pins.base}/${version}/${name}`, path.join(tmp, name));
      await download(`${pins.base}/${version}/${name}.asc`, path.join(tmp, `${name}.asc`));
      const status = execFileSync('gpg', ['--homedir', gnupg, '--batch', '--status-fd', '1', '--verify', path.join(tmp, `${name}.asc`), path.join(tmp, name)], { stdio: ['ignore', 'pipe', 'ignore'] }).toString();
      // VALIDSIG's last field is the primary key's fingerprint.
      if (!status.split('\n').some(l => l.startsWith('[GNUPG:] VALIDSIG') && l.trim().endsWith(KEY))) throw Error(`${name}: the signature is not from the Tor Browser Developers key`);
      sha256[p] = createHash('sha256').update(fs.readFileSync(path.join(tmp, name))).digest('hex');
      console.log(`✓ ${name}: signature verified`);
    }
    fs.writeFileSync(pinsFile, JSON.stringify({ ...pins, version, sha256 }, null, 2) + '\n');
    console.log(`Pinned Tor Browser ${version}. Run npm run tor:fetch, check "tor --version", and update the "tor" field in ${path.relative(root, pinsFile)}.`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

const [cmd, arg] = process.argv.slice(2);
if (cmd === 'update') await update(arg ?? '');
else await fetchTor(cmd === 'fetch' ? arg ?? null : cmd ?? null);
