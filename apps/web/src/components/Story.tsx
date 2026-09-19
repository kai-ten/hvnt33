"use client";
import { useEffect, useRef } from "react";
import { Tessera } from "./Ornaments";

// "How a secret comes together": a second mosaic that re-lays itself as the
// reader scrolls, like a film made of tiles. Scattered documents are collected;
// they are archived and sealed with a timestamp; they become records joined by
// lines; the hidden link turns red. Only tiles whose color changes turn over,
// in a sweep, so each scene is laid over the last. The section is held in
// place while the reader scrolls (mosaic left and steps right on wide screens,
// mosaic above the steps on phones); the step whose scene is on show is in
// full ink. With reduced motion the last scene is drawn once.

type P = [number, number];
type Ink = "field" | "ink" | "red" | "gold" | "paper" | "sand" | "faded";

const steps = [
  { title: "Collect", text: "Every search result, quote and page you touch is saved with where it came from: engine, rank, URL, time." },
  { title: "Keep", text: "Pages are archived and timestamped by two independent authorities, so they still exist after they are deleted." },
  { title: "Connect", text: "The agent files people, companies and events, and links them with the quote that proves each link." },
];

const palettes = {
  light: {
    grout: "#d3c5a7", field: ["#f2e9d8", "#ede3cd", "#e8ddc5", "#f4ede0"], ink: ["#2a2521", "#231f1b", "#342d27"],
    red: ["#a3261a", "#942119", "#b0311f"], gold: ["#b98a3e", "#c49645", "#a97b34"], paper: ["#fbf7ec", "#f6efdf", "#fdfaf2"],
    sand: ["#dcbb82", "#d4b074", "#e0c28f"], faded: ["#cdbf9f", "#c8b999", "#d2c5a8"], band: ["#e4d6b9", "#dfd0b1"],
  },
  dark: {
    grout: "#0c0a09", field: ["#2e2923", "#29241f", "#332d26", "#2b2621"], ink: ["#ddd0b3", "#d4c6a8", "#e3d8bf"],
    red: ["#e2664f", "#d4583f", "#ea7760"], gold: ["#c99a4c", "#d4a758", "#b98a3e"], paper: ["#4a4238", "#443d33", "#50473c"],
    sand: ["#6e5a3c", "#655236", "#735f40"], faded: ["#4a4238", "#453d34", "#4f463b"], band: ["#24201b", "#27221d"],
  },
};

// The scenes are drawn with plain canvas shapes at one pixel per tile, in
// these key colors, then read back tile by tile.
const KEY: Record<Ink, [number, number, number]> = { field: [255, 255, 255], ink: [0, 0, 0], red: [255, 0, 0], gold: [128, 64, 0], paper: [0, 0, 255], sand: [0, 200, 0], faded: [170, 90, 255] };
const css = (k: Ink) => `rgb(${KEY[k].join(",")})`;
const nearest = (r: number, g: number, b: number): Ink => {
  // Soft edges between black and cream are grey: they belong to one or the
  // other, never to a colored tile.
  if (Math.max(r, g, b) - Math.min(r, g, b) < 60) return r + g + b > 382 ? "field" : "ink";
  let best: Ink = "field", d = Infinity;
  for (const k of Object.keys(KEY) as Ink[]) { const [R, G, B] = KEY[k]; const e = (R - r) ** 2 + (G - g) ** 2 + (B - b) ** 2; if (e < d) { d = e; best = k; } }
  return best;
};

// The fictional Meridian Bay case: where its six records end up.
const nodes: Record<string, P> = { voss: [0.22, 0.16], reyes: [0.78, 0.16], contract: [0.5, 0.4], port: [0.17, 0.64], calder: [0.83, 0.64], founder: [0.5, 0.86] };
const edges: [string, string, boolean][] = [["voss", "contract", false], ["reyes", "contract", false], ["port", "contract", false], ["calder", "contract", false], ["founder", "port", true], ["founder", "calder", true]];
// Where the six documents lie before they are collected: [x, y, angle].
const scatter: [number, number, number][] = [[0.2, 0.22, -0.28], [0.74, 0.16, 0.2], [0.47, 0.44, -0.1], [0.16, 0.7, 0.22], [0.8, 0.66, -0.18], [0.52, 0.82, 0.12]];

function drawScene(g: CanvasRenderingContext2D, n: number, W: number, H: number) {
  const X = (u: number) => u * W, Y = (v: number) => v * H, S = Math.min(W, H);
  g.fillStyle = css("field"); g.fillRect(0, 0, W, H);
  const doc = (x: number, y: number, a: number, w: number, h: number, header: Ink) => {
    g.save(); g.translate(x, y); g.rotate(a);
    g.fillStyle = css("ink"); g.fillRect(-w / 2 - 1, -h / 2 - 1, w + 2, h + 2);
    g.fillStyle = css("paper"); g.fillRect(-w / 2, -h / 2, w, h);
    g.fillStyle = css(header); g.fillRect(-w / 2, -h / 2, w, Math.max(1.5, h * 0.2));
    g.fillStyle = css("ink");
    for (let l = 0; l < 3; l++) g.fillRect(-w / 2 + 1.5, -h / 2 + h * 0.36 + l * h * 0.2, w * (l === 2 ? 0.45 : 0.72), 1);
    g.restore();
  };
  if (n === 0) {
    scatter.forEach(([u, v, a], i) => doc(X(u), Y(v), a, S * 0.2, S * 0.15, i % 3 === 0 ? "red" : i % 3 === 1 ? "gold" : "sand"));
    return;
  }
  if (n === 1) {
    // Two neat stacks in the archive, a red seal on top, and the timestamp.
    for (const [cx, count] of [[0.3, 3], [0.55, 3]] as const) {
      for (let i = 0; i < count; i++) doc(X(cx) + i * 1.2, Y(0.62) - i * S * 0.1, 0, S * 0.24, S * 0.17, i === count - 1 ? "red" : "sand");
    }
    g.fillStyle = css("red"); g.beginPath(); g.arc(X(0.55) + 4, Y(0.62) - S * 0.2 + 3, S * 0.07, 0, Math.PI * 2); g.fill();
    const [cx, cy, r] = [X(0.8), Y(0.36), S * 0.14];
    g.fillStyle = css("gold"); g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fill();
    g.fillStyle = css("paper"); g.beginPath(); g.arc(cx, cy, r - 2, 0, Math.PI * 2); g.fill();
    g.strokeStyle = css("ink"); g.lineWidth = 1.2; g.lineCap = "square";
    g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx, cy - r * 0.7); g.moveTo(cx, cy); g.lineTo(cx + r * 0.5, cy + r * 0.2); g.stroke();
    return;
  }
  // Records and the links between them, each record a medallion with its
  // emblem: busts for people, an anchor for the port, columns for the firm, a
  // sealed document for the contract. Every link carries a gold tile for the
  // quote that proves it. In the last scene everything else sinks into the
  // stone and the founder, the port and the firm are laid in red and gold.
  const reveal = n === 3;
  const secretNode = (k: string) => k === "founder" || k === "port" || k === "calder";
  const at = (k: string): P => [X(nodes[k][0]), Y(nodes[k][1])];
  const r = Math.max(5.5, S * 0.125);
  g.lineCap = "round"; g.lineJoin = "round";
  edges.forEach(([a, b, secret]) => {
    const lit = reveal && secret;
    g.strokeStyle = css(lit ? "red" : reveal ? "faded" : "ink"); g.lineWidth = lit ? 2.4 : 1.2;
    g.beginPath(); g.moveTo(...at(a)); g.lineTo(...at(b)); g.stroke();
  });
  // The quote on each link, where the eye crosses it: a small gold lozenge.
  edges.forEach(([a, b, secret]) => {
    const [[ax, ay], [bx, by]] = [at(a), at(b)];
    const [mx, my] = [(ax + bx) / 2, (ay + by) / 2], q = Math.max(1.6, S * 0.035);
    g.fillStyle = css(reveal && !secret ? "faded" : "gold");
    g.beginPath(); g.moveTo(mx, my - q); g.lineTo(mx + q, my); g.lineTo(mx, my + q); g.lineTo(mx - q, my); g.closePath(); g.fill();
  });
  Object.keys(nodes).forEach(k => {
    const [x, y] = at(k);
    const lit = reveal && secretNode(k), faded = reveal && !lit;
    const line: Ink = lit ? "red" : faded ? "faded" : "ink";
    if (lit) { g.fillStyle = css("gold"); g.beginPath(); g.arc(x, y, r + 1.6, 0, Math.PI * 2); g.fill(); }
    g.fillStyle = css(line); g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    g.fillStyle = css(faded ? "field" : "paper"); g.beginPath(); g.arc(x, y, r - 1.1, 0, Math.PI * 2); g.fill();
    emblem(g, k, x, y, r - 1.6, lit && k === "founder" ? "red" : line, faded);
  });
}

// The emblem inside a record's medallion, drawn in a box of half-size s.
function emblem(g: CanvasRenderingContext2D, k: string, x: number, y: number, s: number, ink: Ink, faded: boolean) {
  g.fillStyle = css(ink); g.strokeStyle = css(ink); g.lineWidth = Math.max(1, s * 0.18);
  if (k === "voss" || k === "reyes" || k === "founder") {
    // A bust: head and shoulders.
    g.beginPath(); g.arc(x, y - s * 0.28, s * 0.4, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.ellipse(x, y + s * 0.78, s * 0.72, s * 0.62, 0, Math.PI, 0); g.fill();
  } else if (k === "port") {
    // An anchor: ring, shank, stock and flukes.
    g.beginPath(); g.arc(x, y - s * 0.62, s * 0.2, 0, Math.PI * 2); g.stroke();
    g.beginPath(); g.moveTo(x, y - s * 0.42); g.lineTo(x, y + s * 0.72); g.stroke();
    g.beginPath(); g.moveTo(x - s * 0.42, y - s * 0.24); g.lineTo(x + s * 0.42, y - s * 0.24); g.stroke();
    g.beginPath(); g.arc(x, y + s * 0.1, s * 0.66, Math.PI * 0.15, Math.PI * 0.85); g.stroke();
  } else if (k === "calder") {
    // A building of columns under a pediment.
    g.beginPath(); g.moveTo(x - s * 0.8, y - s * 0.3); g.lineTo(x, y - s * 0.82); g.lineTo(x + s * 0.8, y - s * 0.3); g.closePath(); g.fill();
    for (const cx of [-0.52, 0, 0.52]) g.fillRect(x + cx * s - s * 0.12, y - s * 0.22, s * 0.24, s * 0.72);
    g.fillRect(x - s * 0.8, y + s * 0.52, s * 1.6, s * 0.22);
  } else {
    // The contract: a document with lines and a red seal.
    g.fillRect(x - s * 0.55, y - s * 0.72, s * 1.1, s * 0.14);
    for (const ly of [-0.36, -0.06, 0.24]) g.fillRect(x - s * 0.55, y + ly * s, s * (ly === 0.24 ? 0.55 : 1.1), s * 0.12);
    g.fillStyle = css(faded ? "faded" : "red"); g.beginPath(); g.arc(x + s * 0.38, y + s * 0.55, s * 0.3, 0, Math.PI * 2); g.fill();
  }
}

const rng = (seed: number) => () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
const clamp = (x: number) => Math.min(1, Math.max(0, x));

export function Story() {
  const section = useRef<HTMLElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const root = section.current, canvas = canvasRef.current, ctx = canvas?.getContext("2d");
    if (!root || !canvas || !ctx) return;
    const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
    root.toggleAttribute("data-still", still);
    root.toggleAttribute("data-live", !still);
    const blocks = [...root.querySelectorAll<HTMLElement>(".step")];
    let frame = 0, dpr = 1, W = 0, H = 0, cols = 0, rows = 0, cell = 0;
    const border = 3;
    let scenes: Ink[][] = [];
    let seeds: { r: number; k: number[] }[] = [];
    let pal = palettes.light;

    const build = () => {
      const box = canvas.getBoundingClientRect();
      W = box.width; H = box.height; dpr = Math.min(devicePixelRatio || 1, 2);
      canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
      pal = document.documentElement.dataset.theme === "dark" ? palettes.dark : palettes.light;
      cell = W > 700 ? 10 : W > 500 ? 8 : 5;
      cols = Math.floor(W / cell); rows = Math.floor(H / cell);
      const iw = cols - 2 * border, ih = rows - 2 * border;
      const off = document.createElement("canvas");
      off.width = iw; off.height = ih;
      const g = off.getContext("2d", { willReadFrequently: true })!;
      scenes = [0, 1, 2, 3].map(n => {
        g.clearRect(0, 0, iw, ih);
        drawScene(g, n, iw, ih);
        const d = g.getImageData(0, 0, iw, ih).data;
        const out: Ink[] = [];
        for (let i = 0; i < iw * ih; i++) out.push(nearest(d[i * 4], d[i * 4 + 1], d[i * 4 + 2]));
        return out;
      });
      const rand = rng(7);
      seeds = Array.from({ length: cols * rows }, () => ({ r: rand(), k: Array.from({ length: 8 }, () => (rand() - 0.5) * cell * 0.16) }));
    };

    const tile = (x: number, y: number, color: string, sx: number, k: number[]) => {
      const s = (cell - 1.3) / 2, w = s * sx;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(x - w + k[0] * sx, y - s + k[1]); ctx.lineTo(x + w + k[2] * sx, y - s + k[3]);
      ctx.lineTo(x + w + k[4] * sx, y + s + k[5]); ctx.lineTo(x - w + k[6] * sx, y + s + k[7]);
      ctx.closePath(); ctx.fill();
    };

    const shade = (ink: Ink, r: number) => { const list = pal[ink]; return list[Math.floor(r * list.length) % list.length]; };

    const render = (p: number) => {
      // Each scene holds, then the next is laid over it.
      const seg = p * 3, k = Math.min(2, Math.floor(seg)), t = clamp((seg - k - 0.18) / 0.64);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      const ox = (W - cols * cell) / 2, oy = (H - rows * cell) / 2;
      ctx.fillStyle = pal.grout;
      ctx.fillRect(ox, oy, cols * cell, rows * cell);
      const iw = cols - 2 * border;
      for (let j = 0; j < rows; j++) {
        for (let i = 0; i < cols; i++) {
          const seed = seeds[j * cols + i];
          const x = ox + (i + 0.5) * cell, y = oy + (j + 0.5) * cell;
          const d = Math.min(i, j, cols - 1 - i, rows - 1 - j);
          if (d < border) { tile(x, y, d === 0 ? shade("ink", seed.r) : d === 2 ? shade("red", seed.r) : pal.band[seed.r > 0.5 ? 1 : 0], 1, seed.k); continue; }
          const idx = (j - border) * iw + (i - border);
          const from = scenes[k][idx], to = scenes[k + 1][idx];
          if (from === to) { tile(x, y, shade(from, seed.r), 1, seed.k); continue; }
          // The tile turns over: its old face narrows away, its new face opens.
          const start = 0.05 + 0.6 * (seed.r * 0.55 + (i / cols) * 0.45);
          const f = clamp((t - start) / 0.3);
          if (f < 0.5) tile(x, y, shade(from, seed.r), 1 - 2 * f, seed.k);
          else tile(x, y, shade(to, seed.r), 2 * f - 1, seed.k);
        }
      }
      // The words follow what the picture mostly shows: they turn with the
      // middle of the change, when half the changing tiles have turned over.
      const turned = (seg - k - 0.18) / 0.64;
      const scene = turned >= 0.5 ? k + 1 : k;
      root.dataset.scene = String(scene);
      // Three steps, four scenes: the red finale plays while Connect is read.
      blocks.forEach((b, i) => b.toggleAttribute("data-active", i === Math.min(2, scene)));
    };

    // The section is held in place while the reader scrolls through it; how
    // far they have scrolled is how far the film has played.
    const progress = () => {
      if (still) return 1;
      const box = root.getBoundingClientRect();
      return clamp(-box.top / (box.height - innerHeight));
    };

    const onScroll = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(() => render(progress())); };
    const reset = () => { build(); render(progress()); };
    reset();
    addEventListener("scroll", onScroll, { passive: true });
    addEventListener("resize", reset);
    const theme = new MutationObserver(reset);
    theme.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => { removeEventListener("scroll", onScroll); removeEventListener("resize", reset); theme.disconnect(); cancelAnimationFrame(frame); };
  }, []);

  return (
    <section ref={section} className="story" aria-labelledby="story-title">
      <div className="story-hold">
        <div className="wrap story-grid">
          <figure className="story-film">
            <canvas ref={canvasRef} aria-hidden="true" data-testid="story-mosaic" />
          </figure>
          <div className="story-text">
            <h2 id="story-title" className="display text-[clamp(1.7rem,1.2rem+1.8vw,2.9rem)]">How a secret comes together</h2>
            <ol className="steps">
              {steps.map(s => (
                <li key={s.title} className="step">
                  <p><Tessera /><b className="font-sans font-semibold">{s.title}.</b> {s.text}</p>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </div>
    </section>
  );
}
