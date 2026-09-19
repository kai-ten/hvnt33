// The page as data, docked beside the page itself. On a results page it lists
// the observed results with what the case already knows about each; on any
// other page it shows what the page declares about itself.
import { useEffect, useMemo, useRef, useState } from "react";
import { domainOf, engineById, parseSerpUrl, parseWaybackUrl, urlKey } from "@hvnt33/core/engines";
import type { ArchiveHistory, ArchiveJob, OwnSnapshot, PageChange, PageVisit, SavedSearch, SearchRun, SerpResult, Watch } from "@hvnt33/core/events";
import type { PageInfo } from "../lib/native";

export interface PanelTab {
  label: string;
  url: string;
  title: string;
  loading: boolean;
  lastSerp: { engine: string; query: string } | null;
  results?: SerpResult[];
  challenge?: boolean;
  info?: PageInfo | null;
}

interface Index { captured: Set<string>; inRecords: Set<string>; visited: Set<string> }

/** Archive lookups as the panel sees them: a history, an error, or in flight. */
export type ArchiveEntry = { history?: ArchiveHistory; error?: string; loading?: boolean };

export interface ArchiveProps {
  archiveEntry: (url: string) => ArchiveEntry | undefined;
  onArchiveLookup: (url: string, refresh?: boolean) => void;
  onArchiveNow: (url: string) => void;
  archiveJobs: ArchiveJob[];
  saveConfigured: boolean;
  /** When false, nothing is sent to the Wayback Machine until the researcher asks. */
  autoArchiveLookup: boolean;
}

/** hvnt33's own archive of the case: what the panel shows and can do for a page. */
export interface OwnArchiveProps {
  own: { snapshots: OwnSnapshot[]; watches: Watch[]; changes: PageChange[]; jobs: ArchiveJob[] };
  /** The snapshot the active tab is replaying, if it is a replay page. */
  replayOf: OwnSnapshot | null;
  onSnapshot: (url: string) => void;
  onReplay: (snapshot: OwnSnapshot) => void;
  onEvidence: (snapshot: OwnSnapshot) => void;
  /** Watch every N hours, or stop watching (null). */
  onWatch: (url: string, everyHours: number | null) => void;
}

function date(v: string | undefined): string {
  if (!v) return "";
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? v : d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export function DataPanel(props: ArchiveProps & OwnArchiveProps & {
  tab: PanelTab;
  runs: SearchRun[];
  visits: PageVisit[];
  saved: SavedSearch[];
  index: Index;
  hasCase: boolean;
  onOpen: (url: string, background: boolean) => void;
  onBackToResults: () => void;
  onSaveSearch: (query: string) => void;
  onCapture: (mode: "selection" | "page") => void;
}) {
  const { tab } = props;
  const serp = parseSerpUrl(tab.url);
  return (
    <div className="data-panel">
      {serp ? <ResultsView {...props} serp={serp} /> : <PageView {...props} />}
    </div>
  );
}

function ResultsView(props: Parameters<typeof DataPanel>[0] & { serp: { engine: string; query: string } }) {
  const { tab, runs, index, serp } = props;
  const [selected, setSelected] = useState(0);
  const list = useRef<HTMLDivElement>(null);
  const engine = engineById(serp.engine);

  // Live results from this page, else the latest recorded run of this query.
  const results = useMemo(() => {
    if (tab.results?.length) return tab.results;
    const run = runs.filter(r => r.engine === serp.engine && r.query === serp.query).sort((a, b) => b.observedAt.localeCompare(a.observedAt))[0];
    return run?.results ?? [];
  }, [tab.results, runs, serp.engine, serp.query]);

  // Every engine that returned each URL for this query, with its best rank.
  const otherEngines = useMemo(() => {
    const map = new Map<string, Map<string, number>>();
    for (const r of runs) {
      if (r.query !== serp.query) continue;
      for (const x of r.results) {
        const key = urlKey(x.url);
        const m = map.get(key) ?? new Map<string, number>();
        m.set(r.engine, Math.min(m.get(r.engine) ?? Infinity, x.rank));
        map.set(key, m);
      }
    }
    return map;
  }, [runs, serp.query]);

  useEffect(() => { setSelected(0); }, [tab.url]);
  // Look up the archive history of the selected result after a short pause.
  const selectedUrl = results[selected]?.quality === "opaque" ? "" : results[selected]?.url ?? "";
  const { archiveEntry, onArchiveLookup } = props;
  useEffect(() => {
    if (!selectedUrl || !props.autoArchiveLookup || archiveEntry(selectedUrl)) return;
    const t = setTimeout(() => onArchiveLookup(selectedUrl), 700);
    return () => clearTimeout(t);
  }, [selectedUrl, archiveEntry, onArchiveLookup, props.autoArchiveLookup]);
  useEffect(() => { list.current?.querySelector(".result-row.sel")?.scrollIntoView({ block: "nearest" }); }, [selected]);

  const saved = props.saved.some(s => s.kind === "web" && s.query === serp.query);
  const open = (r: SerpResult, background: boolean) => props.onOpen(r.quality === "truncated" || r.quality === "opaque" ? r.link || r.url : r.url, background);

  return (
    <>
      <div className="dp-head">
        <span className="engine-tag" style={{ color: engine?.color }}>{engine?.name}</span>
        <span className="dp-query">“{serp.query}”</span>
        <span className="grow" />
        <button className="ghost" disabled={!props.hasCase || saved} onClick={() => props.onSaveSearch(serp.query)} title="Keep this query in the case to re-run on every engine later">{saved ? "★ Saved" : "☆ Save"}</button>
      </div>
      <div className="dp-sub">
        {results.length} results{tab.results?.length ? " on this page" : results.length ? " (last recorded)" : ""}
        {!props.hasCase && " · choose an investigation to record them"}
      </div>
      {tab.challenge && <div className="dp-warn">{engine?.name} is rate-limiting this browser or exit IP. Complete its check in the page; results appear when it reloads. Google is optional and is off by default on new installs.</div>}
      <div
        ref={list}
        className="dp-results"
        tabIndex={0}
        onKeyDown={e => {
          if (e.key === "ArrowDown" || e.key === "j") { e.preventDefault(); setSelected(s => Math.min(s + 1, results.length - 1)); }
          if (e.key === "ArrowUp" || e.key === "k") { e.preventDefault(); setSelected(s => Math.max(s - 1, 0)); }
          if (e.key === "Enter" && results[selected]) { e.preventDefault(); open(results[selected], e.metaKey); }
        }}
      >
        {results.map((r, i) => {
          const key = urlKey(r.url);
          const engines = otherEngines.get(key);
          return (
            <div key={r.url} className={`result-row ${i === selected ? "sel" : ""}`} onClick={e => { setSelected(i); open(r, e.metaKey); }} title={`${r.url}\n⏎ open · ⌘⏎ open in background`}>
              <span className="rank-num">{r.rank}</span>
              <div className="result-main">
                <div className="result-title">{r.title}</div>
                <div className="result-meta">
                  <span className="result-domain">{r.domain || domainOf(r.url) || "unknown site"}</span>
                  {r.quality && r.quality !== "exact" && <span className="quality" title="The engine hid the destination; this URL was rebuilt from what it displayed">{r.quality}</span>}
                  {index.captured.has(key) && <span className="flag cap" title="Captured into this case">captured</span>}
                  {index.inRecords.has(key) && <span className="flag rec" title="Cited by a record">cited</span>}
                  {index.visited.has(key) && <span className="flag vis" title="You opened this page">visited</span>}
                </div>
                {r.snippet && <div className="result-snippet">{r.snippet}</div>}
                {i === selected && r.quality !== "opaque" && (props.autoArchiveLookup || props.archiveEntry(r.url)) && <ArchiveLine entry={props.archiveEntry(r.url)} />}
              </div>
              {engines && (
                <span className="engine-dots" title={[...engines].map(([e, rank]) => `${engineById(e)?.name ?? e}: #${rank}`).join("\n")}>
                  {[...engines.keys()].sort().map(e => <i key={e} style={{ background: engineById(e)?.color }} />)}
                </span>
              )}
            </div>
          );
        })}
        {!results.length && <div className="empty">{tab.loading ? "Reading results…" : "No results recognised on this page yet."}</div>}
      </div>
      <div className="dp-foot dim">↑↓ or j/k to move · ⏎ open · ⌘⏎ open in background</div>
    </>
  );
}

function Field({ k, v, mono }: { k: string; v: React.ReactNode; mono?: boolean }) {
  if (v === "" || v === undefined || v === null) return null;
  return <><dt>{k}</dt><dd className={mono ? "mono" : ""}>{v}</dd></>;
}

function PageView(props: Parameters<typeof DataPanel>[0]) {
  const { tab, index, visits } = props;
  const snapshot = parseWaybackUrl(tab.url);
  const info = tab.info;
  const key = urlKey(tab.url);
  const visit = visits.find(v => urlKey(v.url) === key);
  const found = tab.lastSerp;
  const foundRank = useMemo(() => {
    if (!found) return null;
    const run = props.runs.filter(r => r.engine === found.engine && r.query === found.query).sort((a, b) => b.observedAt.localeCompare(a.observedAt))[0];
    return run?.results.find(r => urlKey(r.url) === key)?.rank ?? null;
  }, [found, props.runs, key]);

  if (!tab.url.startsWith("http")) return <div className="empty">Open a page to see its details.</div>;
  return (
    <>
      <div className="dp-head">
        <span className="dp-kind">{info?.schemaTypes[0] || info?.type || "Page"}</span>
        <span className="grow" />
        {found && <button className="ghost" onClick={props.onBackToResults} title="Back to the results this page came from">← Results</button>}
      </div>
      <div className="dp-title">{info?.heading || tab.title}</div>
      <div className="dp-url mono">{tab.url}</div>
      <div className="dp-flags">
        {index.captured.has(key) ? <span className="flag cap">captured</span> : <span className="flag none">not captured</span>}
        {index.inRecords.has(key) && <span className="flag rec">cited by records</span>}
        {visit && <span className="flag vis">{visit.visits} visit{visit.visits === 1 ? "" : "s"} since {date(visit.firstVisitedAt)}</span>}
      </div>
      <div className="dp-actions">
        <button className="action" onClick={() => props.onCapture("page")}>Capture page ⌘⇧P</button>
        <button className="action primary" onClick={() => props.onCapture("selection")}>Capture selection ⌘⇧S</button>
      </div>
      {!info && <div className="empty">{tab.loading ? "Loading…" : "Reading page details…"}</div>}
      {info && (
        <dl className="dp-fields">
          <Field k="Site" v={info.siteName || domainOf(tab.url)} />
          <Field k="Author" v={info.author} />
          <Field k="Published" v={date(info.published)} />
          <Field k="Modified" v={info.modified && info.modified !== info.published ? date(info.modified) : ""} />
          <Field k="Canonical" v={info.canonical && urlKey(info.canonical) !== key ? info.canonical : ""} mono />
          <Field k="Language" v={info.lang} />
          <Field k="Length" v={info.wordCount ? `${info.wordCount.toLocaleString()} words · ${Math.max(1, Math.round(info.wordCount / 230))} min` : ""} />
          <Field k="Found via" v={found ? `${engineById(found.engine)?.name ?? found.engine}: “${found.query}”${foundRank ? ` · #${foundRank}` : ""}` : ""} />
          <Field k="Referrer" v={info.referrer && !parseSerpUrl(info.referrer) ? domainOf(info.referrer) : ""} />
          <Field k="Description" v={info.description} />
        </dl>
      )}
      {props.replayOf && (
        <div className="dp-archive">
          <div className="archive-note">
            This is hvnt33's snapshot captured {new Date(props.replayOf.capturedAt).toLocaleString()}, replayed as archived.{" "}
            <button className="link" onClick={e => props.onOpen(props.replayOf!.url, e.metaKey)}>Open the live page</button>
          </div>
        </div>
      )}
      {!snapshot && <OwnArchiveSection {...props} url={props.replayOf?.url ?? tab.url} />}
      <ArchiveSection {...props} url={snapshot?.original ?? props.replayOf?.url ?? tab.url} snapshot={snapshot} published={info?.published} />
      {info && info.links.domains.length > 0 && (
        <div className="dp-links">
          <div className="dp-section">Links out · {info.links.external} to other sites</div>
          {info.links.domains.map(d => (
            <button key={d.domain} className="facet-value" onClick={e => props.onOpen(`https://${d.domain}/`, e.metaKey)} title={`Open ${d.domain}`}>
              <span className="bar" style={{ width: `${(d.count / info.links.domains[0].count) * 100}%` }} />
              <span className="label">{d.domain}</span>
              <span className="n">{d.count}</span>
            </button>
          ))}
        </div>
      )}
    </>
  );
}

function year(iso: string) { return iso.slice(0, 4); }

/** One line under a selected result: how much of it the Wayback Machine holds. */
function ArchiveLine({ entry }: { entry: ArchiveEntry | undefined }) {
  if (!entry || entry.loading) return <div className="archive-line dim">Checking the Wayback Machine…</div>;
  if (entry.error) return <div className="archive-line dim">Archive: {entry.error}</div>;
  const h = entry.history!;
  if (!h.versions) return <div className="archive-line warn">Not in the Wayback Machine</div>;
  return <div className="archive-line">Wayback: {h.truncated ? `${h.versions.toLocaleString()}+` : h.versions} versions · {year(h.first)}–{year(h.last)}</div>;
}

/** Closest snapshot to a date, for "what did this say when it was published". */
function closest(h: ArchiveHistory, iso: string) {
  const t = Date.parse(iso);
  if (Number.isNaN(t) || !h.snapshots.length) return null;
  return h.snapshots.reduce((best, s) => (Math.abs(Date.parse(s.capturedAt) - t) < Math.abs(Date.parse(best.capturedAt) - t) ? s : best));
}

function ArchiveSection(props: Parameters<typeof DataPanel>[0] & { url: string; snapshot: ReturnType<typeof parseWaybackUrl>; published?: string }) {
  const { url, snapshot } = props;
  const entry = props.archiveEntry(url);
  const h = entry?.history;
  const saves = props.archiveJobs.filter(j => j.kind === "archive.save" && j.payload.url === url);
  const job = saves.find(j => j.state === "queued" || j.state === "running") ?? saves.sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  const years = h ? Object.entries(h.byYear).sort(([a], [b]) => a.localeCompare(b)) : [];
  const peak = Math.max(1, ...years.map(([, n]) => n));
  const atPublish = h && props.published ? closest(h, props.published) : null;
  const busy = job && (job.state === "queued" || job.state === "running");

  return (
    <div className="dp-archive">
      <div className="dp-section">Web archive</div>
      {snapshot && (
        <div className="archive-note">
          This is a Wayback Machine snapshot captured {new Date(snapshot.capturedAt).toLocaleString()}.{" "}
          <button className="link" onClick={e => props.onOpen(snapshot.original, e.metaKey)}>Open the live page</button>
        </div>
      )}
      {!entry && !props.autoArchiveLookup && (
        <button className="action" onClick={() => props.onArchiveLookup(url)} title="Sends this URL to the Internet Archive's index">Check the Wayback Machine</button>
      )}
      {((!entry && props.autoArchiveLookup) || entry?.loading) && <div className="dim small">Checking the Wayback Machine…</div>}
      {entry?.error && (
        <div className="dim small">{entry.error} <button className="link" onClick={() => props.onArchiveLookup(url, true)}>Retry</button></div>
      )}
      {h && !h.versions && <div className="archive-empty">The Wayback Machine has no capture of this page.</div>}
      {h && h.versions > 0 && (
        <>
          <div className="archive-summary">
            <b>{h.truncated ? `${h.versions.toLocaleString()}+` : h.versions.toLocaleString()}</b> versions ·
            first {new Date(h.first).toLocaleDateString()} · last {new Date(h.last).toLocaleDateString()}
          </div>
          <div className="archive-years" title="Distinct versions captured per year">
            {years.map(([y, n]) => <span key={y} style={{ height: `${Math.max(8, (n / peak) * 100)}%` }} title={`${y}: ${n}`} />)}
          </div>
          <div className="archive-axis dim"><span>{years[0]?.[0]}</span><span>{years.at(-1)?.[0]}</span></div>
          {atPublish && (
            <button className="action" onClick={e => props.onOpen(atPublish.snapshotUrl, e.metaKey)} title="The capture closest to the date the page says it was published">
              Version nearest publication ({new Date(atPublish.capturedAt).toLocaleDateString()})
            </button>
          )}
          <ul className="snapshot-list">
            {h.snapshots.slice(-8).reverse().map(s => (
              <li key={s.timestamp}>
                <button className="link" onClick={e => props.onOpen(s.snapshotUrl, e.metaKey)}>{new Date(s.capturedAt).toLocaleString()}</button>
                <span className="dim">{(s.length / 1024).toFixed(1)} KB</span>
              </li>
            ))}
          </ul>
          <div className="dim small">Checked {new Date(h.checkedAt).toLocaleString()} · <button className="link" onClick={() => props.onArchiveLookup(url, true)}>Refresh</button></div>
        </>
      )}
      {!snapshot && (
        <div className="archive-now">
          {job?.state === "done" && job.result && (
            <div className="ok small">Archived {new Date(job.result.capturedAt).toLocaleString()} · <button className="link" onClick={e => props.onOpen(job.result!.snapshotUrl, e.metaKey)}>open snapshot</button></div>
          )}
          {job?.state === "failed" && <div className="warn small">Archive failed: {job.error}</div>}
          <button
            className="action"
            disabled={!props.saveConfigured || !props.hasCase || busy}
            onClick={() => props.onArchiveNow(url)}
            title={props.saveConfigured ? "Ask the Wayback Machine to capture this page now" : "Needs archive.org API keys: add ARCHIVE_ORG_ACCESS_KEY and ARCHIVE_ORG_SECRET_KEY to .env (free from archive.org/account/s3.php)"}
          >
            {busy ? (job!.state === "queued" ? "Archive queued…" : "Archiving…") : "Archive now"}
          </button>
          {!props.saveConfigured && <div className="dim small">Archive now needs free archive.org API keys in <code>.env</code>.</div>}
        </div>
      )}
    </div>
  );
}

const EVERY = [[6, "6 hours"], [24, "day"], [168, "week"]] as const;
const tsaName = (url: string) => ({ "timestamp.digicert.com": "DigiCert", "freetsa.org": "FreeTSA" } as Record<string, string>)[domainOf(url)] ?? domainOf(url);

/**
 * Snapshots hvnt33 took of this page itself: a replayable archive, the text,
 * a screenshot and a manifest timestamped by independent authorities.
 */
function OwnArchiveSection(props: Parameters<typeof DataPanel>[0] & { url: string }) {
  const key = urlKey(props.url);
  const snaps = props.own.snapshots.filter(s => urlKey(s.url) === key);
  const watch = props.own.watches.find(w => urlKey(w.url) === key);
  const changes = props.own.changes.filter(c => urlKey(c.url) === key);
  const job = props.own.jobs.find(j => urlKey(j.payload.url) === key && (j.state === "queued" || j.state === "running"));
  const failed = props.own.jobs.filter(j => urlKey(j.payload.url) === key).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
  const [every, setEvery] = useState(24);

  return (
    <div className="dp-archive own-archive">
      <div className="dp-section">HVNT33 archive{snaps.length ? ` · ${snaps.length} snapshot${snaps.length === 1 ? "" : "s"}` : ""}</div>
      <div className="row-actions">
        <button className="action" disabled={!props.hasCase || !!job} onClick={() => props.onSnapshot(props.url)} title="Archive this page now: a replayable web archive, its text and a screenshot, with a timestamped manifest">
          {job ? (job.state === "queued" ? "Snapshot queued…" : "Snapshotting…") : "Snapshot now"}
        </button>
        {watch ? (
          <button className="action" onClick={() => props.onWatch(props.url, null)} title="Stop re-capturing this page (its snapshots are kept)">Stop watching</button>
        ) : (
          <span className="watch-control">
            <button className="action" disabled={!props.hasCase} onClick={() => props.onWatch(props.url, every)} title="Snapshot this page on a schedule and record what changes">Watch every</button>
            <select value={every} onChange={e => setEvery(Number(e.target.value))} aria-label="How often">
              {EVERY.map(([h, label]) => <option key={h} value={h}>{label}</option>)}
            </select>
          </span>
        )}
      </div>
      {!job && failed?.state === "failed" && (!snaps[0] || failed.updatedAt > snaps[0].capturedAt) && <div className="warn small">Snapshot failed: {failed.error}</div>}
      {watch && (
        <div className="dim small">
          {watch.active ? `Watching every ${watch.everyHours === 168 ? "week" : watch.everyHours === 24 ? "day" : `${watch.everyHours} h`}` : "Watch paused"}
          {watch.active && watch.nextRunAt && ` · next ${new Date(watch.nextRunAt).toLocaleString()}`}
          {watch.lastError && <span className="warn"> · {watch.lastError}</span>}
        </div>
      )}
      {changes.length > 0 && (
        <div className="small">
          <b>{changes.length}</b> change{changes.length === 1 ? "" : "s"} detected
          {changes.some(c => !c.seen) && <span className="flag cap"> new</span>} · latest {new Date(changes[0].toAt).toLocaleDateString()}: +{changes[0].added} −{changes[0].removed} lines
        </div>
      )}
      <ul className="snapshot-list own">
        {snaps.slice(0, 6).map(s => (
          <li key={s.id}>
            <span className="snap-when" title={`${s.method} capture · HTTP ${s.status}${s.notes.length ? "\n" + s.notes.join("\n") : ""}`}>
              {new Date(s.capturedAt).toLocaleString()}
              {s.changed === true && <span className="flag rec">changed</span>}
            </span>
            <span className="tsa-badges">
              {s.timestamps.map(t => <span key={t.tsa} className="tsa ok" title={`Timestamped by ${t.tsa} at ${t.genTime}`}>{tsaName(t.tsa)}</span>)}
              {!s.timestamps.length && <span className="tsa none" title={s.timestampErrors.map(e => `${e.tsa}: ${e.error}`).join("\n")}>no timestamp</span>}
            </span>
            <span className="snap-actions">
              <button className="link" onClick={() => props.onReplay(s)} title="Replay the archived page in a new tab">Replay</button>
              <button className="link" onClick={() => props.onEvidence(s)} title="Save the evidence package (archive, text, screenshot, timestamps, checksums, how to verify) to Downloads">Evidence</button>
            </span>
          </li>
        ))}
        {!snaps.length && !job && <li className="dim small">Not archived by HVNT33 yet.</li>}
      </ul>
    </div>
  );
}
