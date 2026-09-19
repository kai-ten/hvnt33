// The live case next to the browser: what was captured, what the agent filed,
// dated events and the questions extraction left open.
import { useEffect, useMemo, useState } from "react";
import { domainOf, engineById } from "@hvnt33/core/engines";
import type { ArchiveJob, Dossier, IntakeSummary, Investigation, OwnSnapshot, PageChange, RecordItem, SavedSearch, SearchRun, Watch } from "@hvnt33/core/events";
import { data } from "../lib/data";

type Tab = "activity" | "records" | "searches" | "archive" | "timeline" | "questions";

import { KIND_COLORS } from "../lib/graph";

/** "in 5h", "in 3d": how long until a future time. */
function until(iso: string): string {
  const s = (Date.parse(iso) - Date.now()) / 1000;
  if (!Number.isFinite(s)) return "";
  if (s < 60) return "soon";
  if (s < 3600) return `in ${Math.round(s / 60)}m`;
  if (s < 86400) return `in ${Math.round(s / 3600)}h`;
  return `in ${Math.round(s / 86400)}d`;
}

function ago(iso: string): string {
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if (!Number.isFinite(s)) return "";
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function InvestigationPane(props: {
  cases: Investigation[];
  caseId: string | null;
  dossier: Dossier | null;
  intakes: IntakeSummary[];
  runs: SearchRun[];
  saved: SavedSearch[];
  archiveJobs: ArchiveJob[];
  own: { snapshots: OwnSnapshot[]; watches: Watch[]; changes: PageChange[] };
  onReplay: (snapshot: OwnSnapshot) => void;
  onEvidence: (snapshot: OwnSnapshot) => void;
  onWatchAction: (watch: Watch, action: "pause" | "resume" | "run" | "remove") => void;
  onChangeSeen: (change: PageChange) => void;
  onRerun: (s: SavedSearch) => void;
  onDeleteSaved: (id: string) => void;
  onSelectCase: (id: string) => void;
  onManageCases: (mode: "list" | "create") => void;
  onOpen: (url: string) => void;
  /** Open a record in the Case view to review or edit it. */
  onOpenRecord: (recordId: string) => void;
  onSendToAgent: (intake: IntakeSummary) => void;
}) {
  const { dossier, intakes, runs } = props;
  const [tab, setTab] = useState<Tab>("activity");
  const [filter, setFilter] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  // The E2E tour switches tabs for its screenshots.
  useEffect(() => {
    const onTab = (e: Event) => setTab((e as CustomEvent<Tab>).detail);
    window.addEventListener("hvnt33:case-tab", onTab);
    return () => window.removeEventListener("hvnt33:case-tab", onTab);
  }, []);

  const records = dossier?.records ?? [];
  const connections = dossier?.connections ?? [];
  const titles = useMemo(() => new Map(records.map(r => [r.id, r.title])), [records]);
  const questions = useMemo(() => intakes.flatMap(i => (i.questions ?? []).map(q => ({ q, from: i }))), [intakes]);
  // Every query run in this case: engines, result counts and when it last ran.
  const history = useMemo(() => {
    const byQuery = new Map<string, { query: string; engines: Set<string>; results: number; last: string }>();
    for (const r of runs) {
      const h = byQuery.get(r.query) ?? { query: r.query, engines: new Set<string>(), results: 0, last: "" };
      h.engines.add(r.engine);
      h.results += r.results.length;
      if (r.observedAt > h.last) h.last = r.observedAt;
      byQuery.set(r.query, h);
    }
    return [...byQuery.values()].sort((a, b) => b.last.localeCompare(a.last));
  }, [runs]);
  const timeline = useMemo(() => records.filter(r => r.eventDate).sort((a, b) => a.eventDate!.localeCompare(b.eventDate!)), [records]);
  const activity = useMemo(() => {
    const items = [
      ...intakes.map(i => ({ t: i.createdAt, kind: "capture" as const, intake: i })),
      ...runs.map(r => ({ t: r.observedAt, kind: "search" as const, run: r })),
      ...props.archiveJobs.map(j => ({ t: j.updatedAt, kind: "archive" as const, job: j })),
      ...props.own.changes.map(c => ({ t: c.toAt, kind: "change" as const, change: c })),
    ];
    return items.sort((a, b) => b.t.localeCompare(a.t)).slice(0, 150);
  }, [intakes, runs, props.archiveJobs, props.own.changes]);
  const unseen = props.own.changes.filter(c => !c.seen).length;
  const snapshotsById = useMemo(() => new Map(props.own.snapshots.map(s => [s.id, s])), [props.own.snapshots]);
  const grouped = useMemo(() => {
    const f = filter.trim().toLowerCase();
    const list = records.filter(r => !f || `${r.title} ${r.notes ?? ""} ${r.tags ?? ""} ${r.kind}`.toLowerCase().includes(f));
    const g = new Map<string, RecordItem[]>();
    for (const r of list) g.set(r.kind, [...(g.get(r.kind) ?? []), r]);
    return [...g.entries()].sort((a, b) => b[1].length - a[1].length);
  }, [records, filter]);

  if (!props.cases.length || !props.caseId) {
    return (
      <div className="investigation">
        <div className="pane-head"><span className="pane-title">Investigation</span></div>
        <div className="case-picker">
          <p className="muted">{props.cases.length ? "Choose an investigation from the workspace menu, or manage them in the Case view." : "Open your first investigation in the Case view. Its research, browsing history and evidence will stay together."}</p>
          {props.cases.map(c => <button key={c.id} className="case-row" onClick={() => props.onSelectCase(c.id)}><b>{c.title}</b><span>{c.description}</span></button>)}
          <button className="primary" onClick={() => props.onManageCases(props.cases.length ? "list" : "create")}>{props.cases.length ? "Manage investigations" : "Open an investigation"}</button>
        </div>
      </div>
    );
  }

  const current = props.cases.find(c => c.id === props.caseId);
  return (
    <div className="investigation">
      <div className="pane-head">
        <span className="pane-title">{current?.title ?? "Investigation"}</span>
        <span className="grow" />
        <button className="mini" onClick={() => props.onManageCases("list")}>All cases</button>
        <button className="mini" onClick={() => props.onManageCases("create")} aria-label="New investigation">+</button>
      </div>
      {current?.description && <p className="case-question">{current.description}</p>}
      <div className="stats">
        <div><b>{records.length}</b><span>records</span></div>
        <div><b>{connections.length}</b><span>links</span></div>
        <div><b>{intakes.length}</b><span>captures</span></div>
        <div><b>{runs.length}</b><span>searches</span></div>
      </div>
      <div className="tabs">
        {(["activity", "records", "searches", "archive", "timeline", "questions"] as Tab[]).map(t => (
          <button key={t} className={tab === t ? "on" : ""} onClick={() => setTab(t)}>
            {t}{t === "questions" && questions.length ? <span className="count">{questions.length}</span> : null}
            {t === "archive" && unseen ? <span className="count" title="Page changes you have not looked at">{unseen}</span> : null}
          </button>
        ))}
      </div>
      <div className="pane-body">
        {tab === "activity" && (
          <ul className="feed">
            {activity.map(a => a.kind === "change" ? (
              <li key={"p" + a.change.id} className={`feed-item search change ${a.change.seen ? "" : "unseen"}`}>
                <div className="feed-top">
                  <span className="engine-tag" style={{ color: "var(--amber, #f2a65a)" }}>Page changed</span>
                  <span className="when">{ago(a.t)}</span>
                </div>
                <div className="feed-title">{a.change.title || domainOf(a.change.url)} <span className="dim">· +{a.change.added} −{a.change.removed} lines</span></div>
                <button className="link small" onClick={() => setTab("archive")}>See what changed</button>
              </li>
            ) : a.kind === "archive" && a.job.kind === "archive.capture" ? (
              <li key={"a" + a.job.id} className={`feed-item search archive ${a.job.state}`}>
                <div className="feed-top">
                  <span className="engine-tag" style={{ color: a.job.state === "failed" ? "var(--red)" : "var(--teal)" }}>
                    {{ queued: "Snapshot queued", running: "Snapshotting", done: "Snapshot", failed: "Snapshot failed" }[a.job.state]}
                  </span>
                  <span className="when">{ago(a.t)}</span>
                </div>
                <div className="feed-title">{domainOf(a.job.payload.url)} <span className="dim">· HVNT33 archive</span></div>
                {a.job.state === "failed" && <div className="feed-sub">{a.job.error}</div>}
              </li>
            ) : a.kind === "archive" ? (
              <li key={"a" + a.job.id} className={`feed-item search archive ${a.job.state}`}>
                <div className="feed-top">
                  <span className="engine-tag" style={{ color: a.job.state === "failed" ? "var(--red)" : "var(--teal)" }}>
                    {{ queued: "Archive queued", running: "Archiving", done: "Archived", failed: "Archive failed" }[a.job.state]}
                  </span>
                  <span className="when">{ago(a.t)}</span>
                </div>
                <div className="feed-title">{domainOf(a.job.payload.url)} <span className="dim">· Wayback Machine</span></div>
                {a.job.state === "done" && a.job.result && <button className="link small" onClick={() => props.onOpen(a.job.result!.snapshotUrl)}>Open snapshot ({new Date(a.job.result.capturedAt).toLocaleString()})</button>}
                {a.job.state === "failed" && <div className="feed-sub">{a.job.error}</div>}
              </li>
            ) : a.kind === "capture" ? (
              <li key={"c" + a.intake.id} className={`feed-item capture ${a.intake.state}`}>
                <div className="feed-top">
                  <span className={`state ${a.intake.state}`}>{stateLabel(a.intake.state)}</span>
                  <span className="when">{ago(a.t)}</span>
                </div>
                <div className="feed-title">{a.intake.title}</div>
                {a.intake.researcherNote && <div className="note">“{a.intake.researcherNote}”</div>}
                {a.intake.archive?.snapshotUrl && <button className="link small" onClick={() => props.onOpen(a.intake.archive!.snapshotUrl)}>Wayback snapshot {new Date(a.intake.archive.capturedAt).toLocaleDateString()}</button>}
                {a.intake.snapshot && snapshotsById.get(a.intake.snapshot.id) && <button className="link small" onClick={() => props.onReplay(snapshotsById.get(a.intake.snapshot!.id)!)}>Replay page as captured {new Date(a.intake.snapshot.capturedAt).toLocaleString()}</button>}
                <div className="feed-sub">
                  {a.intake.sourceUrl ? <button className="link" onClick={() => props.onOpen(a.intake.sourceUrl!)}>{a.intake.sourceLabel}</button> : a.intake.sourceLabel}
                  {a.intake.records > 0 && <> · {a.intake.records} records, {a.intake.connections} links</>}
                </div>
                {a.intake.state === "captured" && <button className="mini" onClick={() => props.onSendToAgent(a.intake)}>Send to agent</button>}
              </li>
            ) : (
              <li key={"s" + a.run.id} className="feed-item search">
                <div className="feed-top">
                  <span className="engine-tag" style={{ color: engineById(a.run.engine)?.color }}>{engineById(a.run.engine)?.name ?? a.run.engine}</span>
                  <span className="when">{ago(a.t)}</span>
                </div>
                <div className="feed-title">“{a.run.query}” <span className="dim">· {a.run.results.length} results observed</span></div>
              </li>
            ))}
            {!activity.length && <li className="empty">Search with ⌘K, highlight anything on a page and press ⌘⇧S. Captures and searches appear here, and the agent files them into this case.</li>}
          </ul>
        )}
        {tab === "records" && (
          <div>
            <input className="filter" placeholder="Filter records…" value={filter} onChange={e => setFilter(e.target.value)} />
            {grouped.map(([kind, list]) => (
              <section key={kind} className="kind-group">
                <h4><i style={{ background: KIND_COLORS[kind] }} />{kind}<span>{list.length}</span></h4>
                {list.map(r => (
                  <div key={r.id} className={`record ${open === r.id ? "open" : ""}`}>
                    <button className="record-row" onClick={() => setOpen(open === r.id ? null : r.id)}>
                      <span className="record-title">{r.title}</span>
                      {r.filedBy === "agent" && <span className="badge">agent</span>}
                      <span className={`status ${r.status}`}>{r.status}</span>
                    </button>
                    {open === r.id && (
                      <div className="record-detail">
                        {r.eventDate && <div className="dim">{r.eventDate}</div>}
                        {r.notes && <p>{r.notes.length > 1200 ? r.notes.slice(0, 1200) + "…" : r.notes}</p>}
                        {r.sourceQuote && <blockquote>{r.sourceQuote}</blockquote>}
                        {r.sourceUrl && <button className="link" onClick={() => props.onOpen(r.sourceUrl!)}>{r.sourceLabel || r.sourceUrl}</button>}
                        <button className="mini" onClick={() => props.onOpenRecord(r.id)}>Review in case ⌘4</button>
                        <ul className="edges">
                          {connections.filter(c => c.fromId === r.id || c.toId === r.id).slice(0, 30).map(c => (
                            <li key={c.id}>{c.fromId === r.id ? <>→ <em>{c.label}</em> {titles.get(c.toId)}</> : <>← {titles.get(c.fromId)} <em>{c.label}</em></>}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                ))}
              </section>
            ))}
            {!records.length && <div className="empty">No records yet. The agent files captures into records and connections.</div>}
          </div>
        )}
        {tab === "searches" && (
          <div>
            <div className="dp-section">Saved searches</div>
            <ul className="saved-list">
              {props.saved.map(s => (
                <li key={s.id}>
                  <div className="feed-title">“{s.query}”</div>
                  <div className="feed-sub">
                    {s.engines.map(e => engineById(e)?.name ?? e).join(", ")}
                    {s.lastRunAt ? <> · last run {ago(s.lastRunAt)}</> : <> · saved {ago(s.createdAt)}</>}
                  </div>
                  <div className="row-actions">
                    <button className="mini" onClick={() => props.onRerun(s)} title="Run again on the saved engines; compare with | changes in the Search Lab">Re-run on all engines</button>
                    <button className="mini ghosty" onClick={() => props.onDeleteSaved(s.id)}>Remove</button>
                  </div>
                </li>
              ))}
              {!props.saved.length && <li className="empty">Save a query from the data panel (☆) to re-run it later and track what changes.</li>}
            </ul>
            <div className="dp-section">History</div>
            <ul className="saved-list">
              {history.map(h => (
                <li key={h.query}>
                  <div className="feed-title">“{h.query}”</div>
                  <div className="feed-sub">{[...h.engines].map(e => engineById(e)?.name ?? e).join(", ")} · {h.results} results observed · {ago(h.last)}</div>
                </li>
              ))}
              {!history.length && <li className="empty">Searches you run appear here.</li>}
            </ul>
          </div>
        )}
        {tab === "archive" && <ArchiveTab {...props} />}
        {tab === "timeline" && (
          <ol className="timeline">
            {timeline.map(r => (
              <li key={r.id}><time>{r.eventDate}</time><i style={{ background: KIND_COLORS[r.kind] }} /><span>{r.title}</span><span className={`status ${r.status}`}>{r.status}</span></li>
            ))}
            {!timeline.length && <li className="empty">Dated records will line up here.</li>}
          </ol>
        )}
        {tab === "questions" && (
          <ul className="questions">
            {questions.map((x, i) => <li key={i}><p>{x.q}</p><span className="dim">from {x.from.title}</span></li>)}
            {!questions.length && <li className="empty">Open questions raised while filing captures appear here.</li>}
          </ul>
        )}
      </div>
    </div>
  );
}

function stateLabel(state: string) {
  return ({ captured: "Waiting for agent", pending: "Extracted", filed: "Filed by agent", approved: "Filed", rejected: "Rejected" } as Record<string, string>)[state] ?? state;
}

/**
 * The case's own archive: what changed on watched pages (with the full
 * diff), what is being watched, and every snapshot with its evidence.
 */
function ArchiveTab(props: Parameters<typeof InvestigationPane>[0]) {
  const { snapshots, watches, changes } = props.own;
  const [open, setOpen] = useState<string | null>(null);
  const byId = useMemo(() => new Map(snapshots.map(s => [s.id, s])), [snapshots]);
  return (
    <div className="archive-tab">
      <div className="dp-section">Changes{changes.length ? ` · ${changes.length}` : ""}</div>
      <ul className="saved-list">
        {changes.map(c => (
          <li key={c.id} className={`change-row ${c.seen ? "" : "unseen"}`}>
            <button className="record-row" onClick={() => { setOpen(open === c.id ? null : c.id); props.onChangeSeen(c); }}>
              <span className="record-title">{c.title || domainOf(c.url)}</span>
              <span className="diffstat"><b className="add">+{c.added}</b> <b className="del">−{c.removed}</b></span>
            </button>
            <div className="feed-sub">{domainOf(c.url)} · {new Date(c.fromAt).toLocaleDateString()} → {new Date(c.toAt).toLocaleString()} · {Math.round(c.similarity * 100)}% unchanged</div>
            {open === c.id && <DiffView change={c} />}
            {open === c.id && (
              <div className="row-actions">
                {byId.get(c.fromSnapshotId) && <button className="mini" onClick={() => props.onReplay(byId.get(c.fromSnapshotId)!)}>Replay before</button>}
                {byId.get(c.toSnapshotId) && <button className="mini" onClick={() => props.onReplay(byId.get(c.toSnapshotId)!)}>Replay after</button>}
                {byId.get(c.toSnapshotId) && <button className="mini ghosty" onClick={() => props.onEvidence(byId.get(c.toSnapshotId)!)}>Evidence</button>}
              </div>
            )}
          </li>
        ))}
        {!changes.length && <li className="empty">When a watched page's text changes between snapshots, the difference appears here.</li>}
      </ul>
      <div className="dp-section">Watched pages{watches.length ? ` · ${watches.length}` : ""}</div>
      <ul className="saved-list">
        {watches.map(w => (
          <li key={w.id}>
            <div className="feed-title"><button className="link" onClick={() => props.onOpen(w.url)}>{w.url.replace(/^https?:\/\//, "")}</button></div>
            <div className="feed-sub">
              {w.active ? `every ${w.everyHours === 168 ? "week" : w.everyHours === 24 ? "day" : `${w.everyHours} h`} · next ${until(w.nextRunAt)}` : "paused"}
              {w.lastRunAt && <> · last {ago(w.lastRunAt)}</>}
              {w.lastChangeAt && <> · changed {ago(w.lastChangeAt)}</>}
            </div>
            {w.lastError && <div className="feed-sub warn">{w.lastError}</div>}
            <div className="row-actions">
              <button className="mini" onClick={() => props.onWatchAction(w, "run")}>Snapshot now</button>
              <button className="mini" onClick={() => props.onWatchAction(w, w.active ? "pause" : "resume")}>{w.active ? "Pause" : "Resume"}</button>
              <button className="mini ghosty" onClick={() => props.onWatchAction(w, "remove")} title="Stop watching; snapshots are kept">Stop</button>
            </div>
          </li>
        ))}
        {!watches.length && <li className="empty">Watch a page from the data panel to snapshot it on a schedule.</li>}
      </ul>
      <div className="dp-section">Snapshots{snapshots.length ? ` · ${snapshots.length}` : ""}</div>
      <ul className="saved-list">
        {snapshots.slice(0, 100).map(s => (
          <li key={s.id}>
            <div className="feed-title">{s.title || domainOf(s.url)} {s.changed === true && <span className="flag rec">changed</span>}</div>
            <div className="feed-sub">
              {domainOf(s.url)} · {new Date(s.capturedAt).toLocaleString()} · {s.trigger}
              {" · "}{s.timestamps.length ? `timestamped (${s.timestamps.length})` : <span className="warn">no timestamp</span>}
            </div>
            <div className="row-actions">
              <button className="mini" onClick={() => props.onReplay(s)}>Replay</button>
              <button className="mini ghosty" onClick={() => props.onEvidence(s)}>Evidence</button>
            </div>
          </li>
        ))}
        {!snapshots.length && <li className="empty">Snapshots you take (Snapshot now in the data panel) are kept here with their evidence.</li>}
      </ul>
    </div>
  );
}

/** The full line diff of a change, with long unchanged runs folded. */
function DiffView({ change }: { change: PageChange }) {
  const [parts, setParts] = useState<{ kind: "added" | "removed" | "same"; lines: string[] }[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    data.changeDiff(change.id).then(d => { if (live) setParts(d.parts); }).catch(e => { if (live) setError(String(e)); });
    return () => { live = false; };
  }, [change.id]);
  if (error) return <div className="warn small">{error}</div>;
  if (!parts) return <div className="dim small">Loading the difference…</div>;
  return (
    <div className="diff">
      {parts.map((p, i) => {
        if (p.kind !== "same") return p.lines.map((l, j) => <div key={`${i}-${j}`} className={`diff-line ${p.kind}`}><i>{p.kind === "added" ? "+" : "−"}</i>{l}</div>);
        const head = i === 0 ? [] : p.lines.slice(0, 2), tail = i === parts.length - 1 ? [] : p.lines.slice(-2);
        const folded = p.lines.length - head.length - tail.length;
        if (folded <= 1) return p.lines.map((l, j) => <div key={`${i}-${j}`} className="diff-line same"><i /> {l}</div>);
        return [
          ...head.map((l, j) => <div key={`${i}-h${j}`} className="diff-line same"><i /> {l}</div>),
          <div key={`${i}-f`} className="diff-fold">… {folded} unchanged line{folded === 1 ? "" : "s"} …</div>,
          ...tail.map((l, j) => <div key={`${i}-t${j}`} className="diff-line same"><i /> {l}</div>),
        ];
      })}
    </div>
  );
}
