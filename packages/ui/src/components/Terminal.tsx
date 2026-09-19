// Agent terminal: xterm.js on a real PTY (Claude Code, Codex or a shell) in the
// hvnt33 workspace. Adapted from LoreKit Studio's Terminal component.
import { useEffect, useImperativeHandle, useRef, useState, type ReactNode, type Ref } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { hasNative, onWindows, pathForFile, pty, type Provider } from "../lib/native";
import { terminalPath } from "../lib/capture";

export interface TerminalHandle {
  /** Type a message into the agent and submit it. Returns false when no session is running. */
  send(text: string): boolean;
  /** Add text to the agent's message without sending it (captures, dropped files). Returns false when no session is running. */
  insert(text: string): boolean;
  focus(): void;
  running(): boolean;
}

// Black marble with ivory text and gold, as the brand sets command blocks.
const THEME = {
  background: "#1D1A16",
  foreground: "#ECE6D8",
  cursor: "#D0A75A",
  cursorAccent: "#1D1A16",
  selectionBackground: "#4A4236",
  black: "#2A2621", brightBlack: "#857760",
  red: "#E2664F", green: "#9CB57E", yellow: "#D0A75A", blue: "#8FB3D9", magenta: "#C99BB6", cyan: "#86BFB2", white: "#D9D2C3",
  brightRed: "#EF8672", brightGreen: "#B3C999", brightYellow: "#E3BF76", brightBlue: "#A9C6E6", brightMagenta: "#DBB2CB", brightCyan: "#A3D2C6", brightWhite: "#F4EFE4",
};
const PROVIDER_KEY = "hvnt33.terminal.provider";

/** `controls`: buttons for the panel (size and placement), shown at the end of the header. */
export function AgentTerminal({ handle, onStatus, controls }: { handle: Ref<TerminalHandle>; onStatus?: (s: string) => void; controls?: ReactNode }) {
  const container = useRef<HTMLDivElement>(null);
  const session = useRef<string | null>(null);
  const term = useRef<XTerm | null>(null);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [provider, setProvider] = useState(() => localStorage.getItem(PROVIDER_KEY) || "claude");
  const [launch, setLaunch] = useState({ n: 0, resume: false });
  const [status, setStatus] = useState<"idle" | "starting" | "running" | "exited" | "error">("idle");

  useEffect(() => { onStatus?.(status); }, [status, onStatus]);
  useEffect(() => { if (hasNative()) pty.providers().then(setProviders).catch(() => setProviders([])); }, []);

  useImperativeHandle(handle, () => ({
    send(text: string) {
      const id = session.current;
      if (!id || !term.current) return false;
      // Bracketed paste keeps the message as one prompt; the separate CR submits it.
      term.current.paste(text);
      setTimeout(() => { void pty.write(id, "\r").catch(() => {}); }, 120);
      return true;
    },
    insert(text: string) {
      if (!session.current || !term.current) return false;
      term.current.paste(text);
      return true;
    },
    focus: () => term.current?.focus(),
    running: () => !!session.current,
  }), []);

  useEffect(() => {
    if (!hasNative() || !container.current) return;
    let cancelled = false;
    const cleanups: (() => void)[] = [];
    const xterm = new XTerm({
      theme: THEME,
      fontFamily: "'IBM Plex Mono', ui-monospace, Menlo, monospace",
      fontSize: 12.5,
      lineHeight: 1.1,
      cursorBlink: true,
      allowProposedApi: true,
      scrollback: 10_000,
      macOptionIsMeta: true,
    });
    term.current = xterm;
    const fit = new FitAddon();
    xterm.loadAddon(fit);
    xterm.open(container.current);
    xterm.attachCustomKeyEventHandler(e => {
      // Shift+Enter inserts a newline in Claude Code and Codex instead of submitting.
      if (e.type === "keydown" && e.key === "Enter" && e.shiftKey && session.current) {
        void pty.write(session.current, "\x1b\r");
        e.preventDefault();
        return false;
      }
      if (e.type === "keydown" && e.metaKey && e.key === "c" && xterm.hasSelection()) {
        void navigator.clipboard.writeText(xterm.getSelection());
        return false;
      }
      return true;
    });
    // A minimized panel keeps the session at its last size rather than squeezing it to a row.
    const safeFit = () => {
      const el = container.current;
      if (!el || el.clientWidth < 40 || el.clientHeight < 40) return false;
      try { fit.fit(); return true; } catch { return false; /* not visible */ }
    };

    (async () => {
      setStatus("starting");
      try {
        const { WebglAddon } = await import("@xterm/addon-webgl");
        const gl = new WebglAddon();
        gl.onContextLoss(() => gl.dispose());
        xterm.loadAddon(gl);
      } catch { /* DOM renderer fallback */ }
      safeFit();
      if (cancelled) return;
      let id: string;
      try {
        id = await pty.spawn(provider, launch.resume, xterm.cols, xterm.rows);
      } catch (err) {
        if (cancelled) return;
        setStatus("error");
        xterm.writeln(`\x1b[31m${String(err)}\x1b[0m`);
        xterm.writeln(/hvnt33 folder/.test(String(err))
          ? "\x1b[90mThe agent works in your HVNT33 folder: choose it in the panel above, then press Start new.\x1b[0m"
          : "\x1b[90mChoose another agent above, or install it and press Start.\x1b[0m");
        return;
      }
      if (cancelled) { void pty.kill(id); return; }
      session.current = id;
      const off1 = await pty.onOutput(id, data => xterm.write(data));
      const off2 = await pty.onExit(id, code => {
        session.current = null;
        setStatus("exited");
        xterm.writeln(`\r\n\x1b[90m[session ended${code != null ? `, code ${code}` : ""}]\x1b[0m`);
      });
      cleanups.push(off1, off2);
      setStatus("running");
    })();

    const onData = xterm.onData(data => { if (session.current) void pty.write(session.current, data).catch(() => {}); });
    const ro = new ResizeObserver(() => {
      if (safeFit() && session.current) void pty.resize(session.current, xterm.cols, xterm.rows).catch(() => {});
    });
    ro.observe(container.current);

    return () => {
      cancelled = true;
      onData.dispose();
      ro.disconnect();
      cleanups.forEach(c => c());
      if (session.current) void pty.kill(session.current).catch(() => {});
      session.current = null;
      xterm.dispose();
      term.current = null;
    };
  }, [provider, launch]);

  // Drop files (from the Finder, the desktop, anywhere) or links and images from a page onto the
  // terminal: their paths or addresses go into the agent's message, for it to read or attach.
  const [dropping, setDropping] = useState(false);
  const onDragOver = (e: React.DragEvent) => { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; setDropping(true); };
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDropping(false);
    const id = session.current;
    if (!id || !term.current) return;
    const files = [...e.dataTransfer.files].map(pathForFile).filter(Boolean);
    const links = files.length ? [] : (e.dataTransfer.getData("text/uri-list") || e.dataTransfer.getData("text/plain")).split(/\r?\n/).map(s => s.trim()).filter(s => /^https?:\/\//.test(s));
    const refs = files.length ? files.map(p => terminalPath(p, onWindows())) : links;
    if (!refs.length) return;
    term.current.paste(refs.join(" ") + " ");
    term.current.focus();
  };

  const choose = (p: string) => { localStorage.setItem(PROVIDER_KEY, p); setProvider(p); setLaunch(l => ({ n: l.n + 1, resume: false })); };
  const known = providers.length ? providers : [{ provider: "claude", label: "Claude Code" }, { provider: "codex", label: "Codex" }, { provider: "shell", label: "Shell" }];

  return (
    <div className={`terminal ${dropping ? "dropping" : ""}`} onDragOver={onDragOver} onDragLeave={() => setDropping(false)} onDrop={onDrop}>
      <div className="pane-head">
        <div className="seg">
          {known.map(p => (
            <button key={p.provider} className={p.provider === provider ? "on" : ""} onClick={() => choose(p.provider)} title={"command" in p ? String(p.command) : ""}>{p.label}</button>
          ))}
        </div>
        <span className={`dot ${status}`} title={status} />
        <span className="grow" />
        {status === "running"
          ? <button className="ghost" onClick={() => setLaunch(l => ({ n: l.n + 1, resume: false }))} title="End this conversation and start a new one">New session</button>
          : <>
              <button className="ghost" onClick={() => setLaunch(l => ({ n: l.n + 1, resume: true }))} title="Continue the most recent conversation in this workspace">Continue last</button>
              <button className="ghost" onClick={() => setLaunch(l => ({ n: l.n + 1, resume: false }))}>Start new</button>
            </>}
        {controls}
      </div>
      {!hasNative() && <div className="empty">The agent terminal runs inside the desktop app.</div>}
      <div ref={container} className="xterm-host" />
    </div>
  );
}
