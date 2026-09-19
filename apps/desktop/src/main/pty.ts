// Agent terminal: a real pseudo-terminal (node-pty) running Claude Code, Codex
// or the login shell in the hvnt33 workspace. The app picks a provider from a
// fixed allowlist; it cannot choose the command or the working directory.
// Browsed pages never reach this module.
//
// Events to the app view: `pty:output:<id>` { sessionId, data } and
// `pty:exit:<id>` { sessionId, code }.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import * as nodePty from "node-pty";
import { command, emit } from "./ipc.ts";
import { isAgentSessionMarker } from "./policy.ts";
import { baseUrl } from "./server.ts";
import { agentWorkspace } from "./workspace.ts";

interface AgentCommand { provider: string; command: string; args: string[]; label: string }

const sessions = new Map<string, nodePty.IPty>();
const windows = process.platform === "win32";

function onPath(name: string): string | null {
  const exts = windows ? (process.env.PATHEXT ?? ".EXE;.CMD;.BAT").split(";").map(e => e.toLowerCase()) : [""];
  for (const dir of (process.env.PATH ?? "").split(path.delimiter).filter(Boolean)) {
    for (const ext of exts) {
      const candidate = path.join(dir, name + ext);
      try { if (fs.statSync(candidate).isFile()) return candidate; } catch { /* not here */ }
    }
  }
  return null;
}

/** Resolve an allowlisted provider to a concrete command. */
export function resolve(provider: unknown, resume: boolean): AgentCommand {
  const home = os.homedir();
  switch (provider) {
    case "claude": {
      const cmd = onPath("claude") ?? [path.join(home, ".claude", "local", "claude"), path.join(home, ".local", "bin", windows ? "claude.exe" : "claude")].find(p => fs.existsSync(p));
      if (!cmd) throw new Error("Claude Code is not installed or not on PATH");
      return { provider, command: cmd, args: resume ? ["--continue"] : [], label: "Claude Code" };
    }
    case "codex": {
      const cmd = onPath("codex");
      if (!cmd) throw new Error("Codex CLI is not installed or not on PATH");
      return { provider, command: cmd, args: resume ? ["resume", "--last"] : [], label: "Codex" };
    }
    case "shell":
      return windows
        ? { provider, command: process.env.COMSPEC && !/cmd\.exe$/i.test(process.env.COMSPEC) ? process.env.COMSPEC : (onPath("pwsh") ?? "powershell.exe"), args: ["-NoLogo"], label: "Shell" }
        : { provider, command: process.env.SHELL || (process.platform === "darwin" ? "/bin/zsh" : "/bin/bash"), args: ["-l"], label: "Shell" };
    default:
      throw new Error("Unsupported terminal provider");
  }
}

command("pty_providers", () => ["claude", "codex", "shell"].flatMap(p => { try { return [resolve(p, false)]; } catch { return []; } }));

command("pty_spawn", ({ provider, resume, cols, rows }) => {
  const spec = resolve(provider, resume === true);
  const { dir: cwd, bin } = agentWorkspace();
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && !isAgentSessionMarker(k)) env[k] = v;
  // The installed app's workspace brings its own research command.
  if (bin) {
    const key = Object.keys(env).find(k => k.toUpperCase() === "PATH") ?? "PATH";
    env[key] = [bin, env[key] ?? ""].filter(Boolean).join(path.delimiter);
  }
  Object.assign(env, { TERM: "xterm-256color", COLORTERM: "truecolor", HVNT33_URL: baseUrl(), HVNT33_DESKTOP: "1" });
  const term = nodePty.spawn(spec.command, spec.args, {
    name: "xterm-256color", cwd, env,
    cols: Math.max(10, Number(cols) || 80), rows: Math.max(2, Number(rows) || 24),
  });
  const id = randomUUID();
  sessions.set(id, term);
  term.onData(data => emit(`pty:output:${id}`, { sessionId: id, data }));
  term.onExit(({ exitCode }) => {
    sessions.delete(id);
    emit(`pty:exit:${id}`, { sessionId: id, code: exitCode });
  });
  return id;
});

function session(id: unknown): nodePty.IPty {
  const s = typeof id === "string" ? sessions.get(id) : undefined;
  if (!s) throw new Error("Terminal session has ended");
  return s;
}

command("pty_write", ({ sessionId, data }) => { session(sessionId).write(String(data ?? "")); });
command("pty_resize", ({ sessionId, cols, rows }) => { session(sessionId).resize(Math.max(10, Number(cols) || 80), Math.max(2, Number(rows) || 24)); });

export function killPty(id: string) {
  const s = sessions.get(id);
  if (!s) return;
  sessions.delete(id);
  // Signal the whole process group, so a CLI's children stop too (the terminal leads its group).
  if (!windows) { try { process.kill(-s.pid, "SIGTERM"); } catch { /* already gone */ } }
  try { s.kill(); } catch { /* already gone */ }
}

command("pty_kill", ({ sessionId }) => { if (typeof sessionId === "string") killPty(sessionId); });

export const killAllPty = () => { for (const id of [...sessions.keys()]) killPty(id); };
