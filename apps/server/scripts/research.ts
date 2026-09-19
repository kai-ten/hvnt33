// The research CLI: how the AI agent (and you) operate on investigations.
//   npm run research -- <command> --flag value …
// Targets HVNT33_URL (default http://localhost:$PORT) and sends HVNT33_TOKEN
// as a bearer token when set (token-mode servers).
import fsp from 'node:fs/promises';
import path from 'node:path';
import { createWriteStream, openAsBlob } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const base = (process.env.HVNT33_URL || `http://localhost:${process.env.PORT || 4310}`).replace(/\/$/, '');
const auth: Record<string, string> = process.env.HVNT33_TOKEN ? { Authorization: `Bearer ${process.env.HVNT33_TOKEN}` } : {};

const [command, ...args] = process.argv.slice(2);
const flags: Record<string, string> = {};
for (let i = 0; i < args.length; i += 2) {
  if (!args[i].startsWith('--') || args[i + 1] === undefined) throw Error('Use --flag value');
  flags[args[i].slice(2)] = args[i + 1];
}
const required = (key: string) => { if (!flags[key]) throw Error(`--${key} required`); return flags[key]; };
const id = (key: string) => encodeURIComponent(required(key));

async function api(route: string, body?: unknown): Promise<any> {
  const form = body instanceof FormData;
  const response = await fetch(base + route, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { ...auth, ...(body !== undefined && !form ? { 'Content-Type': 'application/json' } : {}) },
    body: body === undefined ? undefined : form ? body : JSON.stringify(body),
  });
  const result = (await response.json()) as any;
  if (!response.ok) throw Error(result.error);
  return result;
}

/** A text file from the API, as JSON output ({ text }). */
async function text(route: string): Promise<{ text: string }> {
  const response = await fetch(base + route, { headers: auth });
  if (!response.ok) throw Error(((await response.json().catch(() => null)) as any)?.error ?? response.statusText);
  return { text: await response.text() };
}

const MEDIA_TYPES: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.pdf': 'application/pdf',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime', '.mp3': 'audio/mpeg', '.wav': 'audio/wav',
  '.txt': 'text/plain', '.md': 'text/markdown', '.csv': 'text/csv', '.json': 'application/json',
};

const commands: Record<string, { usage: string; run(): Promise<unknown> }> = {
  investigations: { usage: 'investigations', run: () => api('/api/investigations') },
  'create-case': {
    usage: 'create-case --title TITLE [--question-file FILE]',
    run: async () => api('/api/investigations', { title: required('title'), description: flags['question-file'] ? await fsp.readFile(flags['question-file'], 'utf8') : '' }),
  },
  'save-lab-search': {
    usage: 'save-lab-search --case ID (--query SPL | --query-file FILE) [--label LABEL]',
    run: async () => {
      const query = flags['query-file'] ? await fsp.readFile(required('query-file'), 'utf8') : required('query');
      return api('/api/saved-searches', { investigationId: required('case'), kind: 'lab', query: query.trim(), label: flags.label || 'Agent query', engines: [] });
    },
  },
  context: { usage: 'context --case ID', run: () => api(`/api/investigations/${id('case')}/context`) },
  snapshot: { usage: 'snapshot --case ID', run: () => api(`/api/investigations/${id('case')}`) },
  queue: { usage: 'queue --case ID', run: () => api(`/api/investigations/${id('case')}/intakes`) },
  export: {
    usage: 'export --case ID --output ZIP [--scope selected|all]',
    async run() {
      const scope = flags.scope || 'selected';
      if (!['selected', 'all'].includes(scope)) throw Error('--scope must be selected or all');
      const output = path.resolve(required('output'));
      const response = await fetch(`${base}/api/investigations/${id('case')}/export${scope === 'all' ? '?scope=all' : ''}`, { headers: auth });
      if (!response.ok || !response.body) throw Error(((await response.json()) as { error: string }).error);
      await fsp.mkdir(path.dirname(output), { recursive: true });
      await pipeline(Readable.fromWeb(response.body as any), createWriteStream(output, { flags: 'wx', mode: 0o600 }));
      return { output, scope };
    },
  },
  show: { usage: 'show --intake ID', run: () => api(`/api/intakes/${id('intake')}`) },
  capture: {
    usage: 'capture --case ID --text-file FILE [--source-url URL] [--source-label LABEL] [--title T] [--source-mode MODE] [--attachment FILE]',
    async run() {
      const body = new FormData();
      body.set('investigationId', required('case'));
      body.set('text', flags['text-file'] ? await fsp.readFile(flags['text-file'], 'utf8') : flags.text || '');
      for (const [flag, key] of [['title', 'title'], ['source-url', 'sourceUrl'], ['source-label', 'sourceLabel'], ['source-mode', 'contentOrigin']]) if (flags[flag]) body.set(key, flags[flag]);
      if (flags.attachment) {
        const type = MEDIA_TYPES[path.extname(flags.attachment).toLowerCase()] || 'application/octet-stream';
        body.set('file', await openAsBlob(flags.attachment, { type }), path.basename(flags.attachment));
      }
      return api('/api/intakes', body);
    },
  },
  propose: {
    usage: 'propose --intake ID --draft-file JSON',
    run: async () => api(`/api/intakes/${id('intake')}/draft`, { draft: JSON.parse(await fsp.readFile(required('draft-file'), 'utf8')) }),
  },
  analyze: { usage: 'analyze --intake ID', run: () => api(`/api/intakes/${id('intake')}/analyze`, {}) },
  file: {
    usage: 'file --intake ID [--new-entities true]',
    async run() {
      const item = await api(`/api/intakes/${id('intake')}`);
      if (['filed', 'approved'].includes(item.state)) return item;
      if (item.state !== 'pending' || !item.draft) throw Error('Stage an extracted draft before filing');
      // Reuse uniquely matching entities unless told to keep everything separate.
      const reuse = flags['new-entities'] !== 'true';
      return api(`/api/intakes/${id('intake')}/review`, {
        mode: 'agent',
        records: item.draft.records.map((r: { id: string; matchId?: string }) => ({ id: r.id, ...(r.matchId && reuse ? { reuseId: r.matchId } : {}) })),
        connections: item.draft.connections.map((c: { id: string }) => ({ id: c.id })),
      });
    },
  },
  'archive-history': { usage: 'archive-history --url URL [--refresh true]', run: () => api('/api/archive/lookup', { url: required('url'), refresh: flags.refresh === 'true' }) },
  'archive-save': { usage: 'archive-save --case ID --url URL [--intake ID]', run: () => api('/api/archive/save', { investigationId: required('case'), url: required('url'), intakeId: flags.intake || '' }) },
  'page-snapshot': { usage: 'page-snapshot --case ID --url URL [--intake ID]', run: () => api('/api/snapshots', { investigationId: required('case'), url: required('url'), ...(flags.intake ? { intakeId: flags.intake } : {}) }) },
  'page-snapshots': { usage: 'page-snapshots --case ID', run: () => api(`/api/investigations/${id('case')}/snapshots`) },
  'page-text': { usage: 'page-text --snapshot ID', run: () => text(`/api/snapshots/${id('snapshot')}/files/text`) },
  'page-changes': { usage: 'page-changes --case ID', run: () => api(`/api/investigations/${id('case')}/page-changes`) },
  'page-diff': { usage: 'page-diff --change ID', run: () => api(`/api/page-changes/${id('change')}/diff`) },
  watch: { usage: 'watch --case ID --url URL [--every-hours 24]', run: () => api('/api/watches', { investigationId: required('case'), url: required('url'), everyHours: Number(flags['every-hours'] || 24) }) },
  changes: { usage: 'changes --case ID [--since ISO]', run: () => api(`/api/investigations/${id('case')}/changes${flags.since ? `?since=${encodeURIComponent(flags.since)}` : ''}`) },
  workspace: { usage: 'workspace', run: () => api('/api/workspace') },
};

try {
  const cmd = commands[command ?? ''];
  if (!cmd) throw Error(`Commands:\n${Object.values(commands).map(c => `  ${c.usage}`).join('\n')}\nFiling sorts the complete extracted batch into research automatically, without marking it fact-verified.`);
  console.log(JSON.stringify(await cmd.run(), null, 2));
} catch (error) {
  console.error((error as Error).message);
  process.exitCode = 1;
}
