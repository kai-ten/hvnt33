// The connection map: a deterministic force-directed layout (the same case
// always lays out the same way) and a standalone SVG for downloading.

export interface GraphNode { id: string; title: string; kind: string; status: string }
export interface GraphEdge { id: string; fromId: string; toId: string; label: string; status: string }
export type Positions = Record<string, { x: number; y: number }>;

export const KIND_COLORS: Record<string, string> = {
  // Mineral pigments, legible on travertine and on black stone.
  Person: "#3F6FA0", Organization: "#7A5A9C", Place: "#3E8272", Event: "#A07A1E", Claim: "#B8392A",
  Document: "#857760", Image: "#B8653A", Video: "#B8653A", Link: "#3E8272", Note: "#8C8272",
};

/** A small seeded random generator, so layouts are stable between renders. */
function random(seed: string) {
  let h = 2166136261;
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return () => { h = Math.imul(h ^ (h >>> 15), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); return ((h ^= h >>> 16) >>> 0) / 4294967296; };
}

/**
 * Fruchterman–Reingold layout inside width × height. Nodes in `fixed` keep
 * their positions (the researcher dragged them); others settle around them.
 */
export function layout(nodes: GraphNode[], edges: GraphEdge[], width: number, height: number, fixed: Positions = {}, iterations = 250): Positions {
  const rand = random(nodes.map(n => n.id).join(","));
  const pos: Positions = {};
  const n = nodes.length;
  nodes.forEach((node, i) => {
    const a = (2 * Math.PI * i) / Math.max(n, 1);
    pos[node.id] = fixed[node.id] ? { ...fixed[node.id] } : { x: width / 2 + Math.cos(a) * width * 0.3 + (rand() - 0.5) * 20, y: height / 2 + Math.sin(a) * height * 0.3 + (rand() - 0.5) * 20 };
  });
  if (n < 2) return pos;
  const ids = new Set(nodes.map(x => x.id));
  const links = edges.filter(e => ids.has(e.fromId) && ids.has(e.toId) && e.fromId !== e.toId);
  const k = Math.sqrt((width * height) / n) * 0.75;
  let temperature = width / 8;
  for (let it = 0; it < iterations; it++) {
    const disp: Record<string, { x: number; y: number }> = {};
    for (const a of nodes) disp[a.id] = { x: 0, y: 0 };
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      const a = pos[nodes[i].id], b = pos[nodes[j].id];
      let dx = a.x - b.x, dy = a.y - b.y;
      let d = Math.hypot(dx, dy);
      if (d < 0.01) { dx = rand() - 0.5; dy = rand() - 0.5; d = 0.01; }
      const f = (k * k) / d;
      disp[nodes[i].id].x += (dx / d) * f; disp[nodes[i].id].y += (dy / d) * f;
      disp[nodes[j].id].x -= (dx / d) * f; disp[nodes[j].id].y -= (dy / d) * f;
    }
    for (const e of links) {
      const a = pos[e.fromId], b = pos[e.toId];
      const dx = a.x - b.x, dy = a.y - b.y, d = Math.max(Math.hypot(dx, dy), 0.01);
      const f = (d * d) / k;
      disp[e.fromId].x -= (dx / d) * f; disp[e.fromId].y -= (dy / d) * f;
      disp[e.toId].x += (dx / d) * f; disp[e.toId].y += (dy / d) * f;
    }
    for (const node of nodes) {
      if (fixed[node.id]) continue;
      const d = disp[node.id], len = Math.max(Math.hypot(d.x, d.y), 0.01), p = pos[node.id];
      // A gentle pull to the centre keeps unconnected records on screen.
      p.x += (d.x / len) * Math.min(len, temperature) + (width / 2 - p.x) * 0.01;
      p.y += (d.y / len) * Math.min(len, temperature) + (height / 2 - p.y) * 0.01;
      p.x = Math.min(width - 40, Math.max(40, p.x));
      p.y = Math.min(height - 30, Math.max(30, p.y));
    }
    temperature *= 0.985;
  }
  for (const id of Object.keys(pos)) pos[id] = { x: Math.round(pos[id].x), y: Math.round(pos[id].y) };
  return pos;
}

const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

/** The map as a standalone SVG document (for slides, reports and archives). */
export function mapSvg(title: string, nodes: GraphNode[], edges: GraphEdge[], pos: Positions, width: number, height: number): string {
  const ids = new Set(nodes.map(n => n.id));
  const lines = edges.filter(e => ids.has(e.fromId) && ids.has(e.toId)).map(e => {
    const a = pos[e.fromId], b = pos[e.toId];
    const dash = e.status === "Verified" || e.status === "Corroborated" ? "" : ' stroke-dasharray="5 4"';
    return `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="#857760" stroke-width="1.4"${dash} marker-end="url(#arrow)"/><text x="${(a.x + b.x) / 2}" y="${(a.y + b.y) / 2 - 5}" class="edge">${esc(clip(e.label, 40))}</text>`;
  }).join("\n");
  const dots = nodes.map(n => {
    const p = pos[n.id];
    return `<g transform="translate(${p.x},${p.y})"><circle r="9" fill="${KIND_COLORS[n.kind] ?? "#8C8272"}" stroke="#1D1A16" stroke-width="2"/><text y="24" class="node">${esc(clip(n.title, 36))}</text></g>`;
  }).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">
<title>${esc(title)}</title>
<style>text{font-family:"IBM Plex Sans",Helvetica,Arial,sans-serif}.node{font-size:12px;fill:#1D1A16;text-anchor:middle;paint-order:stroke;stroke:#EBE5D8;stroke-width:3px}.edge{font-size:10px;fill:#5A5245;text-anchor:middle;paint-order:stroke;stroke:#EBE5D8;stroke-width:3px}</style>
<defs><marker id="arrow" markerWidth="8" markerHeight="8" refX="18" refY="4" orient="auto"><path d="M0 0 L8 4 L0 8" fill="#857760"/></marker></defs>
<rect width="100%" height="100%" fill="#EBE5D8"/>
${lines}
${dots}
<text x="12" y="${height - 12}" font-size="10" fill="#6F6451">${esc(title)} · HVNT33 · dashed: not verified or corroborated</text>
</svg>
`;
}
