import { useEffect, useRef, useState } from "react";
import type { Investigation } from "@hvnt33/core/events";

export function CaseSwitcher(props: {
  cases: Investigation[];
  caseId: string | null;
  workspaceName: string;
  workspaceKind: "local" | "cloud";
  connected: boolean;
  placement?: "header" | "page";
  onSelect: (id: string) => void;
  onCreate: () => void;
  onManage: () => void;
  onWorkspace: () => void;
  onCloud: () => void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const current = props.cases.find(c => c.id === props.caseId);

  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    const escape = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", close); document.removeEventListener("keydown", escape); };
  }, [open]);

  const act = (fn: () => void) => { setOpen(false); fn(); };
  return (
    <div className={`case-switcher ${props.placement === "page" ? "page" : "header"} ${open ? "open" : ""}`} ref={root}>
      <button className="case-switcher-button" onClick={() => setOpen(v => !v)} aria-haspopup="menu" aria-expanded={open}>
        <span className="case-current">{current?.title ?? "Choose an investigation"}</span>
        <span className="case-chevron" aria-hidden="true">⌄</span>
      </button>
      {open && (
        <div className="case-menu" role="menu">
          <div className="case-menu-head">
            <span>Investigations</span>
            <button onClick={() => act(props.onManage)}>Manage</button>
          </div>
          <div className="case-menu-list">
            {props.cases.map(c => (
              <button key={c.id} role="menuitemradio" aria-checked={c.id === props.caseId} className={c.id === props.caseId ? "selected" : ""} onClick={() => act(() => props.onSelect(c.id))}>
                <span className="case-check">{c.id === props.caseId ? "✓" : ""}</span>
                <span><b>{c.title}</b>{c.description && <small>{c.description}</small>}</span>
              </button>
            ))}
            {!props.cases.length && <div className="case-menu-empty">No investigations yet.</div>}
          </div>
          <button className="case-menu-new" role="menuitem" onClick={() => act(props.onCreate)}><span>＋</span> New investigation</button>
          <div className="case-menu-workspace">
            <span className="case-menu-label">Workspace</span>
            <button className="workspace-option selected" onClick={() => act(props.onWorkspace)}>
              <i className={props.connected ? "online" : ""} />
              <span><b>{props.workspaceName}</b><small>{props.workspaceKind === "local" ? "Database and agent on this computer" : "Connected cloud workspace"}</small></span>
              <span className="case-check">✓</span>
            </button>
            {props.workspaceKind === "local" && <button className="workspace-option" onClick={() => act(props.onCloud)}>
              <i className="cloud" />
              <span><b>HVNT33 Cloud</b><small>Open the website</small></span>
              <span aria-hidden="true">↗</span>
            </button>}
          </div>
        </div>
      )}
    </div>
  );
}
