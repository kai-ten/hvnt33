import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { Request } from 'express';
import { LOCAL_WORKSPACE } from '../config.ts';
import { HttpError } from '../http.ts';
import type { Graph } from './graph.ts';

/**
 * AuthProvider seam: who is making a request, and which workspace it acts in.
 *
 * - Local: the single researcher on this machine. Trusted because the server
 *   only listens on loopback and rejects foreign hosts and origins.
 * - Token: `Authorization: Bearer <token>`; each API token belongs to one user
 *   and one workspace. Hosted deployments add sign-in (OIDC) that issues these.
 */
export interface Principal {
  userId: string;
  workspaceId: string;
  via: 'local' | 'token';
}

export interface AuthProvider {
  readonly mode: 'local' | 'token';
  /** Resolve the request's principal, or null for an anonymous request. Throws 401 for bad credentials. */
  authenticate(req: Request): Promise<Principal | null>;
}

export function localAuth(): AuthProvider {
  return {
    mode: 'local',
    async authenticate() {
      return { userId: 'local', workspaceId: LOCAL_WORKSPACE, via: 'local' };
    },
  };
}

const hash = (token: string) => createHash('sha256').update(token).digest('hex');

export function tokenAuth(graph: Graph): AuthProvider {
  return {
    mode: 'token',
    async authenticate(req) {
      const header = req.headers.authorization ?? '';
      if (!header) return null;
      const match = /^Bearer\s+([A-Za-z0-9_-]{20,200})$/.exec(header);
      if (!match) throw new HttpError(401, 'Malformed Authorization header', 'unauthenticated');
      const [token] = await graph.sql<{ userId: string; workspaceId: string; revokedAt?: string }>(
        'SELECT userId, workspaceId, revokedAt FROM ApiToken WHERE tokenHash=:h LIMIT 1', { h: hash(match[1]) });
      if (!token || token.revokedAt) throw new HttpError(401, 'Invalid or revoked API token', 'unauthenticated');
      return { userId: token.userId, workspaceId: token.workspaceId, via: 'token' };
    },
  };
}

/** Create an API token. Only its hash is stored; the token is returned once. */
export async function issueToken(graph: Graph, workspaceId: string, userId: string, label = ''): Promise<{ id: string; token: string }> {
  const token = `h33_${randomBytes(24).toString('base64url')}`;
  const id = randomUUID();
  await graph.sql('INSERT INTO ApiToken CONTENT :t', { t: { id, tokenHash: hash(token), workspaceId, userId, label, createdAt: new Date().toISOString(), revokedAt: '' } });
  return { id, token };
}

export async function createWorkspace(graph: Graph, name: string, plan = 'unlimited'): Promise<{ id: string; name: string; plan: string }> {
  const ws = { id: randomUUID(), name, plan, createdAt: new Date().toISOString() };
  await graph.sql('INSERT INTO Workspace CONTENT :ws', { ws });
  return ws;
}
