// Browser profiles: whether the current case browses with its own cookies and
// logins or the shared profile, and clearing browsing data. Research (cases,
// captures, snapshots) is never touched by anything here.
import { useEffect, useState } from "react";
import type { CaseNetwork } from "@hvnt33/core/events";
import type { ProfileChoice } from "../lib/tabs";
import type { Exit } from "../lib/native";
import type { NetworkChange } from "../lib/data";

export interface NetView { status: "direct" | "checking" | "ok" | "paused"; exit?: Exit; message?: string; checkedAt?: string }

export function BrowsingPanel(props: {
  caseTitle: string | null;
  caseId: string | null;
  choice: ProfileChoice;
  onChoose: (choice: ProfileChoice) => void;
  onClear: (profile: string) => Promise<void>;
  onClose: () => void;
  network: CaseNetwork;
  net: NetView;
  onSaveNetwork: (network: NetworkChange) => Promise<void>;
  onToggleTor: () => void;
  onNewExit: () => void;
  onCheck: () => void;
  /** Routes need a local server (a proxy address is on the server's network). */
  routesAvailable: boolean;
}) {
  const [confirm, setConfirm] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async (key: string, fn: () => Promise<void>) => {
    if (confirm !== key) { setConfirm(key); return; }
    setBusy(true);
    try { await fn(); } finally { setBusy(false); setConfirm(null); }
  };
  const own = props.caseId && props.choice === "own";
  const tor = !!props.network.tor;
  const [route, setRoute] = useState(tor ? "" : props.network.route);
  const [label, setLabel] = useState(tor ? "" : props.network.label);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { setRoute(tor ? "" : props.network.route); setLabel(tor ? "" : props.network.label); setUsername(""); setPassword(""); }, [props.network.route, props.network.label, tor]);
  const changed = !tor && (route.trim() !== props.network.route || label.trim() !== props.network.label || !!username);
  const save = async (network: NetworkChange) => {
    setSaving(true); setError("");
    try { await props.onSaveNetwork(network); } catch (e) { setError(String(e).replace(/^Error: /, "")); } finally { setSaving(false); }
  };
  const exit = props.net.exit;
  const lock = props.network.lock;

  return (
    <div className="connection-panel browsing-panel">
      <div className="row"><b>Connection and profile</b><span className="grow" /><button className="x" onClick={props.onClose} aria-label="Close">×</button></div>
      {props.caseId && !props.routesAvailable && (
        <p className="small dim">Per-case routes need a local server: a hosted server's snapshots leave from its own network. Your VPN app still protects this Mac's browsing, and the exit lock below still works.</p>
      )}
      {props.caseId && props.routesAvailable && (
        <div className="field">
          <span>Tor</span>
          <div className="row">
            <button className={tor ? "primary" : "ghost"} onClick={props.onToggleTor}>{tor ? "Tor is on for this case" : "Use Tor for this case"}</button>
            {tor && <button className="ghost" onClick={props.onNewExit} title="A new Tor circuit, and a new exit IP, for this case. Cookies and logins stay.">New exit</button>}
          </div>
          <span className="dim small">{tor ? `Through ${props.network.label}, on this case's own circuit (other cases on Tor leave from other exits).` : "Tor is built in: it starts when you turn it on for a case (a few seconds; longer the first time) and stops when no case uses it."}</span>
        </div>
      )}
      {props.caseId && props.routesAvailable && !tor && (
        <div className="field">
          <span>Or through a proxy</span>
          <div className="row">
            <input className="grow" value={route} onChange={e => setRoute(e.target.value)} placeholder="Direct, or socks5://host:port or http://host:port" aria-label="Proxy address" />
            <input value={label} onChange={e => setLabel(e.target.value)} placeholder="Name, e.g. Mullvad SE" aria-label="Route name" style={{ width: 140 }} />
          </div>
          {route.trim() && (
            <div className="row">
              <input className="grow" value={username} onChange={e => setUsername(e.target.value)} placeholder={props.network.hasCredentials && route.trim() === props.network.route ? "Login saved (enter a new one to replace it)" : "Username, if the proxy needs one"} aria-label="Proxy username" autoComplete="off" />
              <input className="grow" type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Password" aria-label="Proxy password" autoComplete="off" />
            </div>
          )}
          <div className="row">
            {changed && <button className="primary" disabled={saving} onClick={() => void save({ route: route.trim(), label: label.trim(), lock: null, ...(username ? { credentials: { username: username.trim(), password } } : {}) })}>{saving ? "Connecting…" : route.trim() ? "Use this proxy" : "Connect directly"}</button>}
            {props.network.hasCredentials && !changed && <button className="link small" disabled={saving} onClick={() => void save({ route: props.network.route, label: props.network.label, lock: props.network.lock, credentials: null })}>Forget the saved login</button>}
          </div>
          <span className="dim small">A route sends this case's tabs, snapshots, watches and archive lookups through it, and gives the case its own profile. Nothing falls back to a direct connection if it is down. A proxy's login is kept on this Mac only, never in the case, exports or backups.</span>
          {error && <span className="warn small">{error}</span>}
        </div>
      )}
      {props.caseId && (
        <div className="field">
          <span>Exit</span>
          <div className={`exit-card ${props.net.status}`}>
            {props.net.status === "paused" ? <b className="warn">Paused: {props.net.message}</b>
              : exit ? <b>{[exit.city, exit.country].filter(Boolean).join(", ")} · {exit.org || "unknown network"}{exit.vpn ? ` · ${exit.vpn}` : ""}</b>
              : <span className="dim">{props.net.status === "checking" ? "Checking…" : "Not checked (direct, no lock)"}</span>}
            <button className="link small" onClick={props.onCheck}>Check now</button>
          </div>
          {exit && !lock && <button className="ghost" disabled={saving} onClick={() => void save({ ...props.network, lock: { country: exit.country, org: exit.org } })} title="Pause this case whenever its exit leaves this country or network, e.g. when the VPN drops">Lock this case to {exit.country} · {exit.org}</button>}
          {lock && <div className="row small"><span>Locked to {[lock.country, lock.org].filter(Boolean).join(" · ")}</span><span className="grow" /><button className="link" disabled={saving} onClick={() => void save({ ...props.network, lock: null })}>Unlock</button></div>}
          <span className="dim small">The exit is checked with am.i.mullvad.net through the route: where you appear to be, not who you are. Logged-in accounts and browser fingerprinting can still identify you; this is not Tor Browser.</span>
        </div>
      )}
      <p className="dim small">A profile holds the cookies, logins and site data of the pages you browse. Your research is never affected.</p>
      {props.caseId ? (
        <div className="field">
          <span>{props.caseTitle ?? "This case"} browses in</span>
          <label className="check" title={props.network.route ? "A case with a route always uses its own profile" : ""}><input type="radio" name="profile" disabled={!!props.network.route} checked={props.choice !== "own"} onChange={() => props.onChoose("shared")} /> the shared profile (logins shared with other cases)</label>
          <label className="check"><input type="radio" name="profile" checked={props.choice === "own"} onChange={() => props.onChoose("own")} /> its own profile (separate logins, e.g. a research account)</label>
          <span className="dim small">Changing it reopens this case's tabs in that profile.</span>
        </div>
      ) : (
        <p className="small">No case is open: tabs use the shared profile.</p>
      )}
      <div className="field">
        <span>Clear browsing data</span>
        {own && (
          <button className="ghost" disabled={busy} onClick={() => void run("case", () => props.onClear(props.caseId!))}>
            {confirm === "case" ? "Click again to sign out of everything in this case" : "Clear this case's profile"}
          </button>
        )}
        <button className="ghost" disabled={busy} onClick={() => void run("shared", () => props.onClear("shared"))}>
          {confirm === "shared" ? "Click again to sign out of everything in the shared profile" : "Clear the shared profile"}
        </button>
        <span className="dim small">Open tabs are reopened afterwards, signed out.</span>
      </div>
    </div>
  );
}
