import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { runtimePlatform } from './database.ts';

// Tor built into hvnt33: the Tor Project's tor (installed by `npm run setup`),
// started when a case turns Tor on and stopped when no case uses it. It listens
// on a port of its own choosing on this machine only, keeps a circuit per SOCKS
// login (each case's relay logs in with its own name), and exits by itself if
// the server that started it goes away.

export type TorState = 'off' | 'starting' | 'running' | 'failed';
export interface TorStatus { installed: boolean; state: TorState; progress: number; summary: string; error: string; port: number }

export class BuiltinTor {
  private child: ChildProcess | null = null;
  private status: TorStatus;
  private ready: Promise<number> | null = null;

  private binary: string;
  private dataDir: string;
  private startTimeoutMs: number;

  /** `binary`: the tor executable, or '' when built-in Tor is unavailable or disabled. */
  constructor(binary: string, dataDir: string, startTimeoutMs = 120_000) {
    this.binary = binary;
    this.dataDir = dataDir;
    this.startTimeoutMs = startTimeoutMs;
    this.status = { installed: !!binary && fs.existsSync(binary), state: 'off', progress: 0, summary: '', error: '', port: 0 };
  }

  get(): TorStatus { return { ...this.status }; }

  /** Start Tor if needed and wait until it has built its first circuits; returns its SOCKS port. */
  start(): Promise<number> {
    if (!this.status.installed) return Promise.reject(Error('Tor is not installed: run npm run setup'));
    if (this.ready && this.status.state !== 'failed') return this.ready;
    this.status = { ...this.status, state: 'starting', progress: 0, summary: 'Starting', error: '', port: 0 };
    fs.mkdirSync(this.dataDir, { recursive: true, mode: 0o700 });
    const dir = path.dirname(this.binary);
    const data = path.resolve(dir, '..', 'data');
    const args = [
      // No torrc: everything is on the command line (a path that does not exist, on any platform).
      '-f', path.join(this.dataDir, 'no-torrc'), '--ignore-missing-torrc',
      '--SocksPort', '127.0.0.1:auto IsolateSOCKSAuth',
      '--DataDirectory', this.dataDir,
      '--Log', 'notice stdout',
      // Exit when the server that started it goes away.
      '__OwningControllerProcess', String(process.pid),
      ...(fs.existsSync(path.join(data, 'geoip')) ? ['--GeoIPFile', path.join(data, 'geoip'), '--GeoIPv6File', path.join(data, 'geoip6')] : []),
    ];
    this.ready = new Promise<number>((resolve, reject) => {
      // On Linux, tor loads the libraries it ships with (libevent, OpenSSL) from its own folder.
      const env = process.platform === 'linux' ? { ...process.env, LD_LIBRARY_PATH: [dir, process.env.LD_LIBRARY_PATH].filter(Boolean).join(':') } : process.env;
      const child = spawn(this.binary, args, { stdio: ['ignore', 'pipe', 'pipe'], env, windowsHide: true });
      this.child = child;
      const timer = setTimeout(() => fail('Tor did not finish starting within two minutes (is the internet reachable?)'), this.startTimeoutMs);
      const fail = (error: string) => {
        clearTimeout(timer);
        if (this.child === child) { this.status = { ...this.status, state: 'failed', error }; child.kill('SIGTERM'); this.child = null; }
        reject(Error(error));
      };
      let buffer = '';
      child.stdout!.on('data', (chunk: Buffer) => {
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          const port = /Opened Socks listener connection \(ready\) on 127\.0\.0\.1:(\d+)/.exec(line);
          if (port) this.status.port = Number(port[1]);
          const boot = /Bootstrapped (\d+)% \([^)]*\): (.*)$/.exec(line);
          if (boot) {
            this.status.progress = Number(boot[1]);
            this.status.summary = boot[2].trim();
            if (this.status.progress === 100 && this.status.port) {
              clearTimeout(timer);
              this.status.state = 'running';
              resolve(this.status.port);
            }
          }
          if (/\[err\]/.test(line)) this.status.error = line.replace(/^.*\[err\]\s*/, '');
        }
      });
      child.on('error', e => fail(`Tor could not start: ${e.message}`));
      child.on('exit', code => {
        if (this.child !== child) return;
        if (this.status.state === 'running') { this.child = null; this.status = { ...this.status, state: 'off', port: 0, progress: 0 }; }
        else fail(this.status.error || `Tor stopped while starting (exit ${code})`);
        this.ready = null;
      });
    });
    return this.ready;
  }

  /** Stop Tor (cases on Tor then pause until it runs again). */
  async stop(): Promise<void> {
    const child = this.child;
    this.child = null;
    this.ready = null;
    this.status = { ...this.status, state: 'off', progress: 0, summary: '', port: 0 };
    if (!child) return;
    await new Promise<void>(resolve => {
      const t = setTimeout(() => { child.kill('SIGKILL'); resolve(); }, 5000);
      child.once('exit', () => { clearTimeout(t); resolve(); });
      child.kill('SIGTERM');
    });
  }
}

/** The tor executable for this machine, if installed (npm run setup). */
export function builtinTorBinary(root: string): string {
  const p = runtimePlatform();
  if (!p) return '';
  return path.join(root, 'vendor', 'tor', p, 'tor', process.platform === 'win32' ? 'tor.exe' : 'tor');
}
