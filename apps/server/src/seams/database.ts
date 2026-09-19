import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import type { Config } from '../config.ts';

// The database built into hvnt33: ArcadeDB on a pinned Java runtime, installed
// by `npm run setup` (scripts/runtime.ts) and shipped inside the desktop app.
// When ARCADEDB_URL is not set, the server starts it on a free loopback port.
// ArcadeDB opens a database from one process at a time, so every hvnt33
// process using the same data directory shares one instance: the first starts
// it and records it in `instance.json`, the others attach to it.

/** This machine as named in the runtime pins, e.g. `macos-aarch64`. */
export function runtimePlatform(platform: string = process.platform, arch: string = process.arch): string | null {
  const os = ({ darwin: 'macos', linux: 'linux', win32: 'windows' } as Record<string, string>)[platform];
  const cpu = ({ arm64: 'aarch64', x64: 'x86_64' } as Record<string, string>)[arch];
  return os && cpu ? `${os}-${cpu}` : null;
}

export interface Runtime { java: string; lib: string; version: string }

/** The installed runtime under `dir` (the `vendor/runtime` folder), or null when it is not installed. */
export function findRuntime(dir: string): Runtime | null {
  const p = runtimePlatform();
  if (!p) return null;
  const java = path.join(dir, 'java', p, 'bin', process.platform === 'win32' ? 'java.exe' : 'java');
  const lib = path.join(dir, 'arcadedb', 'lib');
  const stamp = path.join(dir, 'arcadedb', 'VERSION');
  if (!fs.existsSync(java) || !fs.existsSync(lib) || !fs.existsSync(stamp)) return null;
  return { java, lib, version: fs.readFileSync(stamp, 'utf8').trim() };
}

export interface BundledOptions {
  runtimeDir: string;
  /** ArcadeDB's home: `config/`, `databases/`, `backups/`, `log/`, and `instance.json`. */
  home: string;
  /** Root password: used to create the server's users on first start and to connect. */
  password: string;
  /** Maximum Java heap, e.g. `1G`. */
  memory?: string;
  startTimeoutMs?: number;
}

export interface BundledDatabase {
  url: string;
  version: string;
  /** True when this process started it (and stops it); false when attached to another's. */
  owner: boolean;
  stop(): Promise<void>;
}

interface Instance { pid: number; port: number; version: string }

const auth = (password: string) => 'Basic ' + Buffer.from(`root:${password}`).toString('base64');

/** Whether an ArcadeDB answering at `url` accepts this password (so it is ours, not a stranger on a reused port). */
async function answers(url: string, password: string): Promise<boolean> {
  try {
    const res = await fetch(`${url}/api/v1/server`, {
      method: 'POST', headers: { Authorization: auth(password), 'Content-Type': 'application/json' },
      body: JSON.stringify({ command: 'list databases' }), signal: AbortSignal.timeout(3000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code === 'EPERM'; }
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address() as net.AddressInfo;
      s.close(() => resolve(port));
    });
  });
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/**
 * One process at a time decides whether to start the database. The lock is a
 * file created exclusively; one left by a process that died is taken over.
 */
async function withStartLock<T>(home: string, fn: () => Promise<T>, timeoutMs: number): Promise<T> {
  const lock = path.join(home, 'instance.lock');
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      fs.writeFileSync(lock, String(process.pid), { flag: 'wx' });
      break;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
      const holder = Number(fs.readFileSync(lock, 'utf8')) || 0;
      if (!holder || !alive(holder)) { fs.rmSync(lock, { force: true }); continue; }
      if (Date.now() > deadline) throw Error('Timed out waiting for another hvnt33 process to start the database');
      await sleep(200);
    }
  }
  try { return await fn(); } finally { fs.rmSync(lock, { force: true }); }
}

/** Start the built-in ArcadeDB, or attach to the one already serving this home. */
export async function startBundled(options: BundledOptions): Promise<BundledDatabase> {
  const { runtimeDir, home, password, memory = '1G', startTimeoutMs = 60_000 } = options;
  const runtime = findRuntime(runtimeDir);
  if (!runtime) throw Error('The built-in database is not installed: run npm run setup (or set ARCADEDB_URL to use your own ArcadeDB)');
  fs.mkdirSync(path.join(home, 'log'), { recursive: true });
  const stateFile = path.join(home, 'instance.json');

  return withStartLock(home, async () => {
    // Another hvnt33 process already runs it.
    try {
      const existing = JSON.parse(fs.readFileSync(stateFile, 'utf8')) as Instance;
      const url = `http://127.0.0.1:${existing.port}`;
      if (alive(existing.pid) && await answers(url, password)) {
        return { url, version: existing.version, owner: false, stop: async () => {} };
      }
    } catch { /* none recorded */ }
    fs.rmSync(stateFile, { force: true });

    // The password reaches ArcadeDB through a private file, never the command line.
    const secret = path.join(home, 'config', '.root-password');
    fs.mkdirSync(path.dirname(secret), { recursive: true, mode: 0o700 });
    fs.writeFileSync(secret, password, { mode: 0o600 });
    const port = await freePort();
    const args = [
      '-Xms64M', `-Xmx${memory}`,
      '--add-exports', 'java.management/sun.management=ALL-UNNAMED',
      '--add-opens', 'java.base/java.util.concurrent.atomic=ALL-UNNAMED',
      '--add-opens', 'java.base/java.nio.channels.spi=ALL-UNNAMED',
      '--add-opens', 'java.base/java.lang=ALL-UNNAMED',
      '--add-modules', 'jdk.incubator.vector',
      '-Djava.awt.headless=true', '-Dfile.encoding=UTF8',
      `-Darcadedb.server.rootPath=${home}`,
      `-Darcadedb.server.databaseDirectory=${path.join(home, 'databases')}`,
      `-Darcadedb.server.backupDirectory=${path.join(home, 'backups')}`,
      `-Darcadedb.server.rootPasswordPath=${secret}`,
      '-Darcadedb.server.httpIncomingHost=127.0.0.1',
      `-Darcadedb.server.httpIncomingPort=${port}`,
      '-cp', path.join(runtime.lib, '*'),
      'com.arcadedb.server.ArcadeDBServer',
    ];
    const log = fs.openSync(path.join(home, 'log', 'server.out'), 'a');
    const child: ChildProcess = spawn(runtime.java, args, { cwd: home, stdio: ['ignore', log, log], windowsHide: true });
    fs.closeSync(log);
    let exited: number | null | undefined;
    child.once('exit', code => { exited = code; });

    const url = `http://127.0.0.1:${port}`;
    const deadline = Date.now() + startTimeoutMs;
    try {
      while (!(await answers(url, password))) {
        if (exited !== undefined) throw Error(`The database stopped while starting (exit ${exited}); see ${path.join(home, 'log', 'server.out')}`);
        if (Date.now() > deadline) throw Error(`The database did not start within ${startTimeoutMs / 1000}s; see ${path.join(home, 'log', 'server.out')}`);
        await sleep(150);
      }
    } catch (error) {
      child.kill();
      throw error;
    } finally {
      // ArcadeDB has created its users file; the password file is no longer needed.
      fs.rmSync(secret, { force: true });
    }
    fs.writeFileSync(stateFile, JSON.stringify({ pid: child.pid ?? 0, port, version: runtime.version } satisfies Instance));

    // If this process exits without stopping it (a crash), the database is shut
    // down with it rather than left running unowned.
    const onExit = () => { if (exited === undefined) child.kill(); };
    process.once('exit', onExit);

    let stopping: Promise<void> | null = null;
    const stop = () => stopping ??= (async () => {
      process.off('exit', onExit);
      if (exited === undefined) {
        const done = new Promise<void>(resolve => child.once('exit', () => resolve()));
        // A clean shutdown closes every database; a kill leaves recovery to the next start.
        await fetch(`${url}/api/v1/server`, {
          method: 'POST', headers: { Authorization: auth(password), 'Content-Type': 'application/json' },
          body: JSON.stringify({ command: 'shutdown' }), signal: AbortSignal.timeout(5000),
        }).catch(() => {});
        let timer: NodeJS.Timeout | undefined;
        const clean = await Promise.race([done.then(() => true), new Promise<boolean>(r => { timer = setTimeout(() => r(false), 15_000); })]);
        clearTimeout(timer);
        if (!clean) {
          child.kill();
          await done;
        }
      }
      try {
        if ((JSON.parse(fs.readFileSync(stateFile, 'utf8')) as Instance).pid === child.pid) fs.rmSync(stateFile, { force: true });
      } catch { /* already gone */ }
    })();
    return { url, version: runtime.version, owner: true, stop };
  }, startTimeoutMs);
}

/** The password for the built-in database: `ARCADEDB_PASSWORD`, else one generated once and kept in the secrets folder. */
export function bundledPassword(secretsDir: string, configured: string): string {
  if (configured) return configured;
  const file = path.join(secretsDir, 'arcadedb-password');
  try { return fs.readFileSync(file, 'utf8').trim(); } catch { /* first run */ }
  fs.mkdirSync(secretsDir, { recursive: true, mode: 0o700 });
  const password = randomBytes(24).toString('hex');
  try {
    fs.writeFileSync(file, password, { mode: 0o600, flag: 'wx' });
  } catch (e) {
    // Another process generated it first.
    if ((e as NodeJS.ErrnoException).code === 'EEXIST') return fs.readFileSync(file, 'utf8').trim();
    throw e;
  }
  return password;
}

/**
 * Make `config.arcade` point at a database: the configured ArcadeDB
 * (`ARCADEDB_URL`), or the built-in one, started or attached to. Returns the
 * built-in database's handle, or null when an external one is configured.
 */
export async function connectDatabase(config: Config): Promise<BundledDatabase | null> {
  if (config.arcade.url) return null;
  const password = bundledPassword(config.network.secretsDir, config.arcade.password);
  const db = await startBundled({ runtimeDir: config.database.runtimeDir, home: config.database.home, password, memory: config.database.memory });
  config.arcade.url = db.url;
  config.arcade.password = password;
  return db;
}
