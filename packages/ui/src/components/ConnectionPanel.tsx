// Which server this app uses: the local one in this workspace, or a hosted
// hvnt33 reached with an API token (kept in the macOS Keychain).
import { useEffect, useState } from "react";
import { connection, type ConnectionInfo } from "../lib/native";

export function ConnectionPanel({ onChanged, onClose }: { onChanged: () => void; onClose: () => void }) {
  const [current, setCurrent] = useState<ConnectionInfo | null>(null);
  const [url, setUrl] = useState("");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");

  useEffect(() => {
    void connection.get().then(c => { setCurrent(c); setUrl(c.url); });
  }, []);

  const save = async () => {
    setBusy(true); setError(""); setSaved("");
    try {
      const c = await connection.set(url, token);
      setCurrent(c); setToken("");
      setSaved(c.workspace ? `Connected to workspace “${c.workspace.name}” (${c.workspace.plan} plan).` : "Connected.");
      onChanged();
    } catch (e) {
      setError(String(e).replace(/^Error: /, ""));
    } finally { setBusy(false); }
  };
  const reset = async () => {
    setBusy(true); setError(""); setSaved("");
    try { const c = await connection.reset(); setCurrent(c); setUrl(""); setToken(""); setSaved("Using the local server in this workspace."); onChanged(); }
    catch (e) { setError(String(e)); } finally { setBusy(false); }
  };

  return (
    <form className="connection-panel" onSubmit={e => { e.preventDefault(); void save(); }}>
      <div className="capture-head">
        <b>Server</b>
        <span className="grow" />
        <button type="button" className="x" onClick={onClose} aria-label="Close">×</button>
      </div>
      <p className="dim small">
        {current?.url ? <>Using <b>{current.url}</b>{current.hasToken ? " with an API token" : ""}.</> : <>Using the local server in this workspace.</>}
      </p>
      <label className="field">Server address
        <input value={url} onChange={e => setUrl(e.target.value)} placeholder="https://hvnt33.example.org (empty for local)" spellCheck={false} />
      </label>
      <label className="field">API token
        <input value={token} onChange={e => setToken(e.target.value)} placeholder={current?.hasToken ? "Stored in the Keychain · enter a new one to replace" : "h33_… (hosted servers)"} type="password" autoComplete="off" />
      </label>
      {error && <div className="lab-error">{error}</div>}
      {saved && <div className="ok small">{saved}</div>}
      <div className="row-actions">
        <button className="primary" disabled={busy || !url.trim()}>{busy ? "Checking…" : "Connect"}</button>
        {current?.url && <button type="button" className="ghost" disabled={busy} onClick={() => void reset()}>Use local server</button>}
      </div>
      <p className="dim small">The token never enters this window's web content: it stays in the Keychain and is added to requests by the app.</p>
    </form>
  );
}
