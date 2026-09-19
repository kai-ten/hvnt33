// The case as a workspace (⌘4): review and edit what was filed, set
// verification statuses, connect records, see the map and the chronology,
// review staged captures, and export. Reviews are recorded apart from agent
// filing: setting a status or "Mark reviewed" records who reviewed it and when.
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Connection, Dossier, IntakeSummary, Investigation, RecordItem } from "@hvnt33/core/events";
import { data } from "../lib/data";
import { KIND_COLORS, layout, mapSvg, type Positions } from "../lib/graph";

export type CaseTab = "records" | "map" | "timeline" | "review" | "export";
const KINDS = ["Person", "Organization", "Place", "Event", "Claim", "Document", "Image", "Video", "Link", "Note"] as const;
const STATUSES = ["Unverified", "Corroborated", "Verified", "Disputed"] as const;
type Flash = (text: string, tone: "info" | "ok" | "warn") => void;

export interface CaseViewProps {
  investigation: Investigation;
  titleControl?: ReactNode;
  dossier: Dossier | null;
  intakes: IntakeSummary[];
  tab: CaseTab;
  onTab: (tab: CaseTab) => void;
  focus: string | null;
  onFocus: (recordId: string | null) => void;
  onChanged: () => Promise<void> | void;
  onOpen: (url: string) => void;
  onSendToAgent: (intake: IntakeSummary) => void;
  flash: Flash;
}

const needsReview = (r: { filedBy?: string; reviewedAt?: string }) => r.filedBy === "agent" && !r.reviewedAt;
const errorText = (e: unknown) => String(e).replace(/^Error: /, "");
const when = (iso?: string) => (iso ? new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "");

export function CaseView(props: CaseViewProps) {
  const records = useMemo(() => (props.dossier?.records ?? []) as RecordItem[], [props.dossier]);
  const connections = useMemo(() => (props.dossier?.connections ?? []) as Connection[], [props.dossier]);
  const queue = records.filter(needsReview).length + props.intakes.filter(i => i.state === "pending").length;
  const tabs: [CaseTab, string][] = [["records", "Records"], ["map", "Map"], ["timeline", "Timeline"], ["review", "Review"], ["export", "Export"]];

  return (
    <div className="case-view">
      <div className="case-head">
        {props.titleControl ?? <div className="case-title"><h2>{props.investigation.title}</h2></div>}
        <div className="seg" role="tablist">
          {tabs.map(([t, label]) => (
            <button key={t} role="tab" aria-selected={props.tab === t} className={props.tab === t ? "on" : ""} onClick={() => props.onTab(t)}>
              {label}{t === "review" && queue > 0 && <span className="count">{queue}</span>}
            </button>
          ))}
        </div>
      </div>
      {!props.dossier ? <div className="empty">Loading the case…</div> : (
        <>
          {props.tab === "records" && <RecordsTab {...props} records={records} connections={connections} />}
          {props.tab === "map" && <MapTab {...props} records={records} connections={connections} />}
          {props.tab === "timeline" && <TimelineTab {...props} records={records} />}
          {props.tab === "review" && <ReviewTab {...props} records={records} />}
          {props.tab === "export" && <ExportTab {...props} records={records} connections={connections} />}
        </>
      )}
    </div>
  );
}

// ── Records ──────────────────────────────────────────────────────────────────

function RecordsTab(props: CaseViewProps & { records: RecordItem[]; connections: Connection[] }) {
  const [q, setQ] = useState("");
  const [kind, setKind] = useState("");
  const [status, setStatus] = useState("");
  const [onlyReview, setOnlyReview] = useState(false);
  const [creating, setCreating] = useState(false);
  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return props.records
      .filter(r => (!kind || r.kind === kind) && (!status || r.status === status) && (!onlyReview || needsReview(r)))
      .filter(r => !needle || `${r.title} ${r.notes ?? ""} ${r.tags ?? ""} ${r.sourceLabel ?? ""}`.toLowerCase().includes(needle))
      .sort((a, b) => Number(needsReview(b)) - Number(needsReview(a)) || a.title.localeCompare(b.title));
  }, [props.records, q, kind, status, onlyReview]);
  const selected = props.records.find(r => r.id === props.focus) ?? null;
  const waiting = props.records.filter(needsReview).length;

  return (
    <div className="case-split">
      <div className="case-list">
        <div className="case-filters">
          <input className="filter" placeholder="Search titles, notes, tags, sources…" value={q} onChange={e => setQ(e.target.value)} />
          <div className="row">
            <select value={kind} onChange={e => setKind(e.target.value)} aria-label="Kind"><option value="">All kinds</option>{KINDS.map(k => <option key={k}>{k}</option>)}</select>
            <select value={status} onChange={e => setStatus(e.target.value)} aria-label="Status"><option value="">Any status</option>{STATUSES.map(s => <option key={s}>{s}</option>)}</select>
          </div>
          <div className="row">
            <label className="check small"><input type="checkbox" checked={onlyReview} onChange={e => setOnlyReview(e.target.checked)} /> Needs review ({waiting})</label>
            <span className="grow" />
            <button className="mini" onClick={() => { setCreating(true); props.onFocus(null); }}>+ Record</button>
          </div>
        </div>
        <ul className="record-list">
          {list.map(r => (
            <li key={r.id}>
              <button className={`record-item ${r.id === props.focus ? "sel" : ""}`} onClick={() => { setCreating(false); props.onFocus(r.id); }}>
                <i style={{ background: KIND_COLORS[r.kind] }} title={r.kind} />
                <span className="record-title">{r.title}</span>
                {needsReview(r) && <span className="flag cap" title="Filed by the agent; not reviewed yet">review</span>}
                <span className={`status ${r.status}`}>{r.status}</span>
              </button>
            </li>
          ))}
          {!list.length && <li className="empty">{props.records.length ? "No records match." : "No records yet. Capture material and let the agent file it, or add a record."}</li>}
        </ul>
      </div>
      <div className="case-detail">
        {creating ? (
          <NewRecord {...props} onDone={id => { setCreating(false); if (id) props.onFocus(id); }} />
        ) : selected ? (
          <RecordEditor key={selected.id} {...props} record={selected} />
        ) : (
          <div className="empty">Select a record to review it: check it against its source, set its verification status, and connect it to others.{waiting > 0 && <><br /><br /><b>{waiting}</b> filed by the agent {waiting === 1 ? "waits" : "wait"} for review.</>}</div>
        )}
      </div>
    </div>
  );
}

function StatusButtons({ value, onChange, disabled }: { value: string; onChange: (s: string) => void; disabled?: boolean }) {
  return (
    <div className="seg status-seg" role="radiogroup" aria-label="Verification status">
      {STATUSES.map(s => <button key={s} role="radio" aria-checked={value === s} disabled={disabled} className={value === s ? `on ${s}` : ""} onClick={() => value !== s && onChange(s)}>{s}</button>)}
    </div>
  );
}

function ReviewBadge({ item }: { item: { filedBy?: string; reviewedAt?: string; reviewedBy?: string } }) {
  if (item.reviewedAt) return <span className="flag vis" title={`Reviewed by ${item.reviewedBy || "you"} on ${when(item.reviewedAt)}`}>reviewed {new Date(item.reviewedAt).toLocaleDateString()}</span>;
  return <span className={`flag ${item.filedBy === "agent" ? "cap" : "none"}`}>{item.filedBy === "agent" ? "filed by agent · not reviewed" : "not reviewed"}</span>;
}

type RecordFields = { title: string; notes: string; sourceUrl: string; sourceLabel: string; eventDate: string; tags: string; public: boolean };
const recordFields = (r: RecordItem): RecordFields => ({ title: r.title, notes: r.notes ?? "", sourceUrl: r.sourceUrl ?? "", sourceLabel: r.sourceLabel ?? "", eventDate: r.eventDate ?? "", tags: r.tags ?? "", public: !!r.public });

function RecordEditor(props: CaseViewProps & { record: RecordItem; records: RecordItem[]; connections: Connection[] }) {
  const r = props.record;
  const [form, setForm] = useState<RecordFields>(() => recordFields(r));
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [image, setImage] = useState<string | null>(null);
  const dirty = (Object.keys(form) as (keyof RecordFields)[]).filter(k => form[k] !== recordFields(r)[k]);
  const capture = props.intakes.find(i => i.id === r.intakeId);
  const titles = useMemo(() => new Map(props.records.map(x => [x.id, x.title])), [props.records]);
  const links = props.connections.filter(c => c.fromId === r.id || c.toId === r.id);

  useEffect(() => { setForm(recordFields(r)); }, [r]);
  useEffect(() => {
    setImage(null);
    if (r.fileKey && r.mime?.startsWith("image/") && r.mime !== "image/svg+xml") data.recordImage(r.id).then(setImage).catch(() => setImage(null));
  }, [r.id, r.fileKey, r.mime]);

  const save = async (body: Parameters<typeof data.updateRecord>[1], message: string) => {
    setBusy(true);
    try { await data.updateRecord(r.id, body); await props.onChanged(); props.flash(message, "ok"); }
    catch (e) { props.flash(errorText(e), "warn"); }
    finally { setBusy(false); }
  };
  const set = <K extends keyof RecordFields>(k: K, v: RecordFields[K]) => setForm(f => ({ ...f, [k]: v }));

  return (
    <div className="record-editor">
      <div className="row wrap">
        <span className="kind-tag" style={{ color: KIND_COLORS[r.kind] }}>{r.kind}</span>
        <ReviewBadge item={r} />
        {r.contentOrigin && r.contentOrigin !== "source-text" && <span className="flag none" title="How the source content was obtained">{r.contentOrigin}</span>}
        <span className="grow" />
        {r.reviewedAt
          ? <button className="link small" disabled={busy} onClick={() => void save({ reviewed: false }, "Review cleared.")}>Clear review</button>
          : <button className="mini" disabled={busy} onClick={() => void save({ reviewed: true }, "Marked as reviewed.")}>Mark reviewed</button>}
      </div>
      <input className="title-input" value={form.title} onChange={e => set("title", e.target.value)} maxLength={1000} aria-label="Title" />
      <StatusButtons value={r.status} disabled={busy} onChange={s => void save({ status: s }, `Marked ${s}. Your review is recorded.`)} />

      {r.sourceQuote && (
        <div className="source-quote">
          <blockquote>{r.sourceQuote}</blockquote>
          <div className="dim small">
            Exact excerpt from the source{capture ? <> · captured in <button className="link" onClick={() => props.onTab("review")}>{capture.title}</button></> : null}
          </div>
        </div>
      )}

      <label className="field"><span>Notes, finding</span><textarea rows={5} value={form.notes} onChange={e => set("notes", e.target.value)} placeholder="What does this tell you? Keep what you know apart from what you suspect." /></label>
      <div className="row">
        <label className="field grow"><span>Source</span><input value={form.sourceLabel} onChange={e => set("sourceLabel", e.target.value)} placeholder="Publisher, author, document…" /></label>
        <label className="field"><span>Event date</span><input className="date-input" value={form.eventDate} onChange={e => set("eventDate", e.target.value.trim())} placeholder="YYYY-MM-DD" maxLength={10} pattern="\d{4}-\d{2}-\d{2}" title="The date the event happened, as YYYY-MM-DD; leave empty if unknown" /></label>
      </div>
      <label className="field"><span>Source URL {form.sourceUrl && <button className="link" onClick={() => props.onOpen(form.sourceUrl)}>open</button>}</span><input value={form.sourceUrl} onChange={e => set("sourceUrl", e.target.value)} placeholder="https://" /></label>
      <label className="field"><span>Tags</span><input value={form.tags} onChange={e => set("tags", e.target.value)} placeholder="procurement, interview, follow-up" /></label>
      <label className="check small"><input type="checkbox" checked={form.public} onChange={e => set("public", e.target.checked)} /> Include in presentation exports</label>
      <div className="row">
        <button className="primary" disabled={busy || !dirty.length || !form.title.trim()} onClick={() => void save(Object.fromEntries(dirty.map(k => [k, form[k]])), "Saved.")}>Save changes</button>
        {dirty.length > 0 && <button className="ghost" onClick={() => setForm(recordFields(r))}>Discard</button>}
        <span className="grow" />
        {confirmDelete ? (
          <>
            <span className="small warn">Delete this record{links.length ? ` and its ${links.length} connection${links.length === 1 ? "" : "s"}` : ""}?</span>
            <button className="ghost" onClick={() => setConfirmDelete(false)}>Keep</button>
            <button className="ghost danger" disabled={busy} onClick={async () => {
              setBusy(true);
              try { await data.deleteRecord(r.id); props.onFocus(null); await props.onChanged(); props.flash("Record deleted.", "ok"); }
              catch (e) { props.flash(errorText(e), "warn"); setBusy(false); }
            }}>Delete</button>
          </>
        ) : <button className="link small" onClick={() => setConfirmDelete(true)}>Delete record…</button>}
      </div>

      {r.fileKey && (
        <div className="evidence">
          <div className="dp-section">Evidence original</div>
          {image && <img src={image} alt={r.title} />}
          <div className="small">{r.filename} · {((r.size ?? 0) / 1048576).toFixed(2)} MB · <button className="link" onClick={() => void data.downloadRecordFile(r).then(p => props.flash(`Saved to ${p.replace(/^.*\/(Downloads\/)/, "$1")}`, "ok"), e => props.flash(errorText(e), "warn"))}>Save to Downloads</button></div>
          {r.sha256 && <div className="mono small dim">SHA-256 {r.sha256}</div>}
        </div>
      )}

      <div className="dp-section">Connections · {links.length}</div>
      <ul className="link-list">
        {links.map(c => <ConnectionRow key={c.id} {...props} connection={c} titles={titles} />)}
        {!links.length && <li className="dim small">Not connected to anything yet.</li>}
      </ul>
      <NewConnection {...props} from={r} />
      <div className="dim small provenance">
        Created {when(r.createdAt)}{r.filedBy === "agent" ? " by the agent" : ""}{r.updatedAt && r.updatedAt !== r.createdAt ? ` · edited ${when(r.updatedAt)}` : ""}
        {r.reviewedAt ? ` · reviewed ${when(r.reviewedAt)} by ${r.reviewedBy}` : ""}
      </div>
    </div>
  );
}

function ConnectionRow(props: CaseViewProps & { connection: Connection; record: RecordItem; titles: Map<string, string>; records: RecordItem[] }) {
  const c = props.connection;
  const [editing, setEditing] = useState(false);
  const [label, setLabel] = useState(c.label);
  const [notes, setNotes] = useState(c.notes ?? "");
  const [evidenceId, setEvidenceId] = useState(c.evidenceId ?? "");
  const [confirm, setConfirm] = useState(false);
  const outgoing = c.fromId === props.record.id;
  const other = outgoing ? c.toId : c.fromId;
  const run = async (fn: () => Promise<unknown>, message: string) => {
    try { await fn(); await props.onChanged(); props.flash(message, "ok"); } catch (e) { props.flash(errorText(e), "warn"); }
  };
  return (
    <li className="link-row">
      <div className="row wrap">
        <span>{outgoing ? <>→ <em>{c.label}</em> </> : <>← </>}<button className="link" onClick={() => props.onFocus(other)}>{props.titles.get(other) ?? "a deleted record"}</button>{!outgoing && <> <em>{c.label}</em></>}</span>
        <span className="grow" />
        <select className={`status-select ${c.status}`} value={c.status} onChange={e => void run(() => data.updateConnection(c.id, { status: e.target.value }), `Connection marked ${e.target.value}.`)} aria-label="Connection status">
          {STATUSES.map(s => <option key={s}>{s}</option>)}
        </select>
        {c.reviewedAt ? <span className="flag vis" title={`Reviewed ${when(c.reviewedAt)}`}>reviewed</span> : <button className="mini ghosty" onClick={() => void run(() => data.updateConnection(c.id, { reviewed: true }), "Connection marked as reviewed.")}>Mark reviewed</button>}
        <button className="link small" onClick={() => setEditing(v => !v)}>{editing ? "Close" : "Edit"}</button>
      </div>
      {c.sourceQuote && <blockquote className="small">{c.sourceQuote}</blockquote>}
      {c.evidenceId && !editing && <div className="dim small">Evidence: <button className="link" onClick={() => props.onFocus(c.evidenceId!)}>{props.titles.get(c.evidenceId) ?? "a deleted record"}</button></div>}
      {editing && (
        <div className="link-edit">
          <label className="field"><span>Relationship</span><input value={label} onChange={e => setLabel(e.target.value)} maxLength={200} /></label>
          <label className="field"><span>Supporting evidence</span>
            <select value={evidenceId} onChange={e => setEvidenceId(e.target.value)}><option value="">None yet</option>{props.records.map(x => <option key={x.id} value={x.id}>{x.title} ({x.kind})</option>)}</select>
          </label>
          <label className="field"><span>Notes</span><textarea rows={2} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Why you believe this connection exists" /></label>
          <label className="check small"><input type="checkbox" checked={!!c.public} onChange={e => void run(() => data.updateConnection(c.id, { public: e.target.checked }), "Saved.")} /> Include in presentation exports</label>
          <div className="row">
            <button className="primary" disabled={!label.trim()} onClick={() => void run(() => data.updateConnection(c.id, { label: label.trim(), notes, evidenceId }), "Connection saved.").then(() => setEditing(false))}>Save</button>
            <span className="grow" />
            {confirm
              ? <><button className="ghost" onClick={() => setConfirm(false)}>Keep</button><button className="ghost danger" onClick={() => void run(() => data.deleteConnection(c.id), "Connection deleted.")}>Delete</button></>
              : <button className="link small" onClick={() => setConfirm(true)}>Delete connection…</button>}
          </div>
        </div>
      )}
    </li>
  );
}

function NewConnection(props: CaseViewProps & { from: RecordItem; records: RecordItem[] }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [to, setTo] = useState("");
  const [label, setLabel] = useState("");
  const [evidenceId, setEvidenceId] = useState("");
  const [status, setStatus] = useState<string>("Unverified");
  const [notes, setNotes] = useState("");
  const candidates = props.records.filter(r => r.id !== props.from.id && (!q || r.title.toLowerCase().includes(q.toLowerCase()))).slice(0, 50);
  if (!open) return <button className="mini" onClick={() => setOpen(true)}>+ Connect to…</button>;
  return (
    <div className="link-edit">
      <label className="field"><span>{props.from.title} →</span>
        <input placeholder="Find a record…" value={q} onChange={e => setQ(e.target.value)} />
        <select size={Math.min(6, Math.max(2, candidates.length))} value={to} onChange={e => setTo(e.target.value)} aria-label="Connect to">
          {candidates.map(r => <option key={r.id} value={r.id}>{r.title} ({r.kind})</option>)}
        </select>
      </label>
      <label className="field"><span>Relationship</span><input value={label} onChange={e => setLabel(e.target.value)} placeholder="owns, paid, met with, contradicts, supports…" maxLength={200} /></label>
      <label className="field"><span>Supporting evidence</span>
        <select value={evidenceId} onChange={e => setEvidenceId(e.target.value)}><option value="">None yet</option>{props.records.map(x => <option key={x.id} value={x.id}>{x.title} ({x.kind})</option>)}</select>
      </label>
      <div className="row"><span className="small dim">Status</span><StatusButtons value={status} onChange={setStatus} /></div>
      <label className="field"><span>Notes</span><textarea rows={2} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Why you believe this connection exists" /></label>
      <div className="row">
        <button className="primary" disabled={!to || !label.trim()} onClick={async () => {
          try {
            await data.createConnection({ fromId: props.from.id, toId: to, label: label.trim(), status, notes, evidenceId });
            await props.onChanged();
            props.flash("Connection saved.", "ok");
            setOpen(false); setTo(""); setLabel(""); setNotes(""); setEvidenceId(""); setQ("");
          } catch (e) { props.flash(errorText(e), "warn"); }
        }}>Connect</button>
        <button className="ghost" onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </div>
  );
}

function NewRecord(props: CaseViewProps & { onDone: (id: string | null) => void }) {
  const [kind, setKind] = useState<RecordItem["kind"]>("Note");
  const [form, setForm] = useState({ title: "", notes: "", sourceUrl: "", sourceLabel: "", eventDate: "", tags: "", status: "Unverified", public: false });
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof form, v: string | boolean) => setForm(f => ({ ...f, [k]: v }));
  return (
    <div className="record-editor">
      <div className="dp-section">New record</div>
      <div className="row">
        <select value={kind} onChange={e => setKind(e.target.value)} aria-label="Kind">{KINDS.map(k => <option key={k}>{k}</option>)}</select>
        <input className="title-input grow" autoFocus placeholder="Title" value={form.title} onChange={e => set("title", e.target.value)} maxLength={1000} />
      </div>
      <StatusButtons value={form.status} onChange={s => set("status", s)} />
      <label className="field"><span>Notes, finding</span><textarea rows={5} value={form.notes} onChange={e => set("notes", e.target.value)} /></label>
      <div className="row">
        <label className="field grow"><span>Source</span><input value={form.sourceLabel} onChange={e => set("sourceLabel", e.target.value)} placeholder="Publisher, author, interview…" /></label>
        <label className="field"><span>Event date</span><input className="date-input" value={form.eventDate} onChange={e => set("eventDate", e.target.value.trim())} placeholder="YYYY-MM-DD" maxLength={10} pattern="\d{4}-\d{2}-\d{2}" title="The date the event happened, as YYYY-MM-DD; leave empty if unknown" /></label>
      </div>
      <label className="field"><span>Source URL</span><input value={form.sourceUrl} onChange={e => set("sourceUrl", e.target.value)} placeholder="https://" /></label>
      <label className="field"><span>Tags</span><input value={form.tags} onChange={e => set("tags", e.target.value)} /></label>
      <label className="check small"><input type="checkbox" checked={form.public} onChange={e => set("public", e.target.checked)} /> Include in presentation exports</label>
      <p className="dim small">To keep an original file (a document, image or recording), capture it instead, so it is archived with a checksum and the agent can file it.</p>
      <div className="row">
        <button className="primary" disabled={busy || !form.title.trim()} onClick={async () => {
          setBusy(true);
          try {
            const r = await data.createRecord({ investigationId: props.investigation.id, kind, ...form, title: form.title.trim() });
            await props.onChanged();
            props.flash("Record added.", "ok");
            props.onDone(r.id);
          } catch (e) { props.flash(errorText(e), "warn"); setBusy(false); }
        }}>Add record</button>
        <button className="ghost" onClick={() => props.onDone(null)}>Cancel</button>
      </div>
    </div>
  );
}

// ── Map ──────────────────────────────────────────────────────────────────────

const MAP_W = 1100, MAP_H = 700, MAP_MAX = 150;

function MapTab(props: CaseViewProps & { records: RecordItem[]; connections: Connection[] }) {
  const storeKey = `hvnt33.map.${props.investigation.id}`;
  const [kind, setKind] = useState("");
  const [pinned, setPinned] = useState<Positions>(() => { try { return JSON.parse(localStorage.getItem(storeKey) ?? "{}"); } catch { return {}; } });
  const nodes = useMemo(() => props.records.filter(r => !kind || r.kind === kind).slice(0, MAP_MAX).map(r => ({ id: r.id, title: r.title, kind: r.kind, status: r.status })), [props.records, kind]);
  const edges = useMemo(() => props.connections.map(c => ({ id: c.id, fromId: c.fromId, toId: c.toId, label: c.label, status: c.status })), [props.connections]);
  const auto = useMemo(() => layout(nodes, edges, MAP_W, MAP_H, pinned), [nodes, edges, pinned]);
  const [drag, setDrag] = useState<{ id: string; pos: { x: number; y: number }; moved: boolean } | null>(null);
  const svg = useRef<SVGSVGElement>(null);
  const pos: Positions = drag ? { ...auto, [drag.id]: drag.pos } : auto;
  const ids = new Set(nodes.map(n => n.id));
  const shown = edges.filter(e => ids.has(e.fromId) && ids.has(e.toId));
  const point = (e: React.PointerEvent) => {
    const p = svg.current!.createSVGPoint(); p.x = e.clientX; p.y = e.clientY;
    const v = p.matrixTransform(svg.current!.getScreenCTM()!.inverse());
    return { x: Math.round(Math.min(MAP_W - 20, Math.max(20, v.x))), y: Math.round(Math.min(MAP_H - 20, Math.max(20, v.y))) };
  };
  const pin = (next: Positions) => { setPinned(next); try { localStorage.setItem(storeKey, JSON.stringify(next)); } catch { /* private mode */ } };

  return (
    <div className="map-tab">
      <div className="row">
        <select value={kind} onChange={e => setKind(e.target.value)} aria-label="Kind"><option value="">All kinds</option>{KINDS.map(k => <option key={k}>{k}</option>)}</select>
        <span className="dim small">{nodes.length} records · {shown.length} connections{props.records.length > MAP_MAX && !kind ? ` · showing the first ${MAP_MAX}` : ""}. Drag to arrange; click to open. Dashed: not verified or corroborated.</span>
        <span className="grow" />
        {Object.keys(pinned).length > 0 && <button className="ghost" onClick={() => pin({})}>Re-arrange</button>}
        <button className="ghost" onClick={() => void data.saveText(`${props.investigation.title.slice(0, 60)} map.svg`, mapSvg(props.investigation.title, nodes, edges, pos, MAP_W, MAP_H)).then(p => props.flash(`Map saved to ${p.replace(/^.*\/(Downloads\/)/, "$1")}`, "ok"), e => props.flash(errorText(e), "warn"))}>Download SVG</button>
      </div>
      <svg ref={svg} className="map" viewBox={`0 0 ${MAP_W} ${MAP_H}`} role="img" aria-label="Connection map">
        <defs><marker id="map-arrow" markerWidth="8" markerHeight="8" refX="18" refY="4" orient="auto"><path d="M0 0 L8 4 L0 8" className="arrow" /></marker></defs>
        {shown.map(e => {
          const a = pos[e.fromId], b = pos[e.toId];
          const firm = e.status === "Verified" || e.status === "Corroborated";
          return (
            <g key={e.id} className="edge">
              <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} strokeDasharray={firm ? undefined : "5 4"} markerEnd="url(#map-arrow)" />
              <text x={(a.x + b.x) / 2} y={(a.y + b.y) / 2 - 5}>{e.label.length > 40 ? e.label.slice(0, 39) + "…" : e.label}</text>
            </g>
          );
        })}
        {nodes.map(n => {
          const p = pos[n.id];
          return (
            <g key={n.id} className={`node ${props.focus === n.id ? "sel" : ""}`} transform={`translate(${p.x},${p.y})`} tabIndex={0}
              onKeyDown={e => { if (e.key === "Enter") { props.onFocus(n.id); props.onTab("records"); } }}
              onPointerDown={e => { (e.target as Element).setPointerCapture(e.pointerId); setDrag({ id: n.id, pos: p, moved: false }); }}
              onPointerMove={e => { if (drag?.id === n.id) { const q = point(e); if (Math.abs(q.x - p.x) + Math.abs(q.y - p.y) > 3 || drag.moved) setDrag({ id: n.id, pos: q, moved: true }); } }}
              onPointerUp={() => {
                if (drag?.id !== n.id) return;
                if (drag.moved) pin({ ...pinned, [n.id]: drag.pos }); else { props.onFocus(n.id); props.onTab("records"); }
                setDrag(null);
              }}>
              <title>{`${n.title} · ${n.kind} · ${n.status}`}</title>
              <circle r={9} fill={KIND_COLORS[n.kind] ?? "#8C8272"} />
              <text y={24}>{n.title.length > 36 ? n.title.slice(0, 35) + "…" : n.title}</text>
            </g>
          );
        })}
      </svg>
      <div className="map-legend">{KINDS.filter(k => nodes.some(n => n.kind === k)).map(k => <span key={k}><i style={{ background: KIND_COLORS[k] }} />{k}</span>)}</div>
    </div>
  );
}

// ── Timeline ─────────────────────────────────────────────────────────────────

function TimelineTab(props: CaseViewProps & { records: RecordItem[] }) {
  const dated = props.records.filter(r => r.eventDate).sort((a, b) => a.eventDate!.localeCompare(b.eventDate!));
  const years = [...new Set(dated.map(r => r.eventDate!.slice(0, 4)))];
  if (!dated.length) return <div className="empty">Give records an event date to build the chronology.</div>;
  return (
    <div className="timeline-tab">
      {years.map(y => (
        <section key={y}>
          <h3>{y}</h3>
          <ol>
            {dated.filter(r => r.eventDate!.startsWith(y)).map(r => (
              <li key={r.id}>
                <time>{r.eventDate}</time>
                <i style={{ background: KIND_COLORS[r.kind] }} />
                <button className="link" onClick={() => { props.onFocus(r.id); props.onTab("records"); }}>{r.title}</button>
                <span className={`status ${r.status}`}>{r.status}</span>
                {r.notes && <p className="dim small">{r.notes.length > 240 ? r.notes.slice(0, 239) + "…" : r.notes}</p>}
              </li>
            ))}
          </ol>
        </section>
      ))}
    </div>
  );
}

// ── Review queue ─────────────────────────────────────────────────────────────

type IntakeDetail = {
  id: string; title: string; state: string; text: string; sourceLabel: string; sourceUrl: string; researcherNote?: string; createdAt: string;
  attachment?: { filename: string; size: number; sha256: string };
  draft: { summary: string; questions: string[]; records: { id: string; key: string; title: string; kind: string; notes: string; quote: string; matchId: string }[]; connections: { id: string; fromKey: string; toKey: string; label: string; quote: string }[] } | null;
  review?: { appliedBy?: string; humanReviewed?: boolean; at?: string } | null;
};
const STATE_LABEL: Record<string, string> = { captured: "Waiting for the agent", pending: "Staged: needs your review", filed: "Filed by the agent", approved: "Filed by you", rejected: "Rejected" };

function ReviewTab(props: CaseViewProps & { records: RecordItem[] }) {
  const [open, setOpen] = useState<string | null>(null);
  const agentFiled = props.records.filter(needsReview);
  const sorted = [...props.intakes].sort((a, b) => Number(b.state === "pending") - Number(a.state === "pending") || b.createdAt.localeCompare(a.createdAt));
  return (
    <div className="case-split">
      <div className="case-list">
        {agentFiled.length > 0 && (
          <button className="review-callout" onClick={() => props.onTab("records")}>
            <b>{agentFiled.length}</b> record{agentFiled.length === 1 ? "" : "s"} filed by the agent {agentFiled.length === 1 ? "is" : "are"} not reviewed yet. Open Records and tick "Needs review".
          </button>
        )}
        <div className="dp-section">Captures</div>
        <ul className="record-list">
          {sorted.map(i => (
            <li key={i.id}>
              <button className={`record-item ${open === i.id ? "sel" : ""}`} onClick={() => setOpen(i.id)}>
                <span className={`state ${i.state}`}>{STATE_LABEL[i.state] ?? i.state}</span>
                <span className="record-title">{i.title}</span>
              </button>
            </li>
          ))}
          {!sorted.length && <li className="empty">Captures appear here: waiting for the agent, staged for your review, or filed.</li>}
        </ul>
      </div>
      <div className="case-detail">
        {open ? <IntakeReview key={open} {...props} intakeId={open} /> : <div className="empty">Select a capture to see its source text and what was filed from it. Staged captures wait here for you to choose what enters the case.</div>}
      </div>
    </div>
  );
}

function IntakeReview(props: CaseViewProps & { intakeId: string; records: RecordItem[] }) {
  const [item, setItem] = useState<IntakeDetail | null>(null);
  const [error, setError] = useState("");
  const [pick, setPick] = useState<Record<string, boolean>>({});
  const [reuse, setReuse] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const titles = useMemo(() => new Map(props.records.map(r => [r.id, r.title])), [props.records]);
  const summary = props.intakes.find(i => i.id === props.intakeId);

  const load = () => data.intake(props.intakeId).then(v => {
    const d = v as unknown as IntakeDetail;
    setItem(d);
    setPick(Object.fromEntries([...(d.draft?.records ?? []).map(r => [r.id, true]), ...(d.draft?.connections ?? []).map(c => [c.id, true])]));
    setReuse(Object.fromEntries((d.draft?.records ?? []).filter(r => r.matchId).map(r => [r.id, r.matchId])));
  }).catch(e => setError(errorText(e)));
  useEffect(() => { void load(); }, [props.intakeId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (error) return <div className="warn">{error}</div>;
  if (!item) return <div className="dim">Loading…</div>;
  const d = item.draft;
  const keyOf = new Map((d?.records ?? []).map(r => [r.key, r.id]));
  const connectionOk = (c: { fromKey: string; toKey: string }) => !!pick[keyOf.get(c.fromKey) ?? ""] && !!pick[keyOf.get(c.toKey) ?? ""];
  const decide = async (reject: boolean) => {
    if (!d) return;
    setBusy(true);
    try {
      await data.reviewIntake(item.id, reject ? { reject: true } : {
        records: d.records.filter(r => pick[r.id]).map(r => ({ id: r.id, ...(reuse[r.id] ? { reuseId: reuse[r.id] } : {}) })),
        connections: d.connections.filter(c => pick[c.id] && connectionOk(c)).map(c => ({ id: c.id })),
      });
      await props.onChanged();
      await load();
      props.flash(reject ? "Capture rejected. The original and the draft stay in its history." : "Filed into the case. You are recorded as the reviewer.", "ok");
    } catch (e) { props.flash(errorText(e), "warn"); } finally { setBusy(false); }
  };

  return (
    <div className="record-editor">
      <div className="row wrap"><span className={`state ${item.state}`}>{STATE_LABEL[item.state] ?? item.state}</span><span className="grow" /><span className="dim small">{when(item.createdAt)}</span></div>
      <h3 className="intake-title">{item.title}</h3>
      <div className="small">{item.sourceUrl ? <button className="link" onClick={() => props.onOpen(item.sourceUrl)}>{item.sourceLabel || item.sourceUrl}</button> : item.sourceLabel}</div>
      {item.researcherNote && <div className="note">“{item.researcherNote}”</div>}
      {item.state === "captured" && summary && <button className="mini" onClick={() => props.onSendToAgent(summary)}>Send to the agent</button>}
      {d && (
        <>
          <div className="dp-section">{item.state === "pending" ? "Proposed: choose what enters the case" : "Extraction"}</div>
          <p className="small">{d.summary}</p>
          <ul className="proposals">
            {d.records.map(r => (
              <li key={r.id}>
                <label className="check">
                  <input type="checkbox" disabled={item.state !== "pending"} checked={!!pick[r.id]} onChange={e => setPick(p => ({ ...p, [r.id]: e.target.checked }))} />
                  <i style={{ background: KIND_COLORS[r.kind] }} /> <b>{r.title}</b> <span className="dim">{r.kind}</span>
                </label>
                {item.state === "pending" && r.matchId && (
                  <select className="small" value={reuse[r.id] ?? ""} onChange={e => setReuse(x => ({ ...x, [r.id]: e.target.value }))}>
                    <option value={r.matchId}>Same as existing “{titles.get(r.matchId) ?? "record"}”</option>
                    <option value="">Keep as a separate record</option>
                  </select>
                )}
                <blockquote className="small">{r.quote}</blockquote>
              </li>
            ))}
            {d.connections.map(c => (
              <li key={c.id}>
                <label className="check">
                  <input type="checkbox" disabled={item.state !== "pending" || !connectionOk(c)} checked={!!pick[c.id] && connectionOk(c)} onChange={e => setPick(p => ({ ...p, [c.id]: e.target.checked }))} />
                  {d.records.find(r => r.key === c.fromKey)?.title} → <em>{c.label}</em> → {d.records.find(r => r.key === c.toKey)?.title}
                </label>
              </li>
            ))}
          </ul>
          {d.questions?.length > 0 && <><div className="dp-section">Open questions</div><ul className="small">{d.questions.map((q, i) => <li key={i}>{q}</li>)}</ul></>}
          {item.state === "pending" && (
            <div className="row">
              <button className="primary" disabled={busy || !d.records.some(r => pick[r.id])} onClick={() => void decide(false)}>File selected</button>
              <button className="ghost" disabled={busy} onClick={() => void decide(true)}>Reject</button>
            </div>
          )}
        </>
      )}
      {(item.state === "filed" || item.state === "approved") && (
        <div className="small">Records from this capture: {props.records.filter(r => r.intakeId === item.id).map(r => <button key={r.id} className="link" onClick={() => { props.onFocus(r.id); props.onTab("records"); }}>{r.title}</button>).reduce<React.ReactNode[]>((acc, el, i) => (i ? [...acc, ", ", el] : [el]), [])}</div>
      )}
      <details className="captured-source">
        <summary>Captured source text</summary>
        <pre>{item.text || "No text: the attached file is preserved for reference."}</pre>
        {item.attachment && <div className="mono small dim">{item.attachment.filename} · SHA-256 {item.attachment.sha256}</div>}
      </details>
    </div>
  );
}

// ── Export ───────────────────────────────────────────────────────────────────

function ExportTab(props: CaseViewProps & { records: RecordItem[]; connections: Connection[] }) {
  const selected = props.records.filter(r => r.public);
  const ids = new Set(selected.map(r => r.id));
  const links = props.connections.filter(c => c.public && ids.has(c.fromId) && ids.has(c.toId) && (!c.evidenceId || ids.has(c.evidenceId)));
  const [busy, setBusy] = useState(false);
  const unreviewed = selected.filter(r => !r.reviewedAt).length;
  const exportAs = async (scope: "selected" | "all") => {
    setBusy(true);
    try { const p = await data.exportCase(props.investigation, scope); props.flash(`Saved to ${p.replace(/^.*\/(Downloads\/)/, "$1")}`, "ok"); }
    catch (e) { props.flash(errorText(e), "warn"); }
    finally { setBusy(false); }
  };
  const include = async (r: RecordItem, on: boolean) => {
    try { await data.updateRecord(r.id, { public: on }); await props.onChanged(); } catch (e) { props.flash(errorText(e), "warn"); }
  };
  return (
    <div className="export-tab">
      <p>A presentation export is a ZIP you can share: an offline HTML dossier, the connection map as SVG, CSV and JSON tables, and the original evidence files of the <b>selected</b> records. A connection is included when it is selected and both its records (and its evidence) are.</p>
      <div className="row wrap">
        <button className="primary" disabled={busy || !selected.length} onClick={() => void exportAs("selected")}>Export presentation ({selected.length} records, {links.length} connections)</button>
        <button className="ghost" disabled={busy} onClick={() => void exportAs("all")}>Export entire case</button>
      </div>
      {unreviewed > 0 && <p className="warn small">{unreviewed} selected record{unreviewed === 1 ? " has" : "s have"} not been reviewed.</p>}
      <p className="dim small">Selection does not redact text, files or their embedded metadata. Check the extracted dossier before you share it. The full export includes research-only material.</p>
      <div className="dp-section">Records in the presentation</div>
      <ul className="record-list">
        {props.records.map(r => (
          <li key={r.id} className="row">
            <label className="check small grow"><input type="checkbox" checked={!!r.public} onChange={e => void include(r, e.target.checked)} /> {r.title}</label>
            <span className={`status ${r.status}`}>{r.status}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
