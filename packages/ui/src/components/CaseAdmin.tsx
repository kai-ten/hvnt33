import { useEffect, useState } from "react";
import type { Investigation } from "@hvnt33/core/events";
import type { ProfileChoice } from "../lib/tabs";

export function CaseAdmin(props: {
  cases: Investigation[];
  archived: Investigation[];
  caseId: string | null;
  mode: "list" | "create";
  profileOf: (id: string) => ProfileChoice;
  onSelect: (id: string) => void;
  onCreate: (title: string, question: string, ownProfile: boolean) => Promise<void>;
  onArchive: (id: string) => Promise<void>;
  onRestore: (id: string) => Promise<void>;
  onCancelCreate: () => void;
}) {
  const [title, setTitle] = useState("");
  const [question, setQuestion] = useState("");
  const [own, setOwn] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmArchive, setConfirmArchive] = useState<string | null>(null);
  const [changing, setChanging] = useState<string | null>(null);
  useEffect(() => { if (props.mode === "create") { setTitle(""); setQuestion(""); setOwn(true); setError(""); } }, [props.mode]);

  const create = async () => {
    if (!title.trim()) return;
    setBusy(true); setError("");
    try { await props.onCreate(title.trim(), question.trim(), own); }
    catch (e) { setError(String(e).replace(/^Error: /, "")); }
    finally { setBusy(false); }
  };

  return (
    <div className="case-admin">
      <header className="case-admin-head">
        <div><h1>{props.mode === "create" ? "Open an investigation" : "Investigations"}</h1></div>
        {props.mode === "list" && <button className="primary" onClick={props.onCancelCreate}>+ New investigation</button>}
      </header>
      {props.mode === "create" ? (
        <section className="case-create-card">
          <p className="case-lede">Give the work a clear boundary. Searches, browsing history, captures, records, routes and restored tabs will be associated with this investigation.</p>
          <label className="field"><span>Investigation</span><input autoFocus value={title} onChange={e => setTitle(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && title.trim()) void create(); }} placeholder="What are you investigating?" maxLength={200} /></label>
          <label className="field"><span>Research question or context</span><textarea value={question} onChange={e => setQuestion(e.target.value)} rows={5} placeholder="What do you want to establish? What is in and out of scope?" maxLength={10000} /></label>
          <label className="profile-choice">
            <input type="checkbox" checked={own} onChange={e => setOwn(e.target.checked)} />
            <span><b>Use an isolated browser profile</b><small>Separate cookies, logins, storage, route and Tor circuit. Recommended for investigative separation.</small></span>
          </label>
          {error && <div className="lab-error">{error}</div>}
          <div className="row"><button className="primary" disabled={busy || !title.trim()} onClick={() => void create()}>{busy ? "Creating…" : "Create investigation"}</button><button className="ghost" disabled={busy} onClick={props.onCancelCreate}>Cancel</button></div>
        </section>
      ) : (
        <div className="case-admin-grid">
          {props.cases.map(c => {
            const selected = c.id === props.caseId;
            const isolated = props.profileOf(c.id) === "own";
            return (
              <article key={c.id} className={`case-card ${selected ? "selected" : ""}`}>
                <div className="row"><span className="case-state">{selected ? "Current" : "Investigation"}</span><span className="grow" /><span className="mono dim">{new Date(c.createdAt).toLocaleDateString()}</span></div>
                <h2>{c.title}</h2>
                <p>{c.description || "No research question recorded."}</p>
                <div className="case-card-meta"><span>{isolated ? "Isolated browser profile" : "Shared browser profile"}</span><span>{c.network?.tor ? "Tor" : c.network?.label || (c.network?.route ? "Routed" : "Direct")}</span></div>
                <div className="case-card-actions">
                  <button className={selected ? "ghost" : "primary"} onClick={() => props.onSelect(c.id)}>{selected ? "Open current case" : "Switch and open"}</button>
                  {confirmArchive === c.id ? <><span className="small warn">Research and evidence are retained.</span><button className="danger" disabled={changing === c.id} onClick={() => { setChanging(c.id); void props.onArchive(c.id).catch(e => setError(String(e))).finally(() => setChanging(null)); }}>{changing === c.id ? "Archiving…" : "Confirm archive"}</button><button className="ghost" onClick={() => setConfirmArchive(null)}>Cancel</button></> : <button className="ghost" onClick={() => setConfirmArchive(c.id)}>Archive…</button>}
                </div>
              </article>
            );
          })}
          {!props.cases.length && <div className="empty">No investigations yet. Open one to start collecting.</div>}
        </div>
      )}
      {props.mode === "list" && props.archived.length > 0 && (
        <section className="archived-cases">
          <h2>Archived</h2>
          <p>Archived investigations are hidden from browsing and filing, but all research and evidence remain stored.</p>
          {props.archived.map(c => <div className="archived-row" key={c.id}><span><b>{c.title}</b><small>Archived {c.deletedAt ? new Date(c.deletedAt).toLocaleString() : ""}</small></span><button className="ghost" disabled={changing === c.id} onClick={() => { setChanging(c.id); void props.onRestore(c.id).catch(e => setError(String(e))).finally(() => setChanging(null)); }}>{changing === c.id ? "Restoring…" : "Restore"}</button></div>)}
        </section>
      )}
      {props.mode === "list" && error && <div className="lab-error case-admin-error">{error}</div>}
    </div>
  );
}
