import fs from 'node:fs';
import path from 'node:path';

// Route credentials (a proxy's username and password), kept out of the
// database, exports and backups: one private file on this machine, readable
// only by its user. Hosted servers do not accept routes, so they hold none.

export interface RouteSecret { username: string; password: string }

export interface SecretStore {
  get(caseId: string): RouteSecret | null;
  set(caseId: string, secret: RouteSecret | null): void;
}

export function fileSecrets(dir: string): SecretStore {
  const file = path.join(dir, 'routes.json');
  const read = (): Record<string, RouteSecret> => {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return {}; }
  };
  return {
    get: caseId => read()[caseId] ?? null,
    set(caseId, secret) {
      const all = read();
      if (secret) all[caseId] = secret; else delete all[caseId];
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      const tmp = `${file}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(all), { mode: 0o600 });
      fs.renameSync(tmp, file);
    },
  };
}
