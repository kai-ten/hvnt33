// Tenancy, authentication and entitlements: the hosted shape (token profile),
// and the local trust boundary (local profile).
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { type Harness, profile, removeInvestigation, start } from './harness.ts';
import { issueToken } from '../src/seams/auth.ts';

let h: Harness;
const cleanup: string[] = [];
before(async () => { h = await start(); });
after(async () => { for (const id of cleanup) await removeInvestigation(h.graph, id); await h.close(); });

test('local mode: loopback only, no credentials needed', { skip: profile !== 'local' }, async () => {
  assert.equal((await h.a.call('/api/investigations')).status, 200);
  // fetch cannot override Host, so send a raw request as a DNS-rebinding page would.
  const port = new URL(h.base).port;
  const status = await new Promise<number>((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path: '/api/investigations', headers: { Host: 'evil.example' } }, res => { res.resume(); resolve(res.statusCode ?? 0); }).on('error', reject);
  });
  assert.equal(status, 403, 'requests for other hosts are refused');
});

test('token mode: requests need a valid, unrevoked token', { skip: profile !== 'token' }, async () => {
  assert.equal((await fetch(`${h.base}/api/investigations`)).status, 401);
  assert.equal((await fetch(`${h.base}/api/investigations`, { headers: { Authorization: 'Bearer h33_not-a-real-token-at-all-000000' } })).status, 401);
  assert.equal((await fetch(`${h.base}/api/investigations`, { headers: { Authorization: 'Basic abc' } })).status, 401);
  assert.equal((await fetch(`${h.base}/api/health`)).status, 200, 'health is public');
  assert.equal((await fetch(`${h.base}/api/openapi.json`)).status, 200, 'the API description is public');
  const { id, token } = await issueToken(h.graph, h.a.workspaceId, 'revoked@test.invalid');
  assert.equal((await fetch(`${h.base}/api/investigations`, { headers: { Authorization: `Bearer ${token}` } })).status, 200);
  await h.graph.sql('UPDATE ApiToken SET revokedAt=:t WHERE id=:id', { id, t: new Date().toISOString() });
  assert.equal((await fetch(`${h.base}/api/investigations`, { headers: { Authorization: `Bearer ${token}` } })).status, 401);
  const [stored] = await h.graph.sql('SELECT FROM ApiToken WHERE id=:id', { id });
  assert.ok(!JSON.stringify(stored).includes(token), 'only a hash of the token is stored');
});

test('token mode: a workspace cannot see or touch another workspace\'s research', { skip: profile !== 'token' }, async () => {
  const a = h.a, b = h.b!;
  const inv = await a.api('/api/investigations', { title: 'TEST — A private case' });
  cleanup.push(inv.id);
  const person = await a.api('/api/records', { investigationId: inv.id, title: 'A-only person', kind: 'Person' });
  const org = await a.api('/api/records', { investigationId: inv.id, title: 'A-only org', kind: 'Organization' });
  const edge = await a.api('/api/connections', { fromId: person.id, toId: org.id, label: 'works for' });
  const fd = new FormData();
  fd.set('investigationId', inv.id); fd.set('text', 'A private capture.');
  const intake = await a.api('/api/intakes', fd);
  const run = await a.api('/api/searches', { investigationId: inv.id, engine: 'bing', query: 'secret', url: 'https://www.bing.com/search?q=secret', results: [{ title: 'x', url: 'https://x.example/' }] });
  const visit = await a.api('/api/visits', { investigationId: inv.id, url: 'https://private.example/' });
  const saved = await a.api('/api/saved-searches', { investigationId: inv.id, kind: 'web', query: 'secret', engines: ['bing'] });

  // B's own view contains none of A's work.
  assert.ok(!(await b.api('/api/investigations')).some((x: any) => x.id === inv.id));

  // Every route that takes an id refuses A's ids as not found (never 403, which would confirm they exist).
  const probes: [string, string, unknown?][] = [
    ['GET', `/api/investigations/${inv.id}`], ['GET', `/api/investigations/${inv.id}/changes`], ['GET', `/api/investigations/${inv.id}/intakes`],
    ['GET', `/api/investigations/${inv.id}/context`], ['GET', `/api/investigations/${inv.id}/searches`], ['GET', `/api/investigations/${inv.id}/visits`],
    ['GET', `/api/investigations/${inv.id}/saved-searches`], ['GET', `/api/investigations/${inv.id}/archive`], ['GET', `/api/investigations/${inv.id}/export?scope=all`],
    ['PATCH', `/api/records/${person.id}`, { title: 'hijacked' }], ['DELETE', `/api/records/${person.id}`], ['GET', `/api/files/${person.id}`],
    ['PATCH', `/api/connections/${edge.id}`, { label: 'hijacked' }], ['DELETE', `/api/connections/${edge.id}`],
    ['GET', `/api/intakes/${intake.id}`], ['GET', `/api/intakes/${intake.id}/file`], ['PATCH', `/api/intakes/${intake.id}/text`, { text: 'x' }],
    ['POST', `/api/intakes/${intake.id}/draft`, { draft: { summary: '', questions: [], records: [], connections: [] } }], ['POST', `/api/intakes/${intake.id}/review`, { reject: true }],
    ['DELETE', `/api/searches/${run.id}`], ['DELETE', `/api/visits/${visit.id}`], ['POST', `/api/saved-searches/${saved.id}/run`, {}], ['DELETE', `/api/saved-searches/${saved.id}`],
    ['POST', '/api/records', { investigationId: inv.id, title: 'planted', kind: 'Note' }],
    ['POST', '/api/connections', { fromId: person.id, toId: org.id, label: 'planted' }],
    ['POST', '/api/intakes', { investigationId: inv.id, text: 'planted' }],
    ['POST', '/api/searches', { investigationId: inv.id, engine: 'bing', query: 'q', url: 'https://www.bing.com/search?q=q', results: [] }],
    ['POST', '/api/visits', { investigationId: inv.id, url: 'https://planted.example/' }],
    ['POST', '/api/saved-searches', { investigationId: inv.id, kind: 'lab', query: 'x' }],
    ['POST', '/api/archive/save', { investigationId: inv.id, url: 'https://planted.example/' }],
  ];
  for (const [method, route, body] of probes) {
    const { status } = await b.call(route, body, method);
    assert.equal(status, 404, `B: ${method} ${route} → ${status}`);
  }

  // A's data is untouched.
  const d = await a.api(`/api/investigations/${inv.id}`);
  assert.deepEqual(d.records.map((r: any) => r.title).sort(), ['A-only org', 'A-only person']);
  assert.equal(d.connections[0].label, 'works for');
  assert.equal((await a.api(`/api/intakes/${intake.id}`)).state, 'captured');
  assert.equal((await a.api(`/api/investigations/${inv.id}/searches`)).length, 1);
  // Nothing was planted in B either.
  assert.equal((await h.graph.sql('SELECT FROM Record WHERE title=:t', { t: 'planted' })).length, 0);

  // The research CLI is scoped by its token too.
  assert.equal((await b.cli('investigations')).some((x: any) => x.id === inv.id), false);
  await assert.rejects(b.cli('snapshot', '--case', inv.id), /not found/);
});

test('token mode: plan limits stop metered work with 402 and report usage', { skip: profile !== 'token' }, async () => {
  const c = h.limited!;
  const first = await c.api('/api/investigations', { title: 'TEST — first case on a tiny plan' });
  const second = await c.call('/api/investigations', { title: 'TEST — over the limit' });
  assert.equal(second.status, 402);
  assert.equal(second.json.code, 'limit_reached');
  assert.deepEqual([second.json.details.metric, second.json.details.limit, second.json.details.used], ['investigations', 1, 1]);

  const fd = () => { const f = new FormData(); f.set('investigationId', first.id); f.set('text', 'capture'); return f; };
  assert.equal((await c.call('/api/intakes', fd())).status, 201);
  assert.equal((await c.call('/api/intakes', fd())).status, 402, 'monthly captures are limited');

  const usage = await c.api('/api/workspace');
  assert.equal(usage.plan, 'tiny');
  assert.deepEqual(usage.usage.metrics.investigations, { used: 1, limit: 1 });
  assert.deepEqual(usage.usage.metrics['captures.monthly'], { used: 1, limit: 1 });
  assert.equal(usage.usage.metrics['storage.bytes'].limit, null, 'unlisted metrics are unlimited');

  // Unlimited workspaces are unaffected.
  assert.equal((await h.a.api('/api/workspace')).plan, 'unlimited');
});

test('workspace endpoint describes the caller\'s workspace', async () => {
  const ws = await h.a.api('/api/workspace');
  assert.equal(ws.id, h.a.workspaceId);
  assert.equal(ws.plan, 'unlimited');
});
