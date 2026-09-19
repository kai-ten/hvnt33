// Search engines the app can drive. Each engine is an ordinary results page the
// researcher sees; the app only records the results it actually observed there.

export type EngineId = "google" | "duckduckgo" | "bing" | "brave" | "startpage" | "mojeek" | "yandex";

export interface Engine {
  id: EngineId;
  name: string;
  short: string;
  color: string;
  /** The engine's start page, for new tabs. */
  home: string;
  /** Build the results-page URL for a query. */
  url(query: string): string;
  /** Host suffixes whose pages are this engine's result pages. */
  hosts: string[];
  /** Query-string parameter holding the search terms. */
  param: string;
  /** Path prefixes that identify a results page (not the homepage, images, maps…). */
  paths: string[];
}

const q = encodeURIComponent;

export const ENGINES: Engine[] = [
  { id: "google", home: "https://www.google.com/", name: "Google", short: "G", color: "#6ea8fe", url: s => `https://www.google.com/search?q=${q(s)}&hl=en`, hosts: ["google.com"], param: "q", paths: ["/search"] },
  { id: "duckduckgo", home: "https://duckduckgo.com/", name: "DuckDuckGo", short: "D", color: "#f28b54", url: s => `https://duckduckgo.com/?q=${q(s)}&ia=web`, hosts: ["duckduckgo.com"], param: "q", paths: ["/"] },
  { id: "bing", home: "https://www.bing.com/", name: "Bing", short: "B", color: "#4ec9b0", url: s => `https://www.bing.com/search?q=${q(s)}`, hosts: ["bing.com"], param: "q", paths: ["/search"] },
  { id: "brave", home: "https://search.brave.com/", name: "Brave", short: "Br", color: "#fb7a5a", url: s => `https://search.brave.com/search?q=${q(s)}&source=web`, hosts: ["search.brave.com"], param: "q", paths: ["/search"] },
  { id: "startpage", home: "https://www.startpage.com/", name: "Startpage", short: "S", color: "#a78bfa", url: s => `https://www.startpage.com/do/search?q=${q(s)}`, hosts: ["startpage.com"], param: "q", paths: ["/do/search", "/sp/search"] },
  { id: "mojeek", home: "https://www.mojeek.com/", name: "Mojeek", short: "M", color: "#e5c07b", url: s => `https://www.mojeek.com/search?q=${q(s)}`, hosts: ["mojeek.com"], param: "q", paths: ["/search"] },
  { id: "yandex", home: "https://yandex.com/", name: "Yandex", short: "Y", color: "#ef6b73", url: s => `https://yandex.com/search/?text=${q(s)}`, hosts: ["yandex.com", "yandex.ru"], param: "text", paths: ["/search"] },
];

// Google is available, but not selected on a fresh install. It rate-limits
// repeated results-page searches aggressively (especially on VPN and Tor exits),
// and a real browser fingerprint cannot make an IP reputation challenge go
// away. Researchers can opt in with one click when they need its index.
export const DEFAULT_ENGINES: EngineId[] = ["duckduckgo", "bing", "brave"];

export function engineById(id: string): Engine | undefined {
  return ENGINES.find(e => e.id === id);
}

function hostMatches(host: string, suffix: string): boolean {
  return host === suffix || host.endsWith("." + suffix);
}

/** Recognise a search-engine results page and return its engine and query. */
export function parseSerpUrl(raw: string): { engine: EngineId; query: string } | null {
  let u: URL;
  try { u = new URL(raw); } catch { return null; }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  const host = u.hostname.toLowerCase();
  for (const e of ENGINES) {
    if (!e.hosts.some(h => hostMatches(host, h))) continue;
    // DuckDuckGo serves results from "/" and html.duckduckgo.com from "/html".
    const pathOk = e.paths.some(p => (p === "/" ? u.pathname === "/" || u.pathname.startsWith("/html") : u.pathname.startsWith(p)));
    const query = (u.searchParams.get(e.param) ?? "").trim();
    if (pathOk && query) {
      // Skip non-web verticals (images, videos, news tabs, maps).
      const vertical = u.searchParams.get("tbm") || u.searchParams.get("iax") || u.searchParams.get("ia");
      if (e.id === "google" && vertical) return null;
      if (e.id === "duckduckgo" && vertical && vertical !== "web") return null;
      return { engine: e.id, query };
    }
  }
  return null;
}

/** Turn whatever the user typed in the address bar into a URL or a search. */
export function resolveAddress(input: string, fallbackEngine: EngineId = "duckduckgo"): string {
  const text = input.trim();
  if (!text) return "about:blank";
  if (/^https?:\/\//i.test(text)) return text;
  if (/^about:blank$/i.test(text)) return text;
  // Looks like a hostname (with optional path/port) and contains no spaces.
  if (!/\s/.test(text) && /^(localhost|[\w-]+(\.[\w-]+)+)(:\d+)?(\/.*)?$/i.test(text)) return `https://${text}`;
  return engineById(fallbackEngine)!.url(text);
}

/**
 * A Wayback Machine snapshot URL (`web.archive.org/web/<timestamp>/<url>`):
 * the archived page's own URL and when it was captured.
 */
export function parseWaybackUrl(raw: string): { original: string; timestamp: string; capturedAt: string } | null {
  const m = /^https?:\/\/web\.archive\.org\/web\/(\d{4,14})(?:[a-z]{2}_)?\/(https?:\/\/.+)$/i.exec(raw.trim());
  if (!m) return null;
  const t = m[1].padEnd(14, "0");
  const capturedAt = `${t.slice(0, 4)}-${t.slice(4, 6)}-${t.slice(6, 8)}T${t.slice(8, 10)}:${t.slice(10, 12)}:${t.slice(12, 14)}Z`;
  if (Number.isNaN(Date.parse(capturedAt))) return null;
  return { original: m[2], timestamp: m[1], capturedAt };
}

/** Hostname without a leading "www.", used as the result's domain field. */
export function domainOf(raw: string): string {
  try { return new URL(raw).hostname.toLowerCase().replace(/^www\./, ""); } catch { return ""; }
}

/**
 * Normalize a URL for de-duplication: lowercase host, drop "www.", fragments,
 * common tracking parameters and a trailing slash. The original URL is kept
 * separately; this is only a comparison key.
 */
export function urlKey(raw: string): string {
  let u: URL;
  try { u = new URL(raw); } catch { return raw.trim(); }
  u.hash = "";
  u.hostname = u.hostname.toLowerCase().replace(/^www\./, "");
  for (const key of [...u.searchParams.keys()]) {
    if (/^(utm_|fbclid$|gclid$|msclkid$|mc_[ce]id$|ref_src$|srsltid$)/i.test(key)) u.searchParams.delete(key);
  }
  u.searchParams.sort();
  if (u.pathname.length > 1 && u.pathname.endsWith("/")) u.pathname = u.pathname.replace(/\/+$/, "");
  let s = u.toString();
  if (u.pathname === "/" && !u.search) s = s.replace(/\/$/, "");
  return s.replace(/^http:/, "https:");
}

/**
 * True when two URLs are the same engine's results for the same query. Engines
 * rewrite their URLs after load (Google adds `sei`, Brave adds `conversation`),
 * so exact URL comparison is too strict.
 */
export function sameSerp(a: string, b: string): boolean {
  const x = parseSerpUrl(a), y = parseSerpUrl(b);
  return !!x && !!y && x.engine === y.engine && x.query === y.query;
}

/**
 * An hvnt33 replay page (`<server>/replay/<snapshot id>?t=…`) on the given
 * server, or null. Replays are the case's own snapshots, not pages to log.
 */
export function parseReplayUrl(raw: string, serverBase: string | undefined): { snapshotId: string } | null {
  if (!serverBase) return null;
  try {
    const u = new URL(raw), base = new URL(serverBase);
    if (u.origin !== base.origin) return null;
    const m = /^\/replay\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/.exec(u.pathname);
    return m ? { snapshotId: m[1] } : null;
  } catch {
    return null;
  }
}
