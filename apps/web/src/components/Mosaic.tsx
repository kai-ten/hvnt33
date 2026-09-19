"use client";
import { useEffect, useRef } from "react";
import { key, palettes } from "@/lib/stone";

// The hero emblema: a Roman mosaic panel. A Greek key border and a red fillet
// frame a field laid in rows (opus tessellatum). In the field, the Eye of
// Providence: a pyramid of sandstone courses, a floating capstone, gold rays
// laid along their own direction (opus vermiculatum), and the eye, whose iris
// is laid in red rings. On load the floor is laid over a pale underdrawing,
// the pyramid rises course by course, the rays spread, and the eye opens last.
// Afterwards the pointer rakes light across the stone. With reduced motion
// the finished panel is drawn once.

type P = [number, number];
interface Tile { x: number; y: number; a: number; s: number; c: string; d: number; k: number[] }

const BAND = 12; // outer line, cream, the key (7), cream, inner line, red fillet

const rng = (seed: number) => () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
const segDist = (p: P, a: P, b: P) => {
  const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
};
const cross = (a: P, b: P, p: P) => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
const inTri = (p: P, a: P, b: P, c: P) => { const s = [cross(a, b, p), cross(b, c, p), cross(c, a, p)]; return s.every(v => v >= 0) || s.every(v => v <= 0); };
const ease = (t: number) => 1 - Math.pow(1 - t, 3);

export function Mosaic() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    let tiles: Tile[] = [];
    let w = 0, h = 0, dpr = 1, frame = 0, start = 0, end = 0;
    let panel = { x: 0, y: 0, w: 0, h: 0 };
    let pal = palettes.light;
    let still: HTMLCanvasElement | null = null;
    let lamp: P | null = null;

    const build = () => {
      const box = canvas.getBoundingClientRect();
      w = box.width; h = box.height; dpr = Math.min(devicePixelRatio || 1, 2);
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
      pal = document.documentElement.dataset.theme === "dark" ? palettes.dark : palettes.light;
      still = null;
      const wide = w > 820;
      const cell = wide ? 8 : 5;
      let maxW: number, maxH: number;
      if (wide) { maxW = Math.min(w * 0.4, 700); maxH = Math.min(h * 0.84, maxW * 1.1); }
      else { maxW = w - 32; maxH = Math.min(maxW, h * 0.42); }
      // Whole key units on every side, so the key closes cleanly at each corner.
      const fit = (px: number) => 2 * BAND + 10 * Math.max(2, Math.floor((Math.floor(px / cell) - 2 * BAND - 1) / 10)) + 1;
      const cols = fit(maxW), rows = fit(maxH);
      const pw = cols * cell, ph = rows * cell;
      const px = wide ? w - pw - Math.max(w * 0.045, (w - 1536) / 2 + 72) : (w - pw) / 2;
      const py = wide ? (h - ph) / 2 : h - ph - 28;
      panel = { x: Math.round(px), y: Math.round(py), w: pw, h: ph };
      const rand = rng(33);
      const pick = (list: string[]) => list[Math.floor(rand() * list.length)];
      const jitter = () => Array.from({ length: 8 }, () => (rand() - 0.5) * cell * 0.16);
      const size = cell - (wide ? 1.3 : 0.9);
      const add = (x: number, y: number, c: string, d: number, a = 0) => tiles.push({ x: panel.x + x, y: panel.y + y, a, s: size, c, d, k: jitter() });
      tiles = [];

      // The field, in panel pixels.
      const f0 = BAND * cell, fw = pw - 2 * f0, fh = ph - 2 * f0;
      const F = (u: number, v: number): P => [f0 + u * fw, f0 + v * fh];
      const apex = F(0.5, 0.17), baseL = F(0.08, 0.94), baseR = F(0.92, 0.94);
      const at = (v: number) => { // the pyramid's edges at height v
        const t = (F(0, v)[1] - apex[1]) / (baseL[1] - apex[1]);
        return [apex[0] + (baseL[0] - apex[0]) * t, apex[0] + (baseR[0] - apex[0]) * t] as const;
      };
      // Trunk: from the cut to the base. Capstone: above the cut, lifted by a gap.
      const cutV = 0.47, gap = fh * 0.045;
      const cutY = F(0, cutV)[1], trunkTop = cutY + gap * 0.4;
      const [cl, cr] = at(cutV);
      const cap: [P, P, P] = [[apex[0], apex[1] - gap * 0.6], [cl, cutY - gap * 0.6], [cr, cutY - gap * 0.6]];
      const trunk: P[] = [[at(0)[0], trunkTop], [0, 0], [0, 0], [0, 0]];
      const [tl, tr] = at((trunkTop - f0) / fh);
      trunk[0] = [tl, trunkTop]; trunk[1] = [tr, trunkTop]; trunk[2] = baseR; trunk[3] = baseL;
      const inTrunk = (p: P) => p[1] >= trunkTop && p[1] <= baseL[1] && inTri(p, apex, baseL, baseR);
      const inCap = (p: P) => inTri(p, cap[0], cap[1], cap[2]);
      const eye: P = [apex[0], cap[1][1] - (cap[1][1] - cap[0][1]) * 0.34];
      const eyeW = (cr - cl) * 0.44, eyeH = eyeW * 0.52, iris = eyeH * 0.44;
      const inEye = (p: P) => {
        const t = (p[0] - (eye[0] - eyeW / 2)) / eyeW;
        if (t <= 0 || t >= 1) return false;
        return Math.abs(p[1] - eye[1]) < (eyeH / 2) * Math.sin(Math.PI * t);
      };
      // Glory: rays from the eye, alternating long and short, above the trunk.
      let rays: [P, P][] = [];
      const R0 = Math.hypot(cap[1][0] - eye[0], cap[1][1] - eye[1]) + cell * 2.5;
      for (let i = 0; i < 26; i++) {
        const th = -Math.PI / 2 + (i - 12.5) * (Math.PI * 2 / 26);
        const len = (i % 2 ? 0.8 : 1) * Math.min(fw, fh) * 0.62;
        const a: P = [eye[0] + Math.cos(th) * R0, eye[1] + Math.sin(th) * R0];
        const b: P = [eye[0] + Math.cos(th) * len, eye[1] + Math.sin(th) * len];
        rays.push([a, b]);
      }
      const inField = (p: P) => p[0] > f0 + cell && p[0] < pw - f0 - cell && p[1] > f0 + cell && p[1] < ph - f0 - cell;
      // A ray clipped by the border to a stub reads as a mistake: leave it out.
      rays = rays.filter(([a, b]) => {
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
        let n = 0;
        for (let t = 0; t <= len; t += cell) { const q: P = [a[0] + (b[0] - a[0]) * (t / len), a[1] + (b[1] - a[1]) * (t / len)]; if (inField(q) && !inTrunk(q)) n++; }
        return n >= 7;
      });
      // Drop the lowest ray on each side: it crowds the pyramid's slope.
      for (const side of [-1, 1]) {
        const lowest = rays.filter(([, e]) => Math.sign(e[0] - eye[0]) === side).sort(([, e1], [, e2]) => e2[1] - e1[1])[0];
        rays = rays.filter(r => r !== lowest);
      }
      const nearEdge = (p: P, a: P, b: P) => segDist(p, a, b) < cell * 0.75;
      const capEdges: [P, P][] = [[cap[0], cap[1]], [cap[1], cap[2]], [cap[2], cap[0]]];
      const trunkEdges: [P, P][] = [[trunk[0], trunk[3]], [trunk[1], trunk[2]], [trunk[0], trunk[1]], [trunk[3], trunk[2]]];

      const baseRow = Math.floor(baseL[1] / cell) - 1;
      // Border and field, laid in straight rows.
      for (let j = 0; j < rows; j++) {
        for (let i = 0; i < cols; i++) {
          const x = (i + 0.5) * cell, y = (j + 0.5) * cell, p: P = [x, y];
          const d = Math.min(i, j, cols - 1 - i, rows - 1 - j);
          const sweep = ((i + j) / (cols + rows)) * 1400 + rand() * 240;
          if (d < BAND) {
            const corner = Math.min(i, cols - 1 - i) < BAND && Math.min(j, rows - 1 - j) < BAND;
            let c: string;
            if (d === 0 || d === 10) c = pick(pal.dark);
            else if (d === 11) c = pick(pal.red);
            else if (d >= 2 && d <= 8 && !corner) {
              const horizontal = Math.min(j, rows - 1 - j) === d;
              const along = (horizontal ? i : j) - BAND;
              const last = (horizontal ? cols : rows) - 2 * BAND - 1;
              // Each side's key stops at its middle tile (the 4th of 7 rows) at
              // both ends, so the line runs straight on into the gold line that
              // leads to the square centred in the corner.
              const onKey = along === 0 ? d <= 5 : along === last ? d >= 5 : key[d - 2][along % 10] === "#";
              c = onKey ? pick(pal.dark) : pick(pal.band);
            } else if (corner && d >= 2) {
              // In each corner a red square sits centred on the key's middle row,
              // and gold lines join it to the key on both sides.
              const ci = Math.min(i, cols - 1 - i), cj = Math.min(j, rows - 1 - j);
              if (Math.abs(ci - 5) <= 1 && Math.abs(cj - 5) <= 1) c = pick(pal.red);
              else if ((cj === 5 && ci >= 7) || (ci === 5 && cj >= 7)) c = pick(pal.gold);
              else c = pick(pal.band);
            }
            else c = pick(pal.band);
            add(x, y, c, sweep * 0.55);
            continue;
          }
          // Figure regions laid on the grid: masonry courses, the capstone, the white of the eye.
          if (trunkEdges.some(([a, b]) => nearEdge(p, a, b))) continue;
          if (inTrunk(p)) {
            // Courses of equal height: a mortar row, then three rows of block,
            // counted up from the base; joints every six tiles, staggered by half.
            const up = baseRow - j;
            const course = Math.floor(up / 4);
            const joint = (i + (course % 2) * 3) % 6 === 0;
            const c = up % 4 === 0 || joint ? pick(pal.course) : pick(pal.sand);
            add(x, y, c, 1300 + ((baseL[1] - y) / fh) * 1100 + rand() * 120);
            continue;
          }
          if (capEdges.some(([a, b]) => nearEdge(p, a, b))) continue;
          if (inCap(p)) {
            if (Math.hypot(x - eye[0], y - eye[1]) < iris + cell * 0.6) continue;
            if (inEye(p)) { add(x, y, pick(pal.ivory), 2900 + rand() * 150); continue; }
            if (Math.abs(Math.abs((y - eye[1]) / (eyeH / 2)) - Math.sin(Math.PI * Math.min(1, Math.max(0, (x - (eye[0] - eyeW / 2)) / eyeW)))) < cell / eyeH * 1.8 && Math.abs(x - eye[0]) < eyeW / 2 + cell) continue;
            add(x, y, pick(pal.cap), 2350 + rand() * 200);
            continue;
          }
          if (rays.some(([a, b]) => nearEdge(p, a, b))) continue;
          add(x, y, pick(pal.cream), sweep);
        }
      }

      // Lines laid along their own direction.
      const lay = (a: P, b: P, colors: string[], delay: (t: number) => number, ok: (p: P) => boolean = () => true) => {
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]), ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
        for (let t = 0; t <= len; t += cell) {
          const p: P = [a[0] + (b[0] - a[0]) * (t / len), a[1] + (b[1] - a[1]) * (t / len)];
          if (ok(p)) add(p[0], p[1], pick(colors), delay(t / len), ang);
        }
      };
      rays.forEach(([a, b]) => lay(a, b, pal.gold, t => 2500 + t * 700 + rand() * 80, p => inField(p) && !inTrunk(p) && !trunkEdges.some(([c, e]) => segDist(p, c, e) < cell * 1.2)));
      trunkEdges.forEach(([a, b]) => lay(a, b, pal.dark, t => 1250 + (1 - t) * 900));
      capEdges.forEach(([a, b]) => lay(a, b, pal.dark, t => 2300 + t * 300));
      // The eye: lids, then the iris in red rings, then the pupil and its light.
      for (const sign of [-1, 1]) {
        const n = Math.ceil(eyeW / cell) + 2;
        for (let q = 0; q <= n; q++) {
          const t = q / n, x = eye[0] - eyeW / 2 + eyeW * t, y = eye[1] + sign * (eyeH / 2) * Math.sin(Math.PI * t);
          const slope = sign * (eyeH / 2) * Math.PI * Math.cos(Math.PI * t) / eyeW;
          add(x, y, pick(pal.dark), 3000 + Math.abs(t - 0.5) * 300, Math.atan(slope));
        }
      }
      for (let r = 0; r <= iris; r += cell * 0.95) {
        const ring = Math.max(1, Math.round((2 * Math.PI * r) / cell));
        for (let q = 0; q < ring; q++) {
          const th = (q / ring) * Math.PI * 2;
          const x = eye[0] + Math.cos(th) * r, y = eye[1] + Math.sin(th) * r;
          const pupil = r < iris * 0.45;
          const glint = r > 0 && r < iris * 0.45 && Math.abs(th - Math.PI * 1.25) < 0.6;
          add(x, y, glint ? pick(pal.ivory) : pupil ? pick(pal.dark) : pick(pal.red), 3350 + (iris - r) / iris * 400, th + Math.PI / 2);
        }
      }
      end = Math.max(...tiles.map(t => t.d)) + 650;
    };

    const quad = (t: Tile, scale: number, lift: number) => {
      const s = (t.s * scale) / 2, cos = Math.cos(t.a), sin = Math.sin(t.a), k = t.k;
      const pt = (dx: number, dy: number, jx: number, jy: number) => [t.x + (dx * cos - dy * sin) + jx, t.y - lift + (dx * sin + dy * cos) + jy];
      const c = [pt(-s, -s, k[0], k[1]), pt(s, -s, k[2], k[3]), pt(s, s, k[4], k[5]), pt(-s, s, k[6], k[7])];
      ctx.beginPath(); ctx.moveTo(c[0][0], c[0][1]);
      for (let i = 1; i < 4; i++) ctx.lineTo(c[i][0], c[i][1]);
      ctx.closePath(); ctx.fill();
    };

    const paint = (t: number) => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      // Mortar appears first, showing the underdrawing where tiles are yet to go.
      ctx.globalAlpha = Math.min(1, t / 500);
      ctx.fillStyle = pal.grout;
      ctx.fillRect(panel.x, panel.y, panel.w, panel.h);
      for (const tile of tiles) {
        const k = ease(Math.min(1, Math.max(0, (t - tile.d) / 550)));
        if (k <= 0) continue;
        ctx.globalAlpha = k;
        ctx.fillStyle = tile.c;
        quad(tile, 0.55 + 0.45 * k, (1 - k) * 5);
      }
      ctx.globalAlpha = 1;
    };

    const finish = () => {
      still = document.createElement("canvas");
      still.width = canvas.width; still.height = canvas.height;
      paint(Infinity);
      still.getContext("2d")!.drawImage(canvas, 0, 0);
    };

    const light = () => {
      if (!still) finish();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(still!, 0, 0);
      if (!lamp) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      // A raking light across the stone, only where there is stone.
      const g = ctx.createRadialGradient(lamp[0], lamp[1], 0, lamp[0], lamp[1], 240);
      g.addColorStop(0, pal.light); g.addColorStop(1, "rgba(255, 255, 255, 0)");
      ctx.globalCompositeOperation = "source-atop";
      ctx.fillStyle = g;
      ctx.fillRect(panel.x, panel.y, panel.w, panel.h);
      ctx.globalCompositeOperation = "source-over";
    };

    const tick = (now: number) => {
      const t = now - start;
      if (reduce || t >= end) { still = null; light(); return; }
      paint(t);
      frame = requestAnimationFrame(tick);
    };

    const move = (e: PointerEvent) => {
      if (reduce || e.pointerType === "touch" || !still) return;
      const box = canvas.getBoundingClientRect();
      lamp = [e.clientX - box.left, e.clientY - box.top];
      cancelAnimationFrame(frame); frame = requestAnimationFrame(light);
    };
    const leave = () => { lamp = null; if (still) { cancelAnimationFrame(frame); frame = requestAnimationFrame(light); } };
    const redrawFinished = () => { cancelAnimationFrame(frame); build(); light(); };

    build();
    start = performance.now();
    frame = requestAnimationFrame(tick);
    const host = canvas.parentElement!;
    host.addEventListener("pointermove", move);
    host.addEventListener("pointerleave", leave);
    let observed = false;
    const resize = new ResizeObserver(() => { if (!observed) { observed = true; return; } redrawFinished(); });
    resize.observe(canvas);
    const theme = new MutationObserver(redrawFinished);
    theme.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => {
      cancelAnimationFrame(frame);
      host.removeEventListener("pointermove", move);
      host.removeEventListener("pointerleave", leave);
      resize.disconnect();
      theme.disconnect();
    };
  }, []);

  return <canvas ref={ref} className="mosaic" aria-hidden="true" data-testid="mosaic" />;
}
