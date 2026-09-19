import path from 'node:path';
import { builtinTorBinary } from './seams/tor.ts';
import { randomBytes } from 'node:crypto';

/**
 * Runtime configuration, read once from the environment (`.env` locally).
 * Everything that differs between a laptop and a hosted deployment is here or
 * behind a seam in `src/seams/`.
 */
export interface Plan {
  /** Limits per workspace. Missing metrics are unlimited. */
  limits: Partial<Record<Metric, number>>;
}

/** Metered usage. `*.monthly` metrics reset each calendar month (UTC). */
export type Metric = 'investigations' | 'captures.monthly' | 'archive.saves.monthly' | 'snapshots.monthly' | 'watches' | 'storage.bytes';

export interface Config {
  port: number;
  host: string;
  /** `local`: trusted single user on loopback. `token`: bearer API tokens, one workspace each. */
  auth: 'local' | 'token';
  allowedOrigins: string[];
  root: string;
  dataDir: string;
  vaultDir: string;
  exportsDir: string;
  arcadeBackups: string;
  publicDir: string;
  /** The ArcadeDB the server uses. `url` is empty until the built-in database starts (see seams/database.ts). */
  arcade: { url: string; user: string; password: string; database: string };
  /** The built-in database, used when ARCADEDB_URL is not set. */
  database: { runtimeDir: string; home: string; memory: string };
  openai: { apiKey: string; model: string };
  archiveOrg: { accessKey: string; secretKey: string };
  plans: Record<string, Plan>;
  /** hvnt33's own archive (Phase 4). */
  snapshots: {
    /** auto: the desktop app's browser when the server runs inside the app, else fetch. */
    capture: 'auto' | 'fetch';
    /** RFC 3161 timestamp authorities; each snapshot is stamped by all of them. */
    timestampAuthorities: string[];
    /** Signs short-lived replay links. Random per process unless set. */
    secret: string;
    tmpDir: string;
    /** May snapshot private and loopback addresses. Local mode: yes; hosted (token) mode: no. */
    allowPrivateUrls: boolean;
  };
  /**
   * Snapshot replay runs archived scripts, so it has its own origin: a second
   * listener on `port`, reached by browsers at `publicUrl`.
   */
  replay: { port: number; publicUrl: string };
  /** Where requests appear to come from, checked through a case's route (HVNT33_EXIT_CHECK_URL). */
  network: {
    exitCheckUrl: string; torPorts: number[]; secretsDir: string;
    /** Built-in Tor (npm run setup); '' when unavailable or disabled (HVNT33_TOR_BUILTIN=0). */
    torBinary: string; torDataDir: string;
  };
}

export const LOCAL_WORKSPACE = 'local';

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const root = path.resolve(import.meta.dirname, '../../..');
  const dataDir = path.resolve(env.HVNT33_DATA_DIR || path.join(root, 'data'));
  const port = Number(env.PORT || 4310);
  const replayPort = Number(env.HVNT33_REPLAY_PORT || port + 1);
  const auth = env.HVNT33_AUTH === 'token' ? 'token' : 'local';
  const database = env.ARCADEDB_DATABASE || 'newsroom';
  if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(database)) throw Error('Invalid ARCADEDB_DATABASE name');
  let plans: Record<string, Plan> = { unlimited: { limits: {} } };
  if (env.HVNT33_PLANS) plans = { ...plans, ...(JSON.parse(env.HVNT33_PLANS) as Record<string, Plan>) };
  return {
    port,
    host: env.HOST || '127.0.0.1',
    auth,
    allowedOrigins: [
      `http://localhost:${port}`,
      `http://127.0.0.1:${port}`,
      ...(env.HVNT33_ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean),
    ],
    root,
    dataDir,
    vaultDir: path.join(dataDir, 'vault'),
    exportsDir: path.join(dataDir, 'exports'),
    arcadeBackups: path.join(dataDir, 'arcadedb', 'backups'),
    publicDir: path.join(import.meta.dirname, '..', 'public'),
    arcade: {
      url: (env.ARCADEDB_URL || '').replace(/\/$/, ''),
      user: env.ARCADEDB_USER || 'root',
      password: env.ARCADEDB_PASSWORD || '',
      database,
    },
    database: {
      runtimeDir: path.resolve(env.HVNT33_RUNTIME_DIR || path.join(import.meta.dirname, '..', 'vendor', 'runtime')),
      home: path.join(dataDir, 'arcadedb'),
      memory: env.HVNT33_DATABASE_MEMORY || '1G',
    },
    openai: { apiKey: env.OPENAI_API_KEY || '', model: env.OPENAI_MODEL || 'gpt-5.4' },
    archiveOrg: { accessKey: env.ARCHIVE_ORG_ACCESS_KEY || '', secretKey: env.ARCHIVE_ORG_SECRET_KEY || '' },
    plans,
    snapshots: {
      capture: env.HVNT33_CAPTURE === 'fetch' ? 'fetch' : 'auto',
      timestampAuthorities: (env.HVNT33_TSA_URLS ?? 'http://timestamp.digicert.com,https://freetsa.org/tsr').split(',').map(s => s.trim()).filter(Boolean),
      secret: env.HVNT33_SECRET || randomBytes(32).toString('hex'),
      tmpDir: path.join(dataDir, 'tmp'),
      allowPrivateUrls: env.HVNT33_ALLOW_PRIVATE_URLS ? env.HVNT33_ALLOW_PRIVATE_URLS === '1' : auth === 'local',
    },
    network: {
      exitCheckUrl: env.HVNT33_EXIT_CHECK_URL || 'https://am.i.mullvad.net/json',
      // Tor Browser listens on 9150, the tor service on 9050.
      torPorts: (env.HVNT33_TOR_PORTS || '9150,9050').split(',').map(Number).filter(p => Number.isInteger(p) && p > 0 && p < 65536),
      secretsDir: path.join(dataDir, 'secrets'),
      torBinary: env.HVNT33_TOR_BUILTIN === '0' ? '' : builtinTorBinary(path.join(import.meta.dirname, '..')),
      torDataDir: path.join(dataDir, 'tor'),
    },
    replay: {
      port: replayPort,
      publicUrl: (env.HVNT33_REPLAY_URL || `http://localhost:${replayPort}`).replace(/\/$/, ''),
    },
  };
}
