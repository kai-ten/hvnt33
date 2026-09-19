// The API against a real server and ArcadeDB. Runs unchanged in both profiles
// (local and token), and every JSON response is checked against its declared
// schema (HVNT33_CONTRACT_CHECK), so these are contract tests too.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { type Harness, profile, removeInvestigation, start } from './harness.ts';
import { draftInput, original } from './fixtures.ts';

let h: Harness;
const cleanup: string[] = [];
const blobKeys = new Set<string>();
before(async () => { h = await start(); });
after(async () => {
  for (const id of cleanup) await removeInvestigation(h.graph, id);
  // Content-addressed evidence is shared: remove a test blob only if nothing references it now.
  for (const key of blobKeys) {
    const [r] = await h.graph.sql('SELECT count(*) AS n FROM Record WHERE fileKey=:k', { k: key });
    const [i] = await h.graph.sql('SELECT count(*) AS n FROM Intake WHERE attachment.fileKey=:k', { k: key });
    if (!Number(r?.n) && !Number(i?.n)) await fs.rm(path.join(h.config.vaultDir, 'sha256', key.slice(7, 9), key.slice(9, 11), key.slice(7)), { force: true });
  }
  await h.close();
});
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000b49444154789c636000020000050001a5f645400000000049454e44ae426082', 'hex');

async function newCase(title: string) {
  const inv = await h.a.api('/api/investigations', { title: `TEST — ${title}`, description: 'A fictional test case' });
  cleanup.push(inv.id);
  return inv;
}

test('health reports the database, auth mode and features', async () => {
  const health = await h.a.api('/api/health');
  assert.equal(health.database, 'ArcadeDB');
  assert.equal(health.auth, h.config.auth);
  assert.ok(health.features.includes('workspaces'));
});

test('investigations can be archived and restored without losing their research', async () => {
  const inv = await newCase('recoverable archive');
  const record = await h.a.api('/api/records', { investigationId: inv.id, title: 'Retained evidence', kind: 'Note' });

  const archived = await h.a.api(`/api/investigations/${inv.id}`, undefined, 'DELETE');
  assert.ok(archived.deletedAt);
  assert.equal((await h.a.api('/api/investigations')).some((x: any) => x.id === inv.id), false);
  assert.equal((await h.a.api('/api/investigations/archived')).some((x: any) => x.id === inv.id), true);
  assert.equal((await h.a.call(`/api/investigations/${inv.id}`)).status, 404, 'archived cases cannot be opened accidentally');

  if (h.b) {
    assert.equal((await h.b.call(`/api/investigations/${inv.id}`, undefined, 'DELETE')).status, 404, 'another workspace cannot archive it');
    assert.equal((await h.b.api('/api/investigations/archived')).some((x: any) => x.id === inv.id), false);
  }

  const restored = await h.a.api(`/api/investigations/${inv.id}/restore`, {});
  assert.equal(restored.deletedAt, '');
  const dossier = await h.a.api(`/api/investigations/${inv.id}`);
  assert.equal(dossier.records.find((x: any) => x.id === record.id).title, 'Retained evidence');
});

test('investigations, evidence, connections, edits and selective offline export', async () => {
  const inv = await newCase('Procurement investigation');
  const other = await newCase('separate case');
  assert.equal(inv.workspaceId, h.a.workspaceId);
  assert.equal(inv.version, 1);
  const person = await h.a.api('/api/records', { investigationId: inv.id, title: 'Fictional official', kind: 'Person', public: true });
  const company = await h.a.api('/api/records', { investigationId: inv.id, title: 'Fictional company', kind: 'Organization', public: true });
  const privateNote = await h.a.api('/api/records', { investigationId: inv.id, title: 'CONFIDENTIAL-NOTE-MARKER', kind: 'Note' });
  const isolated = await h.a.api('/api/records', { investigationId: other.id, title: 'Other case', kind: 'Person' });

  const fd = new FormData();
  for (const [k, v] of Object.entries({ investigationId: inv.id, title: 'Award notice', kind: 'Image', status: 'Verified', eventDate: '2025-06-12', sourceUrl: 'https://example.org/notice', public: 'true' })) fd.append(k, v);
  fd.append('file', new Blob([PNG], { type: 'image/png' }), 'notice.png');
  const evidence = await h.a.api('/api/records', fd);
  blobKeys.add(evidence.fileKey);
  const sha = createHash('sha256').update(PNG).digest('hex');
  assert.equal(evidence.sha256, sha);
  assert.equal(evidence.fileKey, `sha256/${sha}`, 'evidence is stored by content');
  const file = await h.a.call(`/api/files/${evidence.id}`);
  assert.deepEqual(Buffer.from(await file.res.arrayBuffer()), PNG);

  const edge = await h.a.api('/api/connections', { fromId: person.id, toId: company.id, label: 'awarded contract to', evidenceId: evidence.id, status: 'Verified', public: true });
  const edited = await h.a.api(`/api/connections/${edge.id}`, { notes: 'Supported by the award notice', status: 'Corroborated' }, 'PATCH');
  assert.equal(edited.version, 2);
  await h.a.api('/api/connections', { fromId: company.id, toId: privateNote.id, label: 'private lead', public: true });
  assert.equal((await h.a.call('/api/connections', { fromId: person.id, toId: isolated.id, label: 'invalid' })).status, 400, 'cross-case connections are refused');
  assert.equal((await h.a.call('/api/records', { investigationId: inv.id, title: 'bad URL', kind: 'Link', sourceUrl: 'javascript:alert(1)' })).status, 400);
  assert.equal((await h.a.call('/api/records', { investigationId: inv.id, title: 'x', kind: 'Unicorn' })).status, 400);
  await h.a.api(`/api/records/${person.id}`, { notes: 'Research finding <script>alert(1)</script>', status: 'Corroborated' }, 'PATCH');

  const data = await h.a.api(`/api/investigations/${inv.id}`);
  assert.equal(data.records.length, 4);
  assert.equal(data.connections.length, 2);
  assert.equal(data.records.find((r: any) => r.id === person.id).status, 'Corroborated');
  const [native] = await h.graph.sql('SELECT FROM Connection WHERE id=:id', { id: edge.id });
  assert.ok(native['@rid'], 'connections are real graph edges');

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hvnt33-test-'));
  try {
    for (const [scope, count, connections] of [['', 3, 1], ['?scope=all', 4, 2]] as const) {
      const zip = path.join(dir, scope ? 'all.zip' : 'selected.zip');
      if (scope) {
        const res = await h.a.call(`/api/investigations/${inv.id}/export${scope}`);
        assert.equal(res.status, 200);
        await fs.writeFile(zip, Buffer.from(await res.res.arrayBuffer()));
      } else {
        const result = await h.a.cli('export', '--case', inv.id, '--scope', 'selected', '--output', zip);
        assert.equal(result.output, zip);
        await assert.rejects(h.a.cli('export', '--case', inv.id, '--output', zip), 'exports never overwrite');
      }
      const inspection = spawnSync('python3', ['-c', `import zipfile,json,sys
z=zipfile.ZipFile(sys.argv[1]);d=json.loads(z.read('investigation.json'));h=z.read('index.html').decode()
print(json.dumps({'records':len(d['records']),'connections':len(d['connections']),'private':'CONFIDENTIAL-NOTE-MARKER' in h,'escaped':'&lt;script&gt;' in h,'valid':z.testzip() is None,'files':len([n for n in z.namelist() if n.startswith('files/')]),'components':all(n in z.namelist() for n in ['records.csv','connections.csv','connection-map.svg']),'svgPrivate':'CONFIDENTIAL-NOTE-MARKER' in z.read('connection-map.svg').decode()}))`, zip], { encoding: 'utf8' });
      assert.equal(inspection.status, 0, inspection.stderr);
      const out = JSON.parse(inspection.stdout);
      assert.deepEqual(out, { records: count, connections, private: !!scope, escaped: true, valid: true, files: 1, components: true, svgPrivate: !!scope });
    }
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }

  const hostile = await h.a.call('/api/investigations', { title: 'blocked' }, 'POST', { Origin: 'https://evil.example' });
  assert.equal(hostile.status, 403, 'other sites cannot call the API from a browser');
});

test('identical evidence is stored once', async () => {
  const inv = await newCase('dedupe');
  const upload = async (name: string) => {
    const fd = new FormData();
    fd.append('investigationId', inv.id); fd.append('title', name); fd.append('kind', 'Image');
    fd.append('file', new Blob([PNG], { type: 'image/png' }), `${name}.png`);
    return h.a.api('/api/records', fd);
  };
  const [one, two] = [await upload('one'), await upload('two')];
  blobKeys.add(one.fileKey);
  assert.equal(one.fileKey, two.fileKey);
  assert.equal(two.filename, 'two.png', 'each record keeps its own filename');
});

test('sync groundwork: versions, changes since a time, and tombstones', async () => {
  const inv = await newCase('sync');
  const a = await h.a.api('/api/records', { investigationId: inv.id, title: 'A', kind: 'Person' });
  const b = await h.a.api('/api/records', { investigationId: inv.id, title: 'B', kind: 'Organization' });
  const edge = await h.a.api('/api/connections', { fromId: a.id, toId: b.id, label: 'works for' });
  const mark = (await h.a.api(`/api/investigations/${inv.id}/changes`)).serverTime;
  assert.equal((await h.a.api(`/api/investigations/${inv.id}/changes?since=${encodeURIComponent(mark)}`)).records.length, 0);
  await new Promise(r => setTimeout(r, 5));
  const updated = await h.a.api(`/api/records/${a.id}`, { notes: 'edited' }, 'PATCH');
  assert.equal(updated.version, 2);
  const deleted = await h.a.api(`/api/records/${b.id}`, undefined, 'DELETE');
  assert.equal(deleted.connections, 1, "a deleted record's connections are deleted too");
  const changes = await h.a.api(`/api/investigations/${inv.id}/changes?since=${encodeURIComponent(mark)}`);
  assert.deepEqual(changes.records.map((r: any) => [r.id, !!r.deletedAt]).sort(), [[a.id, false], [b.id, true]].sort());
  assert.deepEqual(changes.connections.map((c: any) => [c.id, !!c.deletedAt]), [[edge.id, true]]);
  const d = await h.a.api(`/api/investigations/${inv.id}`);
  assert.deepEqual(d.records.map((r: any) => r.id), [a.id], 'deleted records disappear from the dossier');
  assert.equal(d.connections.length, 0);
  assert.equal((await h.a.call(`/api/records/${b.id}`, { notes: 'x' }, 'PATCH')).status, 404);
});

test('captured material stays outside the graph until atomic, idempotent filing', async () => {
  const inv = await h.a.cli('create-case', '--title', `TEST — AI intake ${randomUUID()}`);
  cleanup.push(inv.id);
  const other = await newCase('Other intake');
  const jane = await h.a.api('/api/records', { investigationId: inv.id, title: 'Jane Vale', kind: 'Person', notes: 'Existing notes must be preserved', status: 'Verified' });
  const outside = await h.a.api('/api/records', { investigationId: other.id, title: 'Harbor Works', kind: 'Organization' });

  const form = new FormData();
  form.set('investigationId', inv.id); form.set('title', 'Fictional supplied account'); form.set('sourceLabel', 'Supplied interview notes');
  form.set('sourceUrl', 'https://example.org/research'); form.set('file', new Blob([original], { type: 'text/plain' }), 'interview.txt');
  const captured = await h.a.api('/api/intakes', form);
  blobKeys.add(captured.attachment.fileKey);
  assert.equal(captured.text, original);
  assert.equal((await h.a.cli('show', '--intake', captured.id)).id, captured.id);
  assert.equal((await h.a.api(`/api/investigations/${inv.id}`)).records.length, 1);
  assert.equal(await (await h.a.call(`/api/intakes/${captured.id}/file`)).res.text(), original);

  const staged = await h.a.api(`/api/intakes/${captured.id}/draft`, { draft: draftInput });
  assert.equal(staged.state, 'pending');
  assert.equal(staged.draft.records[0].matchId, jane.id);
  assert.equal(staged.draft.records[1].matchId, '', 'an entity in another case is never matched');
  const choices = staged.draft.records.map((r: any) => ({ id: r.id, ...(r.matchId ? { reuseId: r.matchId } : {}) }));
  choices[2].notes = 'Reviewer-corrected attributed finding';
  assert.equal((await h.a.call(`/api/intakes/${captured.id}/review`, { records: choices.map((r: any, i: number) => (i === 1 ? { ...r, reuseId: outside.id } : r)), connections: [] })).status, 400);
  assert.equal((await h.a.call(`/api/intakes/${captured.id}/review`, { records: [choices[0]], connections: [{ id: staged.draft.connections[0].id }] })).status, 400);
  const reviewed = await h.a.api(`/api/intakes/${captured.id}/review`, { records: choices, connections: [{ id: staged.draft.connections[0].id }] });
  assert.equal(reviewed.state, 'approved');
  assert.equal(reviewed.review.records[0].reused, true);

  const d = await h.a.cli('snapshot', '--case', inv.id);
  assert.equal(d.records.length, 4);
  assert.equal(d.connections.length, 4);
  const janeNow = d.records.find((r: any) => r.id === jane.id);
  assert.deepEqual([janeNow.notes, janeNow.status], ['Existing notes must be preserved', 'Verified']);
  const claim = d.records.find((r: any) => r.kind === 'Claim');
  assert.deepEqual([claim.notes, claim.sourceQuote, claim.status, claim.public, claim.workspaceId], ['Reviewer-corrected attributed finding', original, 'Unverified', false, h.a.workspaceId]);
  assert.ok(d.connections.every((c: any) => c.status === 'Unverified' && !c.public && c.workspaceId === h.a.workspaceId));
  const source = d.records.find((r: any) => r.id === reviewed.review.sourceId);
  assert.equal(source.notes, original);
  assert.ok(source.sha256);
  await h.a.api(`/api/intakes/${captured.id}/review`, { records: choices, connections: [] });
  assert.equal((await h.a.api(`/api/investigations/${inv.id}`)).records.length, 4, 'filing twice adds nothing');

  const declined = await h.a.api('/api/intakes', { investigationId: inv.id, text: 'Rejected source stays archived.', title: 'Rejected source' });
  await h.a.api(`/api/intakes/${declined.id}/draft`, { draft: { summary: 'None.', questions: [], records: [], connections: [] } });
  await h.a.api(`/api/intakes/${declined.id}/review`, { reject: true });
  assert.equal((await h.a.api(`/api/intakes/${declined.id}`)).state, 'rejected');

  const binary = new FormData();
  binary.set('investigationId', inv.id); binary.set('file', new Blob(['binary media'], { type: 'video/mp4' }), 'clip.mp4');
  const fileOnly = await h.a.api('/api/intakes', binary);
  blobKeys.add(fileOnly.attachment.fileKey);
  assert.equal(fileOnly.text, '');
  await h.a.api(`/api/intakes/${fileOnly.id}/text`, { text: 'A transcript added after capture.' }, 'PATCH');
  assert.equal((await h.a.call(`/api/intakes/${fileOnly.id}/text`, { text: 'Overwrite original' }, 'PATCH')).status, 409);
  await h.a.api(`/api/intakes/${fileOnly.id}/review`, { reject: true });
  const list = await h.a.api(`/api/investigations/${inv.id}/intakes`);
  assert.equal(list.length, 3);

  const image = new FormData();
  image.set('investigationId', inv.id); image.set('title', 'Agent visual observations'); image.set('contentOrigin', 'visual-observation');
  image.set('text', 'A visible sign reads Harbor Works.'); image.set('file', new Blob(['fictional image bytes'], { type: 'image/png' }), 'evidence.png');
  const imageIntake = await h.a.api('/api/intakes', image);
  blobKeys.add(imageIntake.attachment.fileKey);
  await h.a.api(`/api/intakes/${imageIntake.id}/draft`, { draft: { summary: 'Visual observation.', questions: [], records: [{ key: 'harbor', title: 'Harbor Works', kind: 'Organization', notes: 'A sign reads Harbor Works; this does not establish ownership.', eventDate: '', tags: 'image', quote: 'A visible sign reads Harbor Works.' }], connections: [] } });
  const filed = await h.a.cli('file', '--intake', imageIntake.id);
  assert.deepEqual([filed.state, filed.review.appliedBy, filed.review.humanReviewed, filed.review.reviewedAt, filed.review.records[0].reused], ['filed', 'agent', false, '', true]);
  const [imageSource] = await h.graph.sql('SELECT FROM Record WHERE id=:id', { id: filed.sourceId });
  assert.deepEqual([imageSource.kind, imageSource.contentOrigin, imageSource.filedBy, imageSource.status, imageSource.public], ['Image', 'visual-observation', 'agent', 'Unverified', false]);
  await h.a.cli('file', '--intake', imageIntake.id);
  assert.equal((await h.a.api(`/api/investigations/${inv.id}`)).records.length, 5);

  // Force a unique-index failure mid-transaction: no partial filing may become visible.
  const rollback = await h.a.api('/api/intakes', { investigationId: inv.id, text: original, title: 'Rollback fixture' });
  const rollbackDraft = await h.a.api(`/api/intakes/${rollback.id}/draft`, { draft: draftInput });
  await h.graph.sql('CREATE VERTEX Record CONTENT :data', { data: { id: rollbackDraft.draft.records[1].id, investigationId: other.id, workspaceId: h.a.workspaceId, title: 'Collision fixture', kind: 'Note', deletedAt: '' } });
  const failure = await h.a.call(`/api/intakes/${rollback.id}/review`, { records: rollbackDraft.draft.records.map((r: any) => ({ id: r.id })), connections: [] });
  assert.equal(failure.status, 500);
  assert.equal((await h.a.api(`/api/intakes/${rollback.id}`)).state, 'pending');
  assert.equal((await h.graph.sql('SELECT FROM Record WHERE id=:id', { id: rollback.sourceId })).length, 0);
  assert.equal((await h.a.api(`/api/investigations/${inv.id}`)).records.length, 5);
});

test('search runs, saved searches and visits persist per case', async () => {
  const inv = await newCase('desktop search sessions');
  const body = { investigationId: inv.id, engine: 'google', query: 'harbor works', url: 'https://www.google.com/search?q=harbor+works', pageTitle: 't', results: [{ title: 'City award', url: 'https://city.gov/award', snippet: 'Awarded.' }, { title: 'News', url: 'https://news.example.com/h', snippet: '' }] };
  const first = await h.a.call('/api/searches', body);
  assert.equal(first.status, 201);
  const again = await h.a.call('/api/searches', body);
  assert.deepEqual([again.status, again.json.id, again.json.duplicate], [200, first.json.id, true]);
  const reordered = await h.a.api('/api/searches', { ...body, results: [body.results[1], body.results[0]] });
  assert.notEqual(reordered.id, first.json.id);
  assert.equal((await h.a.api(`/api/investigations/${inv.id}/searches`)).length, 2);
  assert.equal((await h.a.call('/api/searches', { ...body, engine: 'nope' })).status, 400);
  await h.a.api(`/api/searches/${reordered.id}`, undefined, 'DELETE');

  const capture = new FormData();
  for (const [k, v] of Object.entries({ investigationId: inv.id, text: 'The council awarded the contract.', sourceUrl: 'https://city.gov/award', researcherNote: 'Connect this to procurement', captureMeta: JSON.stringify({ mode: 'selection', engine: 'google', query: 'harbor works' }) })) capture.set(k, v);
  const intake = await h.a.api('/api/intakes', capture);
  assert.equal(intake.captureMeta.engine, 'google');
  const [listed] = await h.a.api(`/api/investigations/${inv.id}/intakes`);
  assert.deepEqual([listed.sourceUrl, listed.researcherNote, listed.captureMeta.query], ['https://city.gov/award', 'Connect this to procurement', 'harbor works']);

  const visit = await h.a.call('/api/visits', { investigationId: inv.id, url: 'https://news.example.com/a', title: 'Story', found: { engine: 'google', query: 'harbor' }, meta: { author: 'A' } });
  assert.equal(visit.status, 201);
  const revisit = await h.a.call('/api/visits', { investigationId: inv.id, url: 'https://news.example.com/a', title: 'Story (updated)', found: { engine: 'bing', query: 'other' }, meta: { author: 'B' } });
  assert.deepEqual([revisit.status, revisit.json.id, revisit.json.visits, revisit.json.meta.author, revisit.json.found.engine], [200, visit.json.id, 2, 'B', 'google']);

  const saved = await h.a.api('/api/saved-searches', { investigationId: inv.id, kind: 'web', query: 'harbor works', engines: ['google', 'bing'] });
  assert.equal((await h.a.api('/api/saved-searches', { investigationId: inv.id, kind: 'web', query: 'harbor works', engines: ['brave'] })).id, saved.id);
  const agentQuery = await h.a.cli('save-lab-search', '--case', inv.id, '--query', 'search index=hvnt33 | stats count by sourcetype', '--label', 'Agent overview');
  assert.deepEqual([agentQuery.kind, agentQuery.label], ['lab', 'Agent overview']);
  assert.ok((await h.a.api(`/api/investigations/${inv.id}/saved-searches`)).some((s: any) => s.id === agentQuery.id), 'agent-authored SPL appears in the case');
  assert.ok((await h.a.api(`/api/saved-searches/${saved.id}/run`, {})).lastRunAt);
  await h.a.api(`/api/saved-searches/${saved.id}`, undefined, 'DELETE');
  assert.equal((await h.a.call(`/api/saved-searches/${saved.id}/run`, {})).status, 404);
});

test('archive routes: cached history without network, case scoping, clear message without keys', async () => {
  const inv = await newCase('archive');
  const url = `https://hvnt33-test.example/${randomUUID()}`;
  await h.a.api('/api/visits', { investigationId: inv.id, url, title: 't' });
  const snapshots = [{ timestamp: '20040617052922', capturedAt: '2004-06-17T05:29:22Z', original: url, status: '200', mime: 'text/html', digest: 'A', length: 1, snapshotUrl: `https://web.archive.org/web/20040617052922/${url}` }];
  await h.graph.sql('INSERT INTO ArchiveHistory CONTENT :h', { h: { id: randomUUID(), url, source: 'wayback', versions: 1, first: snapshots[0].capturedAt, last: snapshots[0].capturedAt, byYear: { 2004: 1 }, truncated: false, snapshots, checkedAt: new Date().toISOString() } });
  try {
    assert.equal((await h.a.api('/api/archive/lookup', { url })).versions, 1, 'fresh cache is served without asking the Wayback Machine');
    const scoped = await h.a.api(`/api/investigations/${inv.id}/archive`);
    assert.deepEqual(scoped.histories.map((x: any) => x.url), [url]);
    assert.equal((await h.a.call('/api/archive/lookup', { url: 'javascript:alert(1)' })).status, 400);
    const status = await h.a.api('/api/archive/status');
    const save = await h.a.call('/api/archive/save', { investigationId: inv.id, url });
    if (status.saveConfigured) assert.equal(save.status, 202);
    else { assert.equal(save.status, 503); assert.match(save.json.error, /archive\.org\/account\/s3\.php/); }
  } finally {
    await h.graph.sql('DELETE FROM ArchiveHistory WHERE url=:url', { url });
  }
});

test('OpenAPI describes every route, with unique operation ids', async () => {
  const spec = await h.a.api('/api/openapi.json');
  const ops = Object.entries(spec.paths as Record<string, Record<string, any>>).flatMap(([p, methods]) => Object.entries(methods).map(([m, op]) => ({ key: `${m} ${p}`, op })));
  assert.ok(ops.length >= 36, `${ops.length} operations`);
  assert.equal(new Set(ops.map(o => o.op.operationId)).size, ops.length);
  for (const { key, op } of ops) {
    assert.ok(op.summary, `${key} has a summary`);
    assert.ok(op.responses.default, `${key} documents errors`);
  }
  assert.ok(spec.paths['/api/records'].post.requestBody.content['multipart/form-data'].schema.properties.file);
  assert.equal(spec.paths['/api/health'].get.security.length, 0, 'health is public');
});

test('a person\'s review is recorded apart from filing: verification statuses and explicit reviews', async () => {
  const inv = await h.a.api('/api/investigations', { title: 'TEST — review' });
  try {
    const a = await h.a.api('/api/records', { investigationId: inv.id, title: 'Harbor Works', kind: 'Organization' });
    const b = await h.a.api('/api/records', { investigationId: inv.id, title: 'Ruth Vale', kind: 'Person' });
    assert.equal(a.reviewedAt ?? '', '', 'new records are not reviewed');
    const edited = await h.a.api(`/api/records/${a.id}`, { notes: 'Typo fixed' }, 'PATCH');
    assert.equal(edited.reviewedAt ?? '', '', 'an ordinary edit is not a review');
    const verified = await h.a.api(`/api/records/${a.id}`, { status: 'Corroborated' }, 'PATCH');
    assert.ok(Date.parse(verified.reviewedAt) > 0);
    assert.equal(verified.reviewedBy, profile === 'local' ? 'local' : 'workspace A@test.invalid', 'who reviewed it');
    const cleared = await h.a.api(`/api/records/${a.id}`, { reviewed: false }, 'PATCH');
    assert.deepEqual([cleared.reviewedAt, cleared.reviewedBy, cleared.status], ['', '', 'Corroborated'], 'clearing the review keeps the status');
    const marked = await h.a.api(`/api/records/${a.id}`, { reviewed: true }, 'PATCH');
    assert.ok(marked.reviewedAt);
    const c = await h.a.api('/api/connections', { fromId: b.id, toId: a.id, label: 'directs' });
    assert.equal(c.reviewedAt ?? '', '');
    const cr = await h.a.api(`/api/connections/${c.id}`, { reviewed: true }, 'PATCH');
    assert.ok(cr.reviewedAt && cr.reviewedBy);
    const d = await h.a.api(`/api/investigations/${inv.id}`);
    assert.ok(d.records.find((r: any) => r.id === a.id).reviewedAt, 'reviews are part of the dossier');
  } finally {
    await removeInvestigation(h.graph, inv.id);
  }
});
