// The mark: the emblema's pyramid and eye, cut from the floor with its own
// grout and nothing around it. Laid the way Mosaic.tsx lays the hero: outlines
// and lids as lines of tiles along their own direction, a pale halo row outside
// each line, blocks of sandstone in courses. Plain geometry and a seeded pick of
// stone shades; nothing generated. Each size is laid on its own grid, so small
// sizes stay crisp and the large ones carry the detail.
//   node scripts/mark.ts [outDir]      writes SVGs, PNGs and proof sheets to look at
//   node scripts/mark.ts --install     writes the site's favicon and the desktop app's icons
// The site uses the pyramid alone (mark); the desktop app sets it in a tile (appTile).
import fs from "node:fs";
import path from "node:path";
import sharp, { type OverlayOptions } from "sharp";
import { palettes } from "../src/lib/stone.ts";

type P = [number, number];
const pal = palettes.light;
const stones = {
  dark: pal.dark, red: pal.red, ivory: pal.ivory, gold: pal.gold, course: pal.course,
  cream: pal.cream, creamLight: [pal.cream[3], pal.cream[0]], band: pal.band,
  cap: pal.cap, capLight: [pal.cap[2], pal.ivory[1], pal.ivory[0]],
  sandLight: [pal.sand[3], pal.sand[0]], sand: [pal.sand[4], pal.sand[0], pal.sand[1]], sandDark: [pal.sand[2], pal.sand[1]],
};
type Stone = keyof typeof stones;
// A tile: its centre in tile units, the direction it is turned to, its stone.
interface Tile { x: number; y: number; a: number; s: Stone }

const cross = (a: P, b: P, p: P) => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
const inside = (p: P, poly: P[]) => { const s = poly.map((a, i) => cross(a, poly[(i + 1) % poly.length], p)); return s.every(v => v >= 0) || s.every(v => v <= 0); };
const segDist = (p: P, a: P, b: P) => {
  const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
};
const edges = (poly: P[]) => poly.map((a, i) => [a, poly[(i + 1) % poly.length]] as [P, P]);
const edgeDist = (p: P, poly: P[]) => Math.min(...edges(poly).map(([a, b]) => segDist(p, a, b)));
const rng = (seed: number) => () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
const hash = (x: number, y: number) => { const v = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453; return v - Math.floor(v); };

// The figure on an n by n grid, inset by pad (a fraction of n), as in the hero:
// a pyramid of courses, a capstone floating above a clear gap, the eye in the
// capstone's lower third with its iris in red rings.
function geometry(n: number, pad: number) {
  const m = n * pad, S = n - 2 * m;
  const apex: P = [n / 2, m + 0.02 * S], baseY = m + 0.97 * S, half = 0.49 * S;
  const at = (y: number) => { const k = (y - apex[1]) / (baseY - apex[1]); return [n / 2 - half * k, n / 2 + half * k] as const; };
  const cutY = apex[1] + 0.39 * (baseY - apex[1]), trunkTop = cutY + 0.05 * S;
  const [cl, cr] = at(cutY), [tl, tr] = at(trunkTop);
  const cap: P[] = [apex, [cr, cutY], [cl, cutY]];
  const trunk: P[] = [[tl, trunkTop], [tr, trunkTop], [n / 2 + half, baseY], [n / 2 - half, baseY]];
  const eye: P = [n / 2, cutY - (cutY - apex[1]) * 0.34];
  const eyeW = (cr - cl) * 0.46, eyeH = eyeW * 0.5;
  return { S, apex, baseY, at, cap, trunk, eye, eyeW, eyeH, iris: eyeH * 0.44 };
}

// Large sizes: grid tiles for the fields, laid tiles for every line.
function fine(n: number, pad: number, halo = 1): Tile[] {
  const G = geometry(n, pad), { cap, trunk, eye, eyeW, eyeH, iris } = G;
  const ow = n >= 200 ? 3 : n >= 120 ? 2 : 1; // rows in each outline
  const tiles: Tile[] = [], laid: Tile[] = [];
  const lid = (x: number) => { const k = (x - (eye[0] - eyeW / 2)) / eyeW; return k <= 0 || k >= 1 ? -1 : (eyeH / 2) * Math.sin(Math.PI * k); };
  const lidRows = ow;

  // Courses of equal height counted up from the base: a line of course stone,
  // then block rows; joints staggered by half. Each block is cut from one shade,
  // lit from the left, with a lighter top row and a darker bottom row.
  const H = Math.max(4, Math.round(G.S / 19)), J = Math.round(H * 1.6);
  const floor = G.baseY - ow - 0.2, shades: Stone[] = ["sandLight", "sand", "sandDark"];
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const p: P = [i + 0.5, j + 0.5];
    if (inside(p, trunk) && edgeDist(p, trunk) > ow + 0.1) {
      const up = Math.floor(floor - p[1]), course = Math.floor(up / H), row = up % H;
      const shift = (course % 2) * Math.floor(J / 2), block = Math.floor((i + shift) / J);
      if (row === 0 || (i + shift) % J === 0) { tiles.push({ x: p[0], y: p[1], a: 0, s: "course" }); continue; }
      const [l, r] = G.at(p[1]), lit = (p[0] - l) / (r - l) + (hash(block, course) - 0.5) * 0.6;
      const tone = Math.max(0, Math.min(2, Math.floor(lit * 3) + (row === H - 1 ? -1 : row === 1 ? 1 : 0)));
      tiles.push({ x: p[0], y: p[1], a: 0, s: shades[tone] });
      continue;
    }
    if (inside(p, cap) && edgeDist(p, cap) > ow + 0.1) {
      const h = lid(p[0]), dy = Math.abs(p[1] - eye[1]);
      if (Math.hypot(p[0] - eye[0], p[1] - eye[1]) < iris + 0.6) continue; // the iris is laid in rings
      if (h > 0 && dy < h + lidRows + 0.2) { if (dy < h - 0.3) tiles.push({ x: p[0], y: p[1], a: 0, s: "ivory" }); continue; }
      // The capstone brightens toward the eye.
      const glow = Math.max(0, 1.25 - Math.hypot((p[0] - eye[0]) / eyeW, (p[1] - eye[1]) / eyeW) * 1.1);
      tiles.push({ x: p[0], y: p[1], a: 0, s: hash(i, j) < glow ? "capLight" : "cap" });
    }
  }

  // Outlines: rows of dark tiles along each edge, inside, and halo rows of pale
  // stone outside, turning round each corner, as Roman mosaicists set off a figure.
  const haloStone = (k: number): Stone => (k >= -2 ? "ivory" : "creamLight");
  for (const poly of [trunk, cap]) {
    const other = poly === trunk ? cap : trunk;
    const ownSide = (q: P) => !inside(q, other) && edgeDist(q, other) >= edgeDist(q, poly) - 0.01;
    const c: P = [poly.reduce((s, q) => s + q[0], 0) / poly.length, poly.reduce((s, q) => s + q[1], 0) / poly.length];
    for (const [a, b] of edges(poly)) {
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]), ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
      let [nx, ny] = [-Math.sin(ang), Math.cos(ang)];
      const mid: P = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      if ((c[0] - mid[0]) * nx + (c[1] - mid[1]) * ny < 0) [nx, ny] = [-nx, -ny];
      for (let k = -halo; k < ow; k++) {
        const off = k + 0.5;
        for (let s = 0.5; s < len; s += 1) {
          const q: P = [a[0] + (b[0] - a[0]) * s / len + nx * off, a[1] + (b[1] - a[1]) * s / len + ny * off];
          if (k < 0 ? inside(q, poly) || !ownSide(q) : !inside(q, poly)) continue;
          laid.push({ x: q[0], y: q[1], a: ang, s: k < 0 ? haloStone(k) : "dark" });
        }
      }
    }
    for (let i = 0; i < poly.length; i++) {
      const v = poly[i], before = poly[(i + poly.length - 1) % poly.length], after = poly[(i + 1) % poly.length];
      const out = (a: P, b: P) => { const ang = Math.atan2(b[1] - a[1], b[0] - a[0]); let o: P = [Math.sin(ang), -Math.cos(ang)]; if ((c[0] - a[0]) * o[0] + (c[1] - a[1]) * o[1] > 0) o = [-o[0], -o[1]]; return Math.atan2(o[1], o[0]); };
      const t0 = out(before, v); let t1 = out(v, after);
      while (t1 - t0 > Math.PI) t1 -= 2 * Math.PI;
      while (t0 - t1 > Math.PI) t1 += 2 * Math.PI;
      for (let k = -halo; k < 0; k++) {
        const rho = -(k + 0.5), steps = Math.ceil(Math.abs(t1 - t0) * rho);
        for (let q = 1; q < steps; q++) {
          const th = t0 + ((t1 - t0) * q) / steps, pt: P = [v[0] + Math.cos(th) * rho, v[1] + Math.sin(th) * rho];
          if (ownSide(pt)) laid.push({ x: pt[0], y: pt[1], a: th + Math.PI / 2, s: haloStone(k) });
        }
      }
    }
  }
  // The lids, laid along their curves.
  for (const sign of [-1, 1]) for (let k = 0; k < lidRows; k++) {
    let last: P | null = null;
    for (let t = 0; t <= 1; t += 0.002) {
      const x = eye[0] - eyeW / 2 + eyeW * t, h = (eyeH / 2) * Math.sin(Math.PI * t) + (k + 0.5) * Math.sin(Math.PI * t) ** 0.5;
      const q: P = [x, eye[1] + sign * h];
      if (last && Math.hypot(q[0] - last[0], q[1] - last[1]) < 1) continue;
      const slope = sign * ((eyeH / 2) * Math.PI * Math.cos(Math.PI * t)) / eyeW;
      laid.push({ x: q[0], y: q[1], a: Math.atan(slope), s: "dark" }); last = q;
    }
  }
  // The iris in rings: a dark rim, red rings, the pupil and one ivory glint.
  for (let r = 0; r <= iris + 0.01; r += 0.95) {
    const ring = Math.max(1, Math.round(2 * Math.PI * r));
    for (let q = 0; q < ring; q++) {
      const th = (q / ring) * Math.PI * 2, pupil = r < iris * 0.4, rim = r > iris - 1;
      const glint = r > 0 && r < iris * 0.4 && Math.abs(th - Math.PI * 1.25) < 0.7;
      laid.push({ x: eye[0] + Math.cos(th) * r, y: eye[1] + Math.sin(th) * r, a: th + Math.PI / 2, s: glint ? "ivory" : pupil || rim ? "dark" : "red" });
    }
  }
  // Where two lines meet, keep the first tile laid.
  const kept: Tile[] = [], seen = new Map<string, Tile[]>();
  const cellKey = (x: number, y: number) => `${Math.floor(x)},${Math.floor(y)}`;
  for (const t of laid) {
    const near = [-1, 0, 1].flatMap(dx => [-1, 0, 1].flatMap(dy => seen.get(cellKey(t.x + dx, t.y + dy)) ?? []));
    if (near.some(o => Math.hypot(o.x - t.x, o.y - t.y) < 0.72)) continue;
    kept.push(t); seen.set(cellKey(t.x, t.y), [...(seen.get(cellKey(t.x, t.y)) ?? []), t]);
  }
  return [...tiles, ...kept];
}

// Small sizes: every tile on a whole pixel, a one-tile outline, the eye as a red iris.
function coarse(n: number, pad: number): Tile[] {
  const G = geometry(n, pad), { cap, trunk, eye, eyeW, eyeH } = G, tiles: Tile[] = [];
  const H = Math.max(3, Math.round(G.S / 9));
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const p: P = [i + 0.5, j + 0.5];
    for (const poly of [trunk, cap]) {
      const d = edgeDist(p, poly), inPoly = inside(p, poly);
      if (!inPoly && d > 0.5) continue;
      let s: Stone;
      if (d < 0.75) s = "dark";
      else if (poly === trunk) s = Math.floor(G.baseY - p[1]) % H === 1 ? "course" : "sandLight";
      else {
        const k = (p[0] - (eye[0] - eyeW / 2)) / eyeW, h = k > 0 && k < 1 ? (eyeH / 2) * Math.sin(Math.PI * k) : -1;
        const r = Math.hypot(p[0] - eye[0], p[1] - eye[1]);
        s = r < Math.max(0.8, eyeH * 0.3) ? "red" : h > 0 && Math.abs(p[1] - eye[1]) < h ? "ivory" : "cap";
      }
      tiles.push({ x: p[0], y: p[1], a: 0, s }); break;
    }
  }
  return tiles;
}

// 16 by 16, laid by hand: at this size every tile is a decision.
// . clear  C cap  s sand  k course  d dark  w ivory  r red
const small = [
  "................",
  ".......dd.......",
  "......dCCd......",
  ".....dCCCCd.....",
  "....dwwrrwwd....",
  "...dCCCCCCCCd...",
  "...dddddddddd...",
  "................",
  "..dddddddddddd..",
  "..dssssssssssd..",
  ".dkkkkkkkkkkkkd.",
  ".dssssssssssssd.",
  "dkkkkkkkkkkkkkkd",
  "dssssssssssssssd",
  "dddddddddddddddd",
  "................",
];
const code: Record<string, Stone> = { C: "cap", s: "sandLight", k: "course", d: "dark", w: "ivory", r: "red" };
const fromMap = (rows: string[]): Tile[] => rows.flatMap((row, j) => [...row].flatMap((c, i) => (code[c] ? [{ x: i + 0.5, y: j + 0.5, a: 0, s: code[c] }] : [])));

// Tiles as SVG rects over a grout silhouette. Once a tile is 3px or more, mortar
// shows and each tile is turned and sized a little differently, as a hand lays
// them; below that, tiles meet edge to edge on whole pixels and there is no grout.
const r = (v: number) => Math.round(v * 100) / 100;
function rects(tiles: Tile[], cell: number, mortar: number, ox = 0, oy = 0) {
  const rand = rng(33), fill = (s: Stone) => { const list = stones[s]; return mortar ? list[Math.floor(rand() * list.length)] : list[0]; };
  return tiles.map(t => {
    const cx = ox + t.x * cell, cy = oy + t.y * cell;
    if (!mortar) return `<rect x="${r(cx - cell / 2)}" y="${r(cy - cell / 2)}" width="${r(cell)}" height="${r(cell)}" fill="${fill(t.s)}"/>`;
    const w = (cell - mortar) * (0.93 + rand() * 0.1), deg = (t.a * 180) / Math.PI + (rand() - 0.5) * 9;
    const x = cx + (rand() - 0.5) * cell * 0.08, y = cy + (rand() - 0.5) * cell * 0.08;
    return `<rect x="${r(x - w / 2)}" y="${r(y - w / 2)}" width="${r(w)}" height="${r(w)}" fill="${fill(t.s)}" transform="rotate(${r(deg)} ${r(x)} ${r(y)})"/>`;
  }).join("");
}
const mortarFor = (cell: number) => (cell >= 3 ? Math.max(0.5, cell * 0.14) : 0);

function svg(tiles: Tile[], n: number, px: number, opts: { pad?: number; ground?: string } = {}) {
  const cell = px / n, mortar = mortarFor(cell);
  let grout = "";
  if (mortar) {
    const G = geometry(n, opts.pad ?? 0), pts = (poly: P[]) => poly.map(q => `${r(q[0] * cell)},${r(q[1] * cell)}`).join(" ");
    const w = r(2 * 1.05 * cell);
    grout = [G.trunk, G.cap].map(poly => `<polygon points="${pts(poly)}" fill="${pal.grout}" stroke="${pal.grout}" stroke-width="${w}" stroke-linejoin="round"/>`).join("");
  }
  const body = rects(tiles, cell, mortar);
  const ground = opts.ground ? `<rect width="${px}" height="${px}" fill="${opts.ground}"/>` : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${px} ${px}" width="${px}" height="${px}"${mortar ? "" : ' shape-rendering="crispEdges"'}>${ground}${grout}${body}</svg>\n`;
}

// One drawing per size. The desktop icon leaves a margin, as macOS icons do;
// the favicon fills its square.
const PAD = 0.07;
const mark = (px: number, pad = PAD) => {
  if (px <= 16) return svg(fromMap(small), 16, px);
  const n = px <= 64 ? 32 : px <= 128 ? 64 : Math.round(px / (px >= 1024 ? 4.4 : px >= 512 ? 3.6 : 3.1));
  return svg(n >= 80 ? fine(n, pad) : coarse(n, pad), n, px, { pad });
};
const png = (s: string) => sharp(Buffer.from(s)).png().toBuffer();

// The desktop icon: the pyramid set in a panel of travertine on Apple's icon
// grid (an 824px body with 185px corners on a 1024px canvas), so it sits with
// the other tiles in the Dock, the taskbar and a Linux launcher. The field is
// laid in rows; three halo rows follow the figure; a dark line and a red fillet
// are laid along the rounded edge.
function appTile(px: number) {
  const inset = Math.round((px * 100) / 1024), body = px - 2 * inset, radius = r((body * 185) / 824);
  const plate = `<rect x="${inset}" y="${inset}" width="${body}" height="${body}" rx="${radius}"`;
  const head = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${px} ${px}" width="${px}" height="${px}">`;
  if (px <= 128) {
    // Small: flat travertine, a red fillet, the pyramid on whole pixels.
    const n = px <= 64 ? body : Math.round(body / 2), cell = body / n, line = Math.max(1, r(px / 64));
    const fillet = px >= 64 ? `<rect x="${r(inset + line * 1.5)}" y="${r(inset + line * 1.5)}" width="${r(body - line * 3)}" height="${r(body - line * 3)}" rx="${r(radius - line * 1.5)}" fill="none" stroke="${pal.red[0]}" stroke-width="${line}"/>` : "";
    const figure = px <= 16 ? rects(fromMap(small).map(t => ({ ...t, x: 1 + t.x * 0.875, y: 1 + t.y * 0.875 })), 1, 0) : `<g shape-rendering="crispEdges">${rects(coarse(n, 0.16), cell, 0, inset, inset)}</g>`;
    return `${head}${plate} fill="${pal.cream[0]}"/>${fillet}${figure}</svg>\n`;
  }
  const cell = px >= 1024 ? 4.4 : px >= 512 ? 3.6 : 3.1, N = Math.round(body / cell), c = body / N, R = (N * 185) / 824;
  const pad = 0.15, halo = 3, frame = 6;
  const G = geometry(N, pad), polys = [G.trunk, G.cap];
  const inward = (p: P) => {
    const ax = Math.abs(p[0] - N / 2) - (N / 2 - R), ay = Math.abs(p[1] - N / 2) - (N / 2 - R);
    return R - Math.hypot(Math.max(ax, 0), Math.max(ay, 0)) - Math.min(Math.max(ax, ay), 0);
  };
  const field: Tile[] = [];
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const p: P = [i + 0.5, j + 0.5];
    if (inward(p) < frame + 0.1 || polys.some(q => inside(p, q) || edgeDist(p, q) < halo + 0.45)) continue;
    field.push({ x: p[0], y: p[1], a: 0, s: "cream" });
  }
  // Rows laid along the rounded edge at inset d: straight runs and quarter arcs.
  const ring = (d: number, s: Stone): Tile[] => {
    const h = N / 2 - d, rr = R - d, k = h - rr, pts: P[] = [];
    const corners: [number, number, number][] = [[k, -k, -Math.PI / 2], [k, k, 0], [-k, k, Math.PI / 2], [-k, -k, Math.PI]];
    for (const [cx, cy, a0] of corners) for (let t = 0; t <= Math.PI / 2 + 1e-9; t += 0.01) pts.push([N / 2 + cx + Math.cos(a0 + t) * rr, N / 2 + cy + Math.sin(a0 + t) * rr]);
    pts.push(pts[0]);
    const out: Tile[] = [];
    let carry = 0.5;
    for (let i = 1; i < pts.length; i++) {
      const [a, b] = [pts[i - 1], pts[i]], len = Math.hypot(b[0] - a[0], b[1] - a[1]), ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
      let at = carry;
      while (at <= len) { out.push({ x: a[0] + (b[0] - a[0]) * (at / len), y: a[1] + (b[1] - a[1]) * (at / len), a: ang, s }); at += 1; }
      carry = at - len;
    }
    return out;
  };
  const border = ([[0.5, "band"], [1.5, "band"], [2.5, "dark"], [3.5, "band"], [4.5, "red"], [5.5, "ivory"]] as const).flatMap(([d, s]) => ring(d, s));
  const tiles = [...field, ...fine(N, pad, halo), ...border];
  return `${head}<clipPath id="plate">${plate}/></clipPath><g clip-path="url(#plate)">${plate} fill="${pal.grout}"/>${rects(tiles, c, mortarFor(c), inset, inset)}</g></svg>\n`;
}
// The favicon is the detailed mark as an SVG: fewer, larger tiles than the
// desktop icon, colours as classes and coordinates to one decimal, so every
// page can load it cheaply. Browsers draw it at whatever size they need.
const FAVICON_TILES = 96;
function favicon() {
  const s = svg(fine(FAVICON_TILES, 0.02), FAVICON_TILES, 512, { pad: 0.02 }).replace(/(\d+\.\d)\d+/g, "$1");
  const colours = [...new Set(s.match(/#[0-9a-f]{6}/gi))];
  const body = colours.reduce((t, c, i) => t.replaceAll(`fill="${c}"`, `class="c${i}"`), s).replace(' width="512" height="512"', "");
  const style = `<style>${colours.map((c, i) => `.c${i}{fill:${c}}`).join("")}</style>`;
  return body.replace(/(<svg[^>]*>)/, `$1${style}`);
}

// .icns and .ico both hold plain PNGs; the containers are a few header bytes.
function icns(entries: [string, Buffer][]) {
  const parts = entries.map(([type, data]) => { const h = Buffer.alloc(8); h.write(type, 0, "ascii"); h.writeUInt32BE(data.length + 8, 4); return Buffer.concat([h, data]); });
  const head = Buffer.alloc(8); head.write("icns", 0, "ascii"); head.writeUInt32BE(8 + parts.reduce((n, b) => n + b.length, 0), 4);
  return Buffer.concat([head, ...parts]);
}
function ico(images: [number, Buffer][]) {
  const head = Buffer.alloc(6 + 16 * images.length);
  head.writeUInt16LE(1, 2); head.writeUInt16LE(images.length, 4);
  let offset = head.length;
  images.forEach(([px, data], i) => {
    const e = 6 + 16 * i;
    head.writeUInt8(px >= 256 ? 0 : px, e); head.writeUInt8(px >= 256 ? 0 : px, e + 1);
    head.writeUInt16LE(1, e + 4); head.writeUInt16LE(32, e + 6); head.writeUInt32LE(data.length, e + 8); head.writeUInt32LE(offset, e + 12);
    offset += data.length;
  });
  return Buffer.concat([head, ...images.map(([, d]) => d)]);
}
// iOS fills a transparent touch icon with black, so it gets the travertine ground.
const appleIcon = () => svg(fine(96, 0.1), 96, 180, { pad: 0.1, ground: "#EBE5D8" });

if (process.argv.includes("--install")) {
  const web = path.join(import.meta.dirname, "../src/app"), icons = path.join(import.meta.dirname, "../../desktop/build-resources"); // electron-builder's buildResources
  fs.writeFileSync(path.join(web, "icon.svg"), favicon());
  fs.writeFileSync(path.join(web, "apple-icon.png"), await png(appleIcon()));
  const at: Record<number, Buffer> = {};
  for (const px of [16, 32, 64, 128, 256, 512, 1024]) at[px] = await png(appTile(px));
  fs.writeFileSync(path.join(icons, "icon.icns"), icns([
    ["icp4", at[16]], ["ic11", at[32]], ["icp5", at[32]], ["ic12", at[64]], ["icp6", at[64]], ["ic07", at[128]],
    ["ic13", at[256]], ["ic08", at[256]], ["ic14", at[512]], ["ic09", at[512]], ["ic10", at[1024]],
  ]));
  fs.writeFileSync(path.join(icons, "icon.ico"), ico([16, 32, 64, 128, 256].map(px => [px, at[px]])));
  fs.writeFileSync(path.join(icons, "icon.png"), at[1024]);
  console.log("mark: installed the favicon, apple-icon and desktop icons");
} else {
  const out = path.resolve(process.argv[2] ?? path.join(import.meta.dirname, "../out-mark"));
  fs.mkdirSync(out, { recursive: true });
  const write = async (name: string, s: string) => { fs.writeFileSync(path.join(out, `${name}.svg`), s); fs.writeFileSync(path.join(out, `${name}.png`), await png(s)); };
  for (const px of [1024, 512, 256, 128, 64, 32, 16]) await write(`mark-${px}`, mark(px));
  await write("apple-icon", appleIcon());
  for (const px of [1024, 512, 256, 128, 64, 32, 16]) await write(`app-${px}`, appTile(px));
  fs.writeFileSync(path.join(out, "favicon.svg"), favicon());

  // Proof sheets: each size at 1x, and the small ones enlarged with hard edges, on stone and on black.
  const sheet = async (bg: string, file: string) => {
    const items = [["mark-1024", 1024, 0.5], ["mark-256", 256, 1], ["mark-128", 128, 1], ["mark-64", 64, 1], ["mark-32", 32, 1], ["mark-16", 16, 1], ["mark-32", 32, 6], ["mark-16", 16, 12]] as const;
    const layers: OverlayOptions[] = [];
    let x = 40;
    for (const [f, size, zoom] of items) {
      const w = Math.round(size * zoom);
      const input = await sharp(path.join(out, `${f}.png`)).resize(w, w, { kernel: zoom > 1 ? "nearest" : "lanczos3" }).toBuffer();
      layers.push({ input, left: x, top: 40 + Math.round((512 - w) / 2) }); x += w + 40;
    }
    await sharp({ create: { width: x, height: 592, channels: 4, background: bg } }).composite(layers).png().toFile(path.join(out, file));
  };
  await sheet("#EBE5D8", "proof-light.png");
  // The desktop icon among Dock-sized neighbours, on a dark and a light Dock.
  for (const [bg, name] of [["#2b2a2e", "dock-dark.png"], ["#d9d6dc", "dock-light.png"]] as const) {
    const layers: OverlayOptions[] = [];
    for (const [i, f] of ["app-128", "app-64", "app-32"].entries()) layers.push({ input: await sharp(path.join(out, `${f}.png`)).toBuffer(), left: [24, 176, 264][i], top: [16, 48, 64][i] });
    await sharp({ create: { width: 320, height: 160, channels: 4, background: bg } }).composite(layers).png().toFile(path.join(out, name));
  }
  await sheet("#151311", "proof-dark.png");
  console.log(`mark: wrote ${out}`);
}
