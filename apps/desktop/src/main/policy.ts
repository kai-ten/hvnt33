// Pure rules the native side enforces: what tabs may load, which API paths the
// app may call, how profiles map to browser sessions, how files are named.
// Kept free of Electron so they are unit-tested directly (tests/policy.test.ts).
import fs from "node:fs";
import path from "node:path";

// ── Browsed tabs ─────────────────────────────────────────────────────────────

/** Browsed tabs may only show web pages: no local files, app pages or custom schemes. */
export function allowedNavigation(raw: string): boolean {
  let u: URL;
  try { u = new URL(raw); } catch { return false; }
  switch (u.protocol) {
    case "http:": case "https:": case "blob:": return true;
    case "about:": return raw === "about:blank" || raw === "about:srcdoc";
    default: return false;
  }
}

export function parseWebUrl(raw: string): string {
  let u: URL;
  try { u = new URL(raw); } catch { throw new Error(`Not a web address: ${raw}`); }
  if (!allowedNavigation(u.href)) throw new Error("Only http(s) pages can be opened in the browser");
  return u.href;
}

/** Tab ids the app webview may name. They can never name the app's own view. */
export function isTabLabel(label: unknown): label is string {
  return typeof label === "string" && label.startsWith("tab-") && label.length > 4 && label.length <= 48 && /^[A-Za-z0-9-]+$/.test(label.slice(4));
}

/** A route for tabs: socks5://host:port or http://host:port, without credentials (logins go through the server's relay). */
export function parseRoute(raw: string): string {
  let u: URL;
  try { u = new URL(raw.trim()); } catch { throw new Error("Invalid route"); }
  const scheme = u.protocol === "socks5:" || u.protocol === "socks5h:" ? "socks5" : u.protocol === "http:" ? "http" : null;
  if (!scheme) throw new Error("Routes are socks5:// or http:// proxies");
  if (u.username || u.password) throw new Error("Proxies with a username and password are not supported yet");
  if (!u.hostname) throw new Error("A route needs a host");
  if (!u.port) throw new Error("A route needs a port");
  return `${scheme}://${u.hostname}:${u.port}`;
}

/**
 * Chromium proxy settings for a route: everything goes through it, loopback
 * addresses included (Chromium would otherwise reach those directly). SOCKS5
 * in Chromium resolves hostnames at the proxy, so DNS goes through the route too.
 */
export const proxyConfig = (route: string) => (route ? { proxyRules: route, proxyBypassRules: "<-loopback>" } : { mode: "direct" as const });

// ── Profiles ─────────────────────────────────────────────────────────────────
//
// Tabs keep cookies, logins and site storage in a browser session (partition).
// "shared" is one profile for cases without their own; a case can have its own,
// named by its id, so logins never cross cases. Each route a case uses (direct,
// Tor, a proxy) has its own session within the case, so cookies cannot link one
// route's identity to another's. The app's own interface uses the default
// session, which browsed pages never touch. End-to-end runs use sessions of
// their own run, never the researcher's.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const E2E_PREFIX = "h33e-";

const fnv = (s: string, seed: bigint) => {
  let h = seed;
  for (const b of Buffer.from(s)) h = BigInt.asUintN(64, (h ^ BigInt(b)) * 0x100000001b3n);
  return h.toString(16).padStart(16, "0");
};

/** The session partition for a profile ("shared" or a case id) browsing through a route key ("" direct, "tor", or a proxy). */
export function partitionFor(profile: string, routeKey = "", e2eRun: string | null = null): string {
  let name: string;
  if (profile === "shared") name = "shared";
  else if (UUID.test(profile)) name = `case-${profile.toLowerCase()}`;
  else throw new Error("Unknown browser profile");
  if (routeKey) name += `-r-${fnv(routeKey, 0xcbf29ce484222325n)}`;
  return `persist:${e2eRun ? `${E2E_PREFIX}${e2eRun}-` : ""}${name}`;
}

export const isE2EPartition = (partition: string) => partition.startsWith(`persist:${E2E_PREFIX}`);

// ── Server bridge ────────────────────────────────────────────────────────────

/** Only `/api/…` paths with ordinary characters; no traversal, no absolute URLs. */
export function validApiPath(p: unknown): p is string {
  return typeof p === "string" && p.startsWith("/api/") && !p.includes("..") && !p.includes("//") && /^[A-Za-z0-9/\-_.?=&%:]+$/.test(p);
}

/** Server features this app needs (reported by `/api/health`). */
export const REQUIRED_FEATURES = ["search-runs", "browser-capture", "page-visits", "saved-searches", "archive", "snapshots", "watches"];

export function hasRequiredFeatures(health: unknown): boolean {
  const features = (health as { features?: unknown })?.features;
  return Array.isArray(features) && REQUIRED_FEATURES.every(f => features.includes(f));
}

/** An http(s) origin; remote servers must use https. */
export function normalizeServerUrl(raw: string): string {
  let u: URL;
  try { u = new URL(raw.trim()); } catch { throw new Error("Enter a full server address, e.g. https://hvnt33.example.org"); }
  if ((u.protocol !== "http:" && u.protocol !== "https:") || !u.hostname) throw new Error("The server address must start with http:// or https://");
  if (u.protocol === "http:" && !isLoopback(u.href)) throw new Error("Remote servers must use https:// so your token and research are encrypted in transit");
  return u.origin;
}

export function isLoopback(url: string): boolean {
  try { return ["127.0.0.1", "localhost", "[::1]"].includes(new URL(url).hostname); } catch { return false; }
}

/** Read `PORT` from a `.env` file's contents. */
export function portFromEnvFile(contents: string): number | null {
  for (const line of contents.split("\n")) {
    const i = line.indexOf("=");
    if (i < 0 || line.slice(0, i).trim() !== "PORT") continue;
    const n = Number(line.slice(i + 1).trim().replace(/^["']|["']$/g, ""));
    return Number.isInteger(n) && n > 0 && n < 65536 ? n : null;
  }
  return null;
}

// ── Files ────────────────────────────────────────────────────────────────────

/** A file name safe to create in Downloads: no paths, no control characters, no hidden files. */
export function safeFileName(name: string): string {
  const cleaned = [...name].map(c => (/[A-Za-z0-9\-_. ()]/.test(c) ? c : "-")).join("").replace(/^[. ]+/, "").trim();
  return cleaned ? [...cleaned].slice(0, 120).join("") : "download";
}

/** `dir/name`, or `name (2)`, `(3)`… so an existing file is never overwritten. */
export function unusedPath(dir: string, name: string, first = 2): string {
  const dot = name.lastIndexOf(".");
  const [stem, ext] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ""];
  let candidate = path.join(dir, name);
  for (let n = first; fs.existsSync(candidate); n++) candidate = path.join(dir, `${stem} (${n})${ext}`);
  return candidate;
}

/** Where a browsed page's download goes: its URL's file name, made safe, never overwriting. */
export function downloadDestination(dir: string, url: string): string {
  let last = "";
  try { last = decodeURIComponent(new URL(url).pathname.split("/").pop() ?? ""); } catch { /* not a URL */ }
  const name = [...last].filter(c => /[A-Za-z0-9\-_.]/.test(c)).join("");
  return unusedPath(dir, name && !name.startsWith(".") ? name : "download", 1);
}

/** Extension for an image media type; anything else is refused. */
export function imageExtension(mime: string): string | null {
  const t = mime.split(";")[0].trim().toLowerCase();
  return ({ "image/png": "png", "image/jpeg": "jpg", "image/jpg": "jpg", "image/gif": "gif", "image/webp": "webp", "image/avif": "avif", "image/svg+xml": "svg" } as Record<string, string>)[t] ?? null;
}

/** A safe attachment file name derived from an image URL. */
export function imageFilename(url: string, ext: string): string {
  let stem = "";
  try {
    const last = new URL(url).pathname.split("/").pop() ?? "";
    stem = (last.includes(".") ? last.slice(0, last.lastIndexOf(".")) : last).replace(/[^A-Za-z0-9\-_]/g, "").slice(0, 80);
  } catch { /* not a URL */ }
  return `${stem || "captured-image"}.${ext}`;
}

// ── Page scripts ─────────────────────────────────────────────────────────────

/** Scripts return `JSON.stringify(...)`; accept either that string or an object, and require an object. */
export function decodeScriptResult(raw: unknown): Record<string, unknown> {
  let value = raw;
  if (typeof value === "string") {
    try { value = JSON.parse(value); } catch { throw new Error("Unreadable page result"); }
    if (typeof value === "string") { try { value = JSON.parse(value); } catch { throw new Error("Unreadable page result"); } }
  }
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  throw new Error("The page could not be read (it may block scripts, or be a PDF or image)");
}

// ── Agent terminal ───────────────────────────────────────────────────────────

/**
 * Session markers from a launching Claude Code session must not leak into the
 * embedded agent, or it behaves as a nested child of the developer's session.
 * User configuration under the same prefixes still travels.
 */
const AGENT_SESSION_MARKERS = new Set(["CLAUDECODE", "CLAUDE_PID", "AI_AGENT", "CLAUDE_CODE_SESSION_ID", "CLAUDE_CODE_CHILD_SESSION", "CLAUDE_CODE_BRIDGE_SESSION_ID", "CLAUDE_CODE_ENTRYPOINT", "CLAUDE_CODE_SSE_PORT", "CLAUDE_CODE_MESSAGING_SOCKET", "CLAUDE_CODE_MESSAGING_TOKEN"]);
export const isAgentSessionMarker = (key: string) => AGENT_SESSION_MARKERS.has(key);

/** Parse `env` output that follows the marker line (the login shell's rc files may print before it). */
export function parseEnv(out: string, marker: string): Record<string, string> {
  const at = out.indexOf(`${marker}\n`);
  if (at < 0) return {};
  const vars: Record<string, string> = {};
  for (const line of out.slice(at + marker.length + 1).split("\n")) {
    const i = line.indexOf("=");
    if (i <= 0) continue;
    const key = line.slice(0, i);
    if (/^[A-Za-z0-9_]+$/.test(key)) vars[key] = line.slice(i + 1);
  }
  return vars;
}
