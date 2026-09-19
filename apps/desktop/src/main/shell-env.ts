// Import the user's login-shell environment when launched from the Dock,
// Finder or a desktop launcher: GUI apps start with a minimal environment, so
// `claude` or `codex` installed through nvm or Homebrew would not be on PATH.
// One short login shell runs at startup; variables already set win, except PATH.
import { spawnSync } from "node:child_process";
import { parseEnv } from "./policy.ts";

const MARKER = "__HVNT33_ENV_7f3a__";

export function hydrateShellEnv() {
  if (process.platform === "win32" || process.env.SHLVL) return; // Started from a shell: already complete.
  const shell = process.env.SHELL || (process.platform === "darwin" ? "/bin/zsh" : "/bin/bash");
  const out = spawnSync(shell, ["-ilc", `printf '%s\\n' ${MARKER}; env`], { encoding: "utf8", timeout: 4000, stdio: ["ignore", "pipe", "ignore"] });
  if (out.error || typeof out.stdout !== "string") { console.error(`[hvnt33] could not import shell environment: ${out.error?.message ?? "no output"}`); return; }
  for (const [k, v] of Object.entries(parseEnv(out.stdout, MARKER))) {
    if (process.env[k] === undefined || k === "PATH") process.env[k] = v;
  }
}
