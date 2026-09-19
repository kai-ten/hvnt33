// Search Lab: a Splunk-style query surface over everything this case has
// collected — observed search results, captures, records and connections.
import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { engineById } from "@hvnt33/core/engines";
import { FACET_FIELDS, type SavedSearch } from "@hvnt33/core/events";
import { QueryError, facets, histogram, quoteValue, run, type Result, type Row, type Value } from "@hvnt33/core/spl";

const EVENT_STREAM = "search index=hvnt33\n| sort -_time\n| table _time sourcetype title domain engine query url";
const PRESETS: { label: string; query: string; hint: string }[] = [
  { label: "Event stream", query: EVENT_STREAM, hint: "Every collected event in exact reverse chronological order" },
  { label: "Event volume", query: "search index=hvnt33\n| timechart span=15m count by sourcetype", hint: "SPL timechart of collected activity split by source type" },
  { label: "Cross-engine", query: "sourcetype=serp | compare", hint: "Which results each engine agrees on, with ranks side by side" },
  { label: "Top domains", query: "sourcetype=serp | dedup url | top limit=25 domain", hint: "Domains that dominate the unique results" },
  { label: "What changed", query: "sourcetype=serp | changes", hint: "New, dropped and moved results since the previous run of each query" },
  { label: "Search history", query: "sourcetype=serp | stats dc(url) as results, values(engine) as engines, max(_time) as last by query | sort -last", hint: "Every query you ran and what it found" },
  { label: "Unread leads", query: "sourcetype=serp rank<=10 captured=false visited=false | dedup url | table rank engine title domain url", hint: "Top results you have neither opened nor captured" },
  { label: "Pages visited", query: "sourcetype=visit | table _time title site author published page_type visits", hint: "Every page you opened in this case, with what it declares" },
  { label: "Linked domains", query: "sourcetype=visit | stats count by linked_domains | sort -count | head 20", hint: "Sites the pages you read link to most" },
  { label: "Archive coverage", query: "sourcetype=snapshot archive=wayback | stats count as versions, min(_time) as first, max(_time) as last by url | sort -versions", hint: "How much of each page you read the Wayback Machine holds" },
  { label: "Archive timeline", query: "sourcetype=snapshot archive=wayback | sort -_time | table _time domain version versions bytes snapshot_url", hint: "Every archived version of the pages in this case, newest first" },
  { label: "My snapshots", query: "sourcetype=snapshot archive=hvnt33 | table _time domain title changed timestamps tsa trigger method", hint: "Pages hvnt33 archived itself, with their trusted timestamps" },
  { label: "HTTP surface", query: "sourcetype=snapshot archive=hvnt33 resources>0 | table _time domain status resources resource_domains http_statuses mime_types response_headers", hint: "Indexed network surface from captured pages; raw responses remain in the WACZ" },
  { label: "Page changes", query: "sourcetype=change | table _time domain title added removed similarity seen", hint: "What changed on watched pages between snapshots" },
  { label: "Most-changed pages", query: "sourcetype=change | stats count as changes, sum(added) as added, sum(removed) as removed, max(_time) as last by url | sort -changes", hint: "Which watched pages change most" },
  { label: "Captures", query: "sourcetype=capture | table _time state title domain note", hint: "Everything you sent to the investigation" },
  { label: "Open claims", query: "sourcetype=record kind=Claim status!=Verified | table _time status title source", hint: "Claims that still need verification" },
  { label: "Connections", query: "sourcetype=connection | table from label to status", hint: "The relationship graph as rows" },
];
const HISTORY_KEY = "hvnt33.lab.last";
const TIME_RANGE_KEY = "hvnt33.lab.time-range";
type TimeRange = "all" | "24h" | "7d" | "30d" | "custom";
const TIME_RANGES: { value: TimeRange; label: string }[] = [
  { value: "all", label: "All time" },
  { value: "24h", label: "Last 24 hours" },
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
  { value: "custom", label: "Custom…" },
];

function localDateTime(date: Date): string {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function display(v: Value): string {
  if (v === null || v === undefined) return "";
  if (Array.isArray(v)) return v.join(", ");
  return String(v);
}

function timeLabel(v: Value): string {
  const d = new Date(String(v));
  if (Number.isNaN(d.getTime())) return display(v);
  // The year matters for archive history; omit it only for this year's events.
  const thisYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleString(undefined, { year: thisYear ? undefined : "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function SearchLab(props: {
  events: Row[];
  loading: boolean;
  onOpen: (url: string) => void;
  onPreview: (url: string) => void;
  previewUrl: string | null;
  previewRef: (el: HTMLDivElement | null) => void;
  onClosePreview: () => void;
  saved: SavedSearch[];
  onSave: (query: string) => void;
  onDeleteSaved: (id: string) => void;
}) {
  const { events, loading, saved } = props;
  const [query, setQuery] = useState(() => localStorage.getItem(HISTORY_KEY) ?? EVENT_STREAM);
  const [expanded, setExpanded] = useState(true);
  const [selectedRow, setSelectedRow] = useState<number | null>(null);
  const [submitted, setSubmitted] = useState(query);
  const [timeRange, setTimeRange] = useState<TimeRange>(() => {
    const stored = localStorage.getItem(TIME_RANGE_KEY);
    return stored === "24h" || stored === "7d" || stored === "30d" || stored === "custom" ? stored : "all";
  });
  const [customFrom, setCustomFrom] = useState(() => localDateTime(new Date(Date.now() - 7 * 86_400_000)));
  const [customTo, setCustomTo] = useState(() => localDateTime(new Date()));
  const deferred = useDeferredValue(submitted);
  const input = useRef<HTMLTextAreaElement>(null);
  const timeMenu = useRef<HTMLDetailsElement>(null);

  useEffect(() => { localStorage.setItem(HISTORY_KEY, submitted); }, [submitted]);
  useEffect(() => { localStorage.setItem(TIME_RANGE_KEY, timeRange); }, [timeRange]);
  useEffect(() => { setSelectedRow(null); }, [deferred]);
  useEffect(() => { input.current?.focus(); }, []);

  const rangedEvents = useMemo(() => {
    if (timeRange === "all") return events;
    const now = Date.now();
    const earliest = timeRange === "custom"
      ? Date.parse(customFrom)
      : now - ({ "24h": 1, "7d": 7, "30d": 30 }[timeRange] * 86_400_000);
    const latest = timeRange === "custom" ? Date.parse(customTo) : now;
    return events.filter(event => {
      const time = Date.parse(String(event._time ?? ""));
      return Number.isFinite(time)
        && (!Number.isFinite(earliest) || time >= earliest)
        && (!Number.isFinite(latest) || time <= latest);
    });
  }, [events, timeRange, customFrom, customTo]);

  const outcome = useMemo((): { result: Result | null; error: string; ms: number } => {
    const t = performance.now();
    try {
      return { result: run(deferred, rangedEvents), error: "", ms: performance.now() - t };
    } catch (e) {
      return { result: null, error: e instanceof QueryError ? e.message : String(e), ms: 0 };
    }
  }, [deferred, rangedEvents]);

  // Facets and the histogram describe the events the search clause matched,
  // before any transforming command.
  const base = useMemo(() => {
    const head = deferred.split("|")[0];
    try { return run(head, rangedEvents).rows; } catch { return []; }
  }, [deferred, rangedEvents]);
  const facetList = useMemo(() => facets(base, FACET_FIELDS, 6), [base]);
  const validTimes = base.map(r => Date.parse(String(r._time ?? ""))).filter(Number.isFinite);
  const bucketCount = Math.min(48, Math.max(12, new Set(validTimes).size * 2));
  const buckets = useMemo(() => histogram(base, bucketCount), [base, bucketCount]);
  const peak = Math.max(1, ...buckets.map(b => b.count));

  const submit = (q = query) => { setQuery(q); setSubmitted(q); };
  const formatQuery = () => setQuery(q => q.split("|").map((part, i) => `${i ? "| " : ""}${part.trim()}`).filter(Boolean).join("\n"));
  const addFilter = (field: string, value: string, negate = false) => {
    const [head, ...rest] = query.split("|");
    const clause = `${field}${negate ? "!=" : "="}${quoteValue(value)}`;
    const next = [`${head.trim()} ${clause}`.trim(), ...rest.map(s => s.trim())].join(" | ");
    submit(next);
  };

  const result = outcome.result;
  const columns = result?.columns.length ? result.columns : ["_time", "sourcetype", "title", "domain"];
  const rows = result?.rows.slice(0, 1000) ?? [];
  const selected = selectedRow === null ? null : rows[selectedRow] ?? null;
  const times = validTimes;
  const range = times.length ? { first: new Date(Math.min(...times)), last: new Date(Math.max(...times)) } : null;
  const rangeMs = range ? range.last.getTime() - range.first.getTime() : 0;
  const timeTicks = range ? (rangeMs === 0 ? [range.first] : Array.from({ length: 5 }, (_, i) => new Date(range.first.getTime() + (rangeMs * i) / 4))) : [];
  const tickLabel = (t: Date) => rangeMs < 86_400_000
    ? t.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", second: "2-digit" })
    : rangeMs < 31_536_000_000
      ? t.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
      : t.toLocaleDateString(undefined, { month: "short", year: "numeric" });
  const metrics = useMemo(() => ({
    events: base.length,
    domains: new Set(base.map(r => String(r.domain ?? "")).filter(Boolean)).size,
    types: new Set(base.map(r => String(r.sourcetype ?? "")).filter(Boolean)).size,
    searches: new Set(base.filter(r => r.sourcetype === "serp").map(r => String(r.run ?? "")).filter(Boolean)).size,
    evidence: base.filter(r => ["capture", "record", "connection", "snapshot"].includes(String(r.sourcetype))).length,
  }), [base]);

  return (
    <div className="lab">
      <div className="lab-query">
        <div className="spl-editor">
          <div className="spl-editor-head">
            <details className="time-menu" ref={timeMenu} onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget)) e.currentTarget.removeAttribute("open"); }}>
              <summary aria-label="Search time range">{TIME_RANGES.find(option => option.value === timeRange)?.label}</summary>
              <div className="time-menu-options" role="menu">
                {TIME_RANGES.map(option => (
                  <button
                    key={option.value}
                    role="menuitemradio"
                    aria-checked={timeRange === option.value}
                    className={timeRange === option.value ? "selected" : ""}
                    onClick={() => { setTimeRange(option.value); timeMenu.current?.removeAttribute("open"); }}
                  >
                    <span>{timeRange === option.value ? "✓" : ""}</span>{option.label}
                  </button>
                ))}
              </div>
            </details>
          </div>
          {timeRange === "custom" && (
            <div className="spl-time-custom">
              <label><span>From</span><input type="datetime-local" value={customFrom} max={customTo || undefined} onChange={e => setCustomFrom(e.target.value)} /></label>
              <label><span>To</span><input type="datetime-local" value={customTo} min={customFrom || undefined} onChange={e => setCustomTo(e.target.value)} /></label>
            </div>
          )}
          <div className="spl-editor-body">
            <span className="prompt">›</span>
            <textarea
              ref={input}
              value={query}
              spellCheck={false}
              rows={expanded ? 6 : 2}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submit(); }
                if (e.key === "Tab") {
                  e.preventDefault();
                  const el = e.currentTarget, start = el.selectionStart, end = el.selectionEnd;
                  setQuery(query.slice(0, start) + "  " + query.slice(end));
                  requestAnimationFrame(() => { el.selectionStart = el.selectionEnd = start + 2; });
                }
              }}
              placeholder={'search index=hvnt33 sourcetype=serp\n| stats count by domain\n| sort -count'}
              aria-label="SPL query"
            />
          </div>
        </div>
        <div className="lab-query-actions">
          <button className="primary" onClick={() => submit()}>Run search</button>
          <button className="ghost" onClick={formatQuery}>Format</button>
          <button className="ghost" onClick={() => setExpanded(v => !v)}>{expanded ? "Collapse" : "Multiline"}</button>
          <button className="ghost save-query" onClick={() => props.onSave(query)} title="Save this query to the case">{saved.some(s => s.query === query) ? "★ Saved" : "☆ Save"}</button>
        </div>
      </div>
      <div className="presets">
        {PRESETS.map(p => <button key={p.label} className={submitted === p.query ? "chip on" : "chip"} title={p.hint} onClick={() => submit(p.query)}>{p.label}</button>)}
        {saved.map(s => (
          <span key={s.id} className="chip saved" title={s.query}>
            <button onClick={() => submit(s.query)}>★ {s.label || (s.query.length > 34 ? s.query.slice(0, 33) + "…" : s.query)}</button>
            <button className="chip-x" onClick={() => props.onDeleteSaved(s.id)} aria-label="Delete saved query">×</button>
          </span>
        ))}
      </div>
      {outcome.error && <div className="lab-error">{outcome.error}</div>}
      <div className={`lab-body ${props.previewUrl ? "with-preview" : ""}`}>
        <aside className="facets">
          <div className="facet-count"><b>{base.length.toLocaleString()}</b> events{loading && <span className="spinner" />}</div>
          {facetList.map(f => (
            <div className="facet" key={f.field}>
              <div className="facet-name">{f.field}<span>{f.distinct}</span></div>
              {f.values.map(v => (
                <button key={v.value} className="facet-value" onClick={e => addFilter(f.field, v.value, e.altKey)} title={`Click to filter · ⌥-click to exclude`}>
                  <span className="bar" style={{ width: `${(v.count / base.length) * 100}%` }} />
                  <span className="label">{f.field === "engine" ? engineById(v.value)?.name ?? v.value : v.value}</span>
                  <span className="n">{v.count}</span>
                </button>
              ))}
            </div>
          ))}
        </aside>
        <section className="results">
          <div className="lab-metrics">
            <div><b>{metrics.events.toLocaleString()}</b><span>matched events</span></div>
            <div><b>{metrics.domains.toLocaleString()}</b><span>domains</span></div>
            <div><b>{metrics.types.toLocaleString()}</b><span>source types</span></div>
            <div><b>{metrics.searches.toLocaleString()}</b><span>search runs</span></div>
            <div><b>{metrics.evidence.toLocaleString()}</b><span>evidence events</span></div>
          </div>
          {buckets.length > 0 && (
            <div className="timechart">
              <div className="timechart-head"><b>Events over time</b><span>{base.length.toLocaleString()} events · peak {peak.toLocaleString()} per bucket · {buckets.length} buckets</span></div>
              <div className="histogram-frame">
                <div className="y-axis"><span>{peak}</span><span>{Math.ceil(peak / 2)}</span><span>0</span></div>
                <div className={`histogram ${buckets.length === 1 ? "single" : ""}`} aria-label="Events over time">
                  {buckets.map((b, i) => <span key={i} style={{ height: `${Math.max(b.count ? 8 : 0, (b.count / peak) * 100)}%` }} title={`${new Date(b.start).toLocaleString()} — ${b.count} event${b.count === 1 ? "" : "s"}`} />)}
                </div>
              </div>
              {range && <div className={`time-axis ${timeTicks.length === 1 ? "single" : ""}`}>{timeTicks.map((t, i) => <time key={i} dateTime={t.toISOString()}>{tickLabel(t)}</time>)}</div>}
            </div>
          )}
          <div className="result-meta">
            {result ? <>{result.rows.length.toLocaleString()} {result.transformed ? "rows" : "events"} · {outcome.ms.toFixed(1)} ms</> : "—"}
            {rows.length < (result?.rows.length ?? 0) && <> · showing first {rows.length}</>}
          </div>
          {selected && (
            <div className="event-inspector">
              <div className="event-inspector-head"><b>Event fields</b><span>{Object.keys(selected).length} fields</span><button onClick={() => setSelectedRow(null)} aria-label="Close event fields">×</button></div>
              <dl>{Object.entries(selected).map(([k, v]) => <div key={k}><dt>{k}</dt><dd title={display(v)}>{k === "_time" ? timeLabel(v) : display(v)}</dd></div>)}</dl>
            </div>
          )}
          <div className="table-wrap">
            <table>
              <thead><tr>{columns.map(c => <th key={c}>{c}</th>)}</tr></thead>
              <tbody>
                {rows.map((r, i) => {
                  const target = rowUrl(r);
                  return (
                    <tr key={i} className={selectedRow === i ? "sel" : ""} onClick={() => { setSelectedRow(i); if (target) props.onPreview(target); }}>
                      {columns.map(c => <td key={c} className={`c-${c.replace(/[^a-z_]/gi, "")}`}>{cell(c, r, addFilter)}</td>)}
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {!rows.length && !outcome.error && (
              <div className="empty">
                {events.length ? (rangedEvents.length ? "No matching events." : "No events in this time range.") : "Nothing collected yet. Run a search across engines (⌘K) — the results each engine shows are recorded here automatically."}
              </div>
            )}
          </div>
        </section>
        {props.previewUrl && (
          <section className="preview">
            <div className="preview-head">
              <span className="mono dim">{props.previewUrl}</span>
              <span className="grow" />
              <button className="ghost" onClick={() => props.onOpen(props.previewUrl!)} title="Open in the browser view">Open ↗</button>
              <button className="x" onClick={props.onClosePreview} aria-label="Close preview">×</button>
            </div>
            <div ref={props.previewRef} className="preview-page" />
          </section>
        )}
      </div>
    </div>
  );
}

/** The page a row points at: the result's own URL, or the engine's redirect when the destination is hidden. */
function rowUrl(row: Row): string {
  if (row.sourcetype === "snapshot" && typeof row.snapshot_url === "string") return row.snapshot_url;
  const hidden = row.url_quality === "truncated" || row.url_quality === "opaque";
  const v = hidden ? row.link || row.url : row.url;
  return typeof v === "string" && /^https?:/.test(v) ? v : "";
}

function cell(column: string, row: Row, addFilter: (f: string, v: string) => void) {
  const v = row[column];
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/.test(v)) return <span className="mono dim" title={v}>{timeLabel(v)}</span>;
  if (column === "_time" || column === "last" || column === "first_seen" || column === "last_seen" || column === "first_visit" || column === "latest_run" || column === "previous_run") return <span className="mono dim" title={display(v)}>{timeLabel(v)}</span>;
  if (typeof v === "boolean") return <span className={v ? "yes" : "dim"}>{v ? "yes" : "no"}</span>;
  if (column === "snapshot_url" && v) return <span className="link">{display(v).replace(/^https:\/\/web\.archive\.org\/web\//, "")}</span>;
  if (column === "url" && v) {
    const q = String(row.url_quality ?? "exact");
    return <span className="link" title={q === "exact" ? "Open in browser" : `URL ${q === "display" ? "rebuilt from the address the engine displayed" : q === "truncated" ? "shortened by the engine; opens via its redirect" : "hidden by the engine; opens via its redirect"}`}>{display(v)}{q !== "exact" && q !== "display" && <span className="quality">{q}</span>}</span>;
  }
  if (column === "title" && row.url) {
    return (
      <div className="title-cell">
        <span className="link strong">{display(v)}</span>
        {row.snippet ? <div className="snippet">{display(row.snippet)}</div> : null}
      </div>
    );
  }
  if (column === "change") return <span className={`change ${display(v)}`}>{display(v)}</span>;
  if (column === "engine" || column === "sourcetype" || column === "domain" || column === "kind" || column === "status" || column === "state") {
    return v ? <button className="pill-btn" onClick={e => { e.stopPropagation(); addFilter(column, display(v)); }}>{column === "engine" ? engineById(display(v))?.name ?? display(v) : display(v)}</button> : null;
  }
  if (engineById(column)) return v === undefined ? <span className="dim">—</span> : <span className={`rank r${Math.min(Number(v), 11)}`}>{display(v)}</span>;
  if (column === "engines" && Array.isArray(v)) return <span className="engine-dots">{v.map(e => <i key={e} style={{ background: engineById(e)?.color }} title={engineById(e)?.name ?? e} />)}</span>;
  return display(v);
}
