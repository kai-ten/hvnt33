import type { Row } from '../seams/graph.ts';

// Portable outputs of an investigation: CSV, a connection-map SVG and the
// offline HTML dossier inside exports.

export const escape = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** CSV with every cell quoted; cells a spreadsheet could run as formulas are neutralized. */
export function csv(rows: Row[], columns: string[]): string {
  const cell = (row: Row, key: string) => {
    let value = String(row[key] ?? '');
    if (/^[=+@\-\t\r]/.test(value)) value = "'" + value;
    return '"' + value.replaceAll('"', '""') + '"';
  };
  return columns.join(',') + '\r\n' + rows.map(row => columns.map(k => cell(row, k)).join(',')).join('\r\n');
}

const MAP_LIMIT = 70;

export function graphSvg(records: Row[], connections: Row[]): string {
  const nodes = records.slice(0, MAP_LIMIT);
  const step = (2 * Math.PI) / Math.max(nodes.length, 1);
  const positions = new Map(nodes.map((r, i) => [r.id as string, { x: 600 + Math.cos(i * step - Math.PI / 2) * 400, y: 350 + Math.sin(i * step - Math.PI / 2) * 250 }]));
  const edges = connections.filter(c => positions.has(c.fromId as string) && positions.has(c.toId as string));
  const color = (kind: unknown) => (kind === 'Person' ? '#bba165' : kind === 'Claim' ? '#b77d63' : '#426d5c');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 740" role="img" aria-label="Investigation connection map"><rect width="1200" height="740" fill="#f5f4ee"/><defs><marker id="arrow" markerWidth="8" markerHeight="8" refX="25" refY="4" orient="auto"><path d="M0 0 L8 4 L0 8" fill="#819d8c"/></marker></defs><style>text{font:13px system-ui;fill:#1c3936}.label{font-size:11px;paint-order:stroke;stroke:#f5f4ee;stroke-width:5px}</style>${edges.map(c => {
    const a = positions.get(c.fromId as string)!, b = positions.get(c.toId as string)!;
    return `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="#a7bbac" stroke-width="2" marker-end="url(#arrow)"/><text class="label" x="${(a.x + b.x) / 2}" y="${(a.y + b.y) / 2 - 8}" text-anchor="middle">${escape(c.label)}</text>`;
  }).join('')}${nodes.map(r => {
    const p = positions.get(r.id as string)!;
    return `<g><title>${escape(r.title)} · ${escape(r.status)}</title><circle cx="${p.x}" cy="${p.y}" r="20" fill="${color(r.kind)}"/><text x="${p.x}" y="${p.y + 42}" text-anchor="middle">${escape(String(r.title).slice(0, 35))}</text></g>`;
  }).join('')}<text x="30" y="715">${nodes.length} records · ${edges.length} connections${records.length > MAP_LIMIT ? ` · Map limited to ${MAP_LIMIT} records; all data is in CSV and JSON` : ''}</text></svg>`;
}

export interface DossierData { investigation: Row; records: Row[]; connections: Row[] }

/** Self-contained HTML dossier: works offline, prints to PDF. */
export function report({ investigation: i, records: r, connections: c }: DossierData): string {
  const names = new Map(r.map(x => [x.id, x.title]));
  const file = (x: Row) => `files/${escape(x.id)}/${escape(x.filename)}`;
  const media = (x: Row) => String(x.mime ?? '').startsWith('image/') ? `<img src="${file(x)}" alt="${escape(x.title)}">`
    : String(x.mime ?? '').startsWith('video/') ? `<video controls src="${file(x)}"></video>` : '';
  const article = (x: Row) => `<article><small>${escape(x.kind)} · ${escape(x.status)}${x.eventDate ? ' · ' + escape(x.eventDate) : ''}</small><h3>${escape(x.title)}</h3><p>${escape(x.notes)}</p>${x.sourceQuote ? `<blockquote>${escape(x.sourceQuote)}</blockquote><small>Source excerpt</small>` : ''}${x.sourceUrl ? `<a href="${escape(x.sourceUrl)}">${escape(x.sourceLabel || x.sourceUrl)}</a>` : ''}${x.fileKey ? `<p><a href="${file(x)}">${escape(x.filename)}</a></p>${media(x)}<small>SHA-256: ${escape(x.sha256)}</small>` : ''}</article>`;
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escape(i.title)}</title><style>body{margin:0;background:#f4f1e9;color:#182d2b;font:18px Georgia;line-height:1.6}main{max-width:900px;margin:70px auto;padding:30px}h1{font-size:60px;line-height:1.1}h2{margin-top:60px;border-top:1px solid #b9c5bd;padding-top:25px}article{margin:28px 0;padding:25px;background:white;border:1px solid #ddd}small{font:12px system-ui;text-transform:uppercase;letter-spacing:2px}img,video{max-width:100%;max-height:500px}svg{width:100%;height:auto}p{white-space:pre-wrap}a{color:#246457}@media print{body{background:white}article{break-inside:avoid}h1{font-size:40px}}</style><main><small>Investigation dossier · Selected material</small><h1>${escape(i.title)}</h1><p>${escape(i.description)}</p><h2>Evidence & findings</h2>${r.map(article).join('')}<h2>Connection map</h2>${graphSvg(r, c)}<h2>Connections</h2>${c.map(x => `<article>${escape(names.get(x.fromId))} → <strong>${escape(x.label)}</strong> → ${escape(names.get(x.toId))}<p>${escape(x.notes)}</p><small>${escape(x.status)}${x.evidenceId ? ' · Evidence: ' + escape(names.get(x.evidenceId)) : ''}</small></article>`).join('')}<h2>Timeline</h2>${r.filter(x => x.eventDate).sort((a, b) => String(a.eventDate).localeCompare(String(b.eventDate))).map(x => `<p><strong>${escape(x.eventDate)}</strong> — ${escape(x.title)}</p>`).join('')}</main></html>`;
}
