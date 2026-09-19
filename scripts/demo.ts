// A fictional demo investigation, for trying hvnt33 and for screenshots:
//   npm run demo
// Creates "Meridian Bay dredging contract (demo)" through the API, the way the
// agent files material: two captured sources filed into records and
// connections (Unverified, as agent filing always is), one capture waiting for
// the agent, and a saved search. Every person, company and place is invented;
// URLs use the reserved example.org domain. Running it again does nothing.
const base = (process.env.HVNT33_URL || `http://localhost:${process.env.PORT || 4310}`).replace(/\/$/, '');
const auth: Record<string, string> = process.env.HVNT33_TOKEN ? { Authorization: `Bearer ${process.env.HVNT33_TOKEN}` } : {};
const TITLE = 'Meridian Bay dredging contract (demo)';

async function api(route: string, body?: unknown, method = body === undefined ? 'GET' : 'POST'): Promise<any> {
  const res = await fetch(base + route, { method, headers: { ...auth, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw Error(`${method} ${route}: ${json?.error ?? res.status}`);
  return json;
}

type Draft = {
  summary: string; questions: string[];
  records: { key: string; title: string; kind: string; notes: string; eventDate: string; tags: string; quote: string }[];
  connections: { fromKey: string; toKey: string; label: string; notes: string; quote: string }[];
};

const gazette = `FICTIONAL DEMO SOURCE — invented for the hvnt33 demo.

Meridian Bay Gazette, 15 March 2025

Port awards $48 million dredging contract without tender

On 14 March 2025 the Meridian Bay Port Authority awarded a $48 million dredging contract to Calder Marine Works. Port commissioner Elena Voss chaired the vote.

Calder Marine Works was founded in 2019 by Ruben Achterberg, who previously served as the Port Authority's operations director.

The contract was awarded without a public tender. The Port Authority cited emergency silt conditions in the north channel.`;

const minutes = `FICTIONAL DEMO SOURCE — invented for the hvnt33 demo.

Meridian Bay Port Authority — minutes of the special session, 14 March 2025

Present: Commissioner Elena Voss (chair), Commissioner Tomas Reyes, Commissioner Ada Lindqvist.

Commissioner Reyes asked whether other firms had been invited to bid. The chair stated that emergency conditions justified a direct award.

Motion to award the north channel dredging contract to Calder Marine Works carried 2–1, Commissioner Reyes voting against.`;

const drafts: [string, string, string, Draft][] = [
  ['Port awards $48 million dredging contract without tender', 'Meridian Bay Gazette (fictional)', 'https://news.example.org/meridian-bay/dredging-contract', {
    summary: 'A fictional newspaper report that the Port Authority awarded a $48 million contract without tender to a firm founded by its former operations director.',
    questions: ['When did Ruben Achterberg leave the Port Authority, and did he have a role in assessing the silt conditions?', 'Who else owns Calder Marine Works?'],
    records: [
      { key: 'port', title: 'Meridian Bay Port Authority', kind: 'Organization', notes: 'Public port operator (fictional).', eventDate: '', tags: 'demo', quote: 'Meridian Bay Port Authority' },
      { key: 'calder', title: 'Calder Marine Works', kind: 'Organization', notes: 'Dredging contractor (fictional), founded in 2019 according to the Gazette.', eventDate: '', tags: 'demo, contractor', quote: 'Calder Marine Works was founded in 2019 by Ruben Achterberg' },
      { key: 'achterberg', title: 'Ruben Achterberg', kind: 'Person', notes: 'Founder of Calder Marine Works; former Port Authority operations director, per the Gazette (fictional).', eventDate: '', tags: 'demo', quote: 'who previously served as the Port Authority\'s operations director' },
      { key: 'voss', title: 'Elena Voss', kind: 'Person', notes: 'Port commissioner who chaired the vote (fictional).', eventDate: '', tags: 'demo', quote: 'Port commissioner Elena Voss chaired the vote.' },
      { key: 'award', title: '$48 million dredging contract awarded', kind: 'Event', notes: 'Reported award to Calder Marine Works (fictional).', eventDate: '2025-03-14', tags: 'demo, procurement', quote: 'On 14 March 2025 the Meridian Bay Port Authority awarded a $48 million dredging contract to Calder Marine Works.' },
      { key: 'notender', title: 'Contract awarded without public tender', kind: 'Claim', notes: 'The Gazette reports no public tender; the Port Authority cited emergency silt conditions. Unverified.', eventDate: '2025-03-14', tags: 'demo, procurement, unverified', quote: 'The contract was awarded without a public tender.' },
    ],
    connections: [
      { fromKey: 'port', toKey: 'award', label: 'awarded', notes: '', quote: 'the Meridian Bay Port Authority awarded a $48 million dredging contract to Calder Marine Works' },
      { fromKey: 'calder', toKey: 'award', label: 'received', notes: '', quote: 'awarded a $48 million dredging contract to Calder Marine Works' },
      { fromKey: 'achterberg', toKey: 'calder', label: 'founded', notes: 'In 2019, per the Gazette.', quote: 'Calder Marine Works was founded in 2019 by Ruben Achterberg' },
      { fromKey: 'achterberg', toKey: 'port', label: 'formerly worked for', notes: 'As operations director; dates unknown.', quote: 'who previously served as the Port Authority\'s operations director' },
      { fromKey: 'voss', toKey: 'award', label: 'chaired the vote on', notes: '', quote: 'Port commissioner Elena Voss chaired the vote.' },
    ],
  }],
  ['Port Authority minutes, special session of 14 March 2025', 'Meridian Bay Port Authority minutes (fictional)', 'https://records.example.org/meridian-bay/port-minutes-2025-03-14', {
    summary: 'Fictional minutes: the award carried 2–1 as a direct award justified by emergency conditions; Commissioner Reyes questioned the lack of other bidders.',
    questions: ['Was an emergency declared formally before the session?'],
    records: [
      { key: 'reyes', title: 'Tomas Reyes', kind: 'Person', notes: 'Port commissioner who voted against the award (fictional).', eventDate: '', tags: 'demo', quote: 'Commissioner Reyes voting against' },
      { key: 'voss', title: 'Elena Voss', kind: 'Person', notes: 'Chair of the special session (fictional).', eventDate: '', tags: 'demo', quote: 'Commissioner Elena Voss (chair)' },
      { key: 'vote', title: 'Dredging award carried 2–1', kind: 'Event', notes: 'Special session vote (fictional).', eventDate: '2025-03-14', tags: 'demo, procurement', quote: 'Motion to award the north channel dredging contract to Calder Marine Works carried 2–1' },
      { key: 'emergency', title: 'Chair: emergency conditions justified a direct award', kind: 'Claim', notes: 'Stated by the chair in the minutes. Unverified.', eventDate: '2025-03-14', tags: 'demo, unverified', quote: 'The chair stated that emergency conditions justified a direct award.' },
    ],
    connections: [
      { fromKey: 'reyes', toKey: 'vote', label: 'voted against', notes: '', quote: 'Commissioner Reyes voting against' },
      { fromKey: 'voss', toKey: 'emergency', label: 'stated', notes: 'As chair.', quote: 'The chair stated that emergency conditions justified a direct award.' },
    ],
  }],
];

const existing = (await api('/api/investigations')).find((c: { title: string }) => c.title === TITLE);
if (existing) {
  console.log(`The demo case already exists: ${existing.id}`);
} else {
  const inv = await api('/api/investigations', { title: TITLE, description: 'Fictional demo. Was the Meridian Bay dredging contract steered to a former insider\'s company?' });
  for (const [title, sourceLabel, sourceUrl, draft] of drafts) {
    const intake = await api('/api/intakes', { investigationId: inv.id, title, sourceLabel, sourceUrl, text: title.startsWith('Port awards') ? gazette : minutes });
    const staged = await api(`/api/intakes/${intake.id}/draft`, { draft });
    // Reuse a record the first source already filed (Elena Voss), as the agent would.
    await api(`/api/intakes/${intake.id}/review`, {
      mode: 'agent',
      records: staged.draft.records.map((r: { id: string; matchId?: string }) => ({ id: r.id, ...(r.matchId ? { reuseId: r.matchId } : {}) })),
      connections: staged.draft.connections.map((c: { id: string }) => ({ id: c.id })),
    });
  }
  await api('/api/intakes', {
    investigationId: inv.id, title: 'Calder Marine Works company registration (waiting for the agent)', sourceLabel: 'Meridian Bay companies register (fictional)', sourceUrl: 'https://registry.example.org/companies/calder-marine-works',
    text: 'FICTIONAL DEMO SOURCE — invented for the hvnt33 demo.\n\nCalder Marine Works Ltd. Registered 2 April 2019. Directors: Ruben Achterberg, Mara Achterberg. Registered office: 9 Quay Street, Meridian Bay.',
    researcherNote: 'Demo: send this to the agent to see it filed.',
  });
  await api('/api/saved-searches', { investigationId: inv.id, kind: 'web', query: 'Calder Marine Works dredging', engines: ['duckduckgo', 'bing'] });
  const dossier = await api(`/api/investigations/${inv.id}`);
  console.log(`Created the demo case "${TITLE}" (${inv.id}): ${dossier.records.length} records, ${dossier.connections.length} connections, one capture waiting for the agent.`);
}
