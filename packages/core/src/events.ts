// Shapes returned by the hvnt33 server, and their conversion into the flat
// events the query language operates on.
import { domainOf, urlKey, type EngineId } from "./engines";
import type { Row } from "./spl";

/** A case's network: the proxy its traffic goes through ('' for direct), a name for it, and an optional exit lock. */
export interface CaseNetwork {
  route: string; label: string; lock: { country: string; org: string } | null;
  /** Through Tor, on the case's own circuit (`circuit` increases with each new exit). */
  tor?: boolean; circuit?: number;
  /** The route logs in; the password stays on the server's machine. */
  hasCredentials?: boolean;
}
export interface Investigation { id: string; title: string; description: string; createdAt: string; updatedAt?: string; deletedAt?: string; network?: CaseNetwork }

export interface RecordItem {
  id: string; investigationId: string; title: string; kind: string; status: string;
  notes?: string; sourceUrl?: string; sourceLabel?: string; sourceQuote?: string; eventDate?: string; tags?: string;
  filedBy?: string; contentOrigin?: string; intakeId?: string; public?: boolean; fileKey?: string; mime?: string;
  filename?: string; size?: number; sha256?: string; sourceId?: string;
  /** When a person last reviewed it; empty or absent: not yet reviewed. */
  reviewedAt?: string; reviewedBy?: string;
  createdAt: string; updatedAt?: string;
}

export interface Connection {
  id: string; investigationId: string; fromId: string; toId: string; label: string; status: string;
  notes?: string; evidenceId?: string; sourceQuote?: string; public?: boolean; reviewedAt?: string; reviewedBy?: string; createdAt: string;
}

export interface Dossier { investigation: Investigation; records: RecordItem[]; connections: Connection[] }

export interface IntakeSummary {
  id: string; title: string; state: string; createdAt: string; sourceLabel: string; sourceUrl?: string;
  summary: string; records: number; connections: number; questions?: string[]; researcherNote?: string;
  captureMeta?: { via?: string; mode?: string; engine?: string; query?: string; pageTitle?: string } | null;
  archive?: { source: string; snapshotUrl: string; capturedAt: string } | null;
  /** hvnt33's own snapshot of the source page. */
  snapshot?: { id: string; capturedAt: string; method: string } | null;
}

export interface SerpResult { rank: number; title: string; url: string; snippet: string; domain?: string; quality?: "exact" | "display" | "truncated" | "opaque"; link?: string }

export interface SearchRun {
  id: string; investigationId: string; engine: EngineId; query: string; url: string;
  observedAt: string; pageTitle?: string; results: SerpResult[];
}

export interface PageVisit {
  id: string; investigationId: string; url: string; title: string; referrer?: string;
  firstVisitedAt: string; lastVisitedAt: string; visits: number;
  found?: { engine: string; query: string } | null;
  meta?: {
    canonical?: string; author?: string; published?: string; modified?: string; siteName?: string; type?: string;
    lang?: string; description?: string; schemaTypes?: string[]; wordCount?: number; linksExternal?: number;
    topDomains?: { domain: string; count: number }[];
  };
}

export interface ArchiveSnapshot {
  timestamp: string; capturedAt: string; original: string; status: string; mime: string; digest: string; length: number; snapshotUrl: string;
}

/** What the Wayback Machine holds for a URL: one entry per distinct content version. */
export interface ArchiveHistory {
  url: string; source: "wayback"; checkedAt: string; versions: number; first: string; last: string;
  byYear: Record<string, number>; truncated: boolean; snapshots: ArchiveSnapshot[];
}

export interface ArchiveJob {
  id: string; kind: string; investigationId: string; state: "queued" | "running" | "done" | "failed";
  payload: { url: string; intakeId?: string }; result: { snapshotUrl: string; capturedAt: string } | null;
  error: string; attempts: number; createdAt: string; updatedAt: string;
}

/** A page archived by hvnt33 itself: WACZ, text, screenshot and a timestamped manifest. */
export interface OwnSnapshot {
  id: string; investigationId: string; url: string; finalUrl: string; status: number; title: string;
  method: string; capturedAt: string; trigger: "manual" | "watch" | "capture"; watchId?: string; intakeId?: string;
  changed: boolean | null; changeId: string; previousId: string; textLines: number; notes: string[];
  timestamps: { tsa: string; genTime: string }[]; timestampErrors: { tsa: string; error: string }[];
  files: { wacz?: { sha256: string; size: number }; screenshot?: { sha256: string; size: number } | null; manifest?: { sha256: string } };
  resources?: { count: number; domains: string[]; statuses: string[]; mimeTypes: string[]; responseHeaders: string[] };
}

/** A page hvnt33 re-captures on a schedule. */
export interface Watch {
  id: string; investigationId: string; url: string; everyHours: number; active: boolean; nextRunAt: string;
  lastRunAt: string; lastSnapshotId: string; lastChangeAt: string; lastError: string; createdAt: string;
}

/** A difference in a page's text between two consecutive snapshots. */
export interface PageChange {
  id: string; investigationId: string; url: string; title: string; fromSnapshotId: string; toSnapshotId: string;
  fromAt: string; toAt: string; added: number; removed: number; similarity: number;
  addedLines: string[]; removedLines: string[]; seen: boolean; detectedAt: string;
}

export function ownSnapshotEvents(snapshots: OwnSnapshot[]): Row[] {
  return snapshots.map(s => ({
    _time: s.capturedAt,
    sourcetype: "snapshot",
    archive: "hvnt33",
    id: s.id,
    title: s.title,
    url: s.url,
    url_key: urlKey(s.url),
    domain: domainOf(s.url),
    status: s.status,
    method: s.method,
    trigger: s.trigger,
    changed: s.changed === null ? "first" : s.changed,
    timestamps: s.timestamps.length,
    tsa: s.timestamps.map(t => domainOf(t.tsa)),
    bytes: s.files.wacz?.size ?? 0,
    lines: s.textLines,
    resources: s.resources?.count ?? 0,
    resource_domains: s.resources?.domains ?? [],
    http_statuses: s.resources?.statuses ?? [],
    mime_types: s.resources?.mimeTypes ?? [],
    response_headers: s.resources?.responseHeaders ?? [],
  }));
}

export function changeEvents(changes: PageChange[]): Row[] {
  return changes.map(c => ({
    _time: c.toAt,
    sourcetype: "change",
    id: c.id,
    title: c.title,
    url: c.url,
    url_key: urlKey(c.url),
    domain: domainOf(c.url),
    added: c.added,
    removed: c.removed,
    similarity: c.similarity,
    since: c.fromAt,
    seen: c.seen,
    added_text: c.addedLines,
    removed_text: c.removedLines,
  }));
}

export function snapshotEvents(histories: ArchiveHistory[]): Row[] {
  return histories.flatMap(h =>
    h.snapshots.map((s, i) => ({
      _time: s.capturedAt,
      sourcetype: "snapshot",
      archive: "wayback",
      url: h.url,
      url_key: urlKey(h.url),
      domain: domainOf(h.url),
      version: i + 1,
      versions: h.versions,
      snapshot_url: s.snapshotUrl,
      mime: s.mime,
      bytes: s.length,
      digest: s.digest,
    })),
  );
}

export interface SavedSearch {
  id: string; investigationId: string; kind: "web" | "lab"; query: string; engines: string[]; label: string;
  createdAt: string; lastRunAt: string;
}

export function visitEvents(visits: PageVisit[]): Row[] {
  return visits.map(v => ({
    _time: v.lastVisitedAt,
    sourcetype: "visit",
    id: v.id,
    title: v.title,
    url: v.url,
    url_key: urlKey(v.url),
    domain: domainOf(v.url),
    tld: tldOf(v.url),
    visits: v.visits,
    first_visit: v.firstVisitedAt,
    engine: v.found?.engine ?? "",
    query: v.found?.query ?? "",
    author: v.meta?.author ?? "",
    published: v.meta?.published ?? "",
    site: v.meta?.siteName ?? "",
    page_type: v.meta?.schemaTypes?.[0] ?? v.meta?.type ?? "",
    words: v.meta?.wordCount ?? 0,
    links_out: v.meta?.linksExternal ?? 0,
    linked_domains: (v.meta?.topDomains ?? []).map(d => d.domain),
  }));
}

export function serpEvents(runs: SearchRun[]): Row[] {
  return runs.flatMap(run =>
    run.results.map(r => ({
      _time: run.observedAt,
      sourcetype: "serp",
      engine: run.engine,
      query: run.query,
      rank: r.rank,
      title: r.title,
      url: r.url,
      url_key: urlKey(r.url),
      url_quality: r.quality ?? "exact",
      link: r.link ?? r.url,
      domain: r.domain ?? domainOf(r.url),
      tld: r.quality === "opaque" ? "" : tldOf(r.url),
      snippet: r.snippet,
      run: run.id,
    })),
  );
}

export function recordEvents(d: Dossier): Row[] {
  const titles = new Map(d.records.map(r => [r.id, r.title]));
  const records: Row[] = d.records.map(r => ({
    _time: r.createdAt,
    sourcetype: "record",
    id: r.id,
    kind: r.kind,
    status: r.status,
    title: r.title,
    notes: r.notes ?? "",
    quote: r.sourceQuote ?? "",
    tags: r.tags ? r.tags.split(",").map(t => t.trim()).filter(Boolean) : [],
    event_date: r.eventDate ?? "",
    filed_by: r.filedBy ?? "researcher",
    reviewed: !!r.reviewedAt,
    origin: r.contentOrigin ?? "",
    source: r.sourceLabel ?? "",
    url: r.sourceUrl ?? "",
    url_key: r.sourceUrl ? urlKey(r.sourceUrl) : "",
    domain: r.sourceUrl ? domainOf(r.sourceUrl) : "",
  }));
  const connections: Row[] = d.connections.map(c => ({
    _time: c.createdAt,
    sourcetype: "connection",
    id: c.id,
    from: titles.get(c.fromId) ?? c.fromId,
    label: c.label,
    to: titles.get(c.toId) ?? c.toId,
    status: c.status,
    reviewed: !!c.reviewedAt,
    notes: c.notes ?? "",
    quote: c.sourceQuote ?? "",
  }));
  return [...records, ...connections];
}

export function captureEvents(intakes: IntakeSummary[]): Row[] {
  return intakes.map(i => ({
    _time: i.createdAt,
    sourcetype: "capture",
    id: i.id,
    title: i.title,
    state: i.state,
    source: i.sourceLabel,
    url: i.sourceUrl ?? "",
    url_key: i.sourceUrl ? urlKey(i.sourceUrl) : "",
    domain: i.sourceUrl ? domainOf(i.sourceUrl) : "",
    note: i.researcherNote ?? "",
    mode: i.captureMeta?.mode ?? "",
    engine: i.captureMeta?.engine ?? "",
    query: i.captureMeta?.query ?? "",
    summary: i.summary,
    records: i.records,
  }));
}

export function tldOf(raw: string): string {
  const d = domainOf(raw);
  const i = d.lastIndexOf(".");
  return i >= 0 ? d.slice(i + 1) : "";
}

/**
 * Which URLs the case already knows about, by normalized key: captured as
 * evidence, cited by a record, or opened in the browser.
 */
export function urlIndex(d: Dossier | null, intakes: IntakeSummary[], visits: PageVisit[]) {
  const keys = (urls: (string | undefined)[]) => new Set(urls.filter((u): u is string => !!u).map(urlKey));
  return {
    captured: keys(intakes.map(i => i.sourceUrl)),
    inRecords: keys((d?.records ?? []).map(r => r.sourceUrl)),
    visited: keys(visits.map(v => v.url)),
  };
}

/** Newest first — the default order for a raw event listing. */
export function allEvents(
  d: Dossier | null, runs: SearchRun[], intakes: IntakeSummary[], visits: PageVisit[] = [], histories: ArchiveHistory[] = [],
  own: { snapshots: OwnSnapshot[]; changes: PageChange[] } = { snapshots: [], changes: [] },
): Row[] {
  const index = urlIndex(d, intakes, visits);
  const archived = new Map(histories.map(h => [urlKey(h.url), h]));
  // Cross-reference observed results so `captured=false rank<=5` finds unread leads.
  const serp = serpEvents(runs).map((e): Row => {
    const key = String(e.url_key);
    return { ...e, captured: index.captured.has(key), in_records: index.inRecords.has(key), visited: index.visited.has(key) };
  });
  // Pages you opened carry their archive coverage when it has been looked up.
  const visitRows = visitEvents(visits).map((e): Row => {
    const h = archived.get(String(e.url_key));
    return h ? { ...e, wayback_versions: h.versions, first_archived: h.first, last_archived: h.last } : e;
  });
  const events: Row[] = [...serp, ...visitRows, ...snapshotEvents(histories), ...ownSnapshotEvents(own.snapshots), ...changeEvents(own.changes), ...captureEvents(intakes), ...(d ? recordEvents(d) : [])]
    .map((event): Row => ({ index: "hvnt33", ...event }));
  return events.sort((a, b) => String(b._time).localeCompare(String(a._time)) || Number(a.rank ?? 0) - Number(b.rank ?? 0));
}

export const FACET_FIELDS = ["sourcetype", "archive", "engine", "domain", "query", "captured", "visited", "changed", "kind", "status", "state", "page_type", "http_statuses", "mime_types", "response_headers", "tld"];
