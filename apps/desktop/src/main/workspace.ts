// The folder the agent terminal works in. It holds the agent's instructions
// (AGENTS.md, CLAUDE.md), its skills, and the research CLI it files with.
//
// - Development: the repository this app runs from.
// - A folder the researcher chose (a checkout of hvnt33), or HVNT33_ROOT.
// - An installed app with neither: its own workspace in its data folder,
//   set up from the copies inside the app on every launch, with a
//   `hvnt33-research` command that runs the CLI on the app's built-in Node.
import { app } from "electron";
import fs from "node:fs";
import path from "node:path";

export const SERVER_ENTRY = "apps/server/src/main.ts";
export const NO_WORKSPACE = "Choose your hvnt33 folder (a checkout of the hvnt33 repository) to run the agent there.";

/** A checkout of hvnt33: the server and the agent instructions. */
export const isRepository = (dir: string) => fs.existsSync(path.join(dir, SERVER_ENTRY)) && fs.existsSync(path.join(dir, "AGENTS.md"));
const chosenFile = () => path.join(app.getPath("userData"), "workspace.json");
/** The repository this app runs from in development (apps/desktop → the root). */
const devRoot = () => (app.isPackaged ? null : path.resolve(app.getAppPath(), "../.."));

/** The repository to work in (HVNT33_ROOT, the chosen folder, or in development this one), or null. */
export function repositoryRoot(): string | null {
  let candidate = process.env.HVNT33_ROOT || null;
  if (!candidate) { try { candidate = JSON.parse(fs.readFileSync(chosenFile(), "utf8")).path ?? null; } catch { /* none chosen */ } }
  candidate ??= devRoot();
  if (!candidate) return null;
  try {
    const root = fs.realpathSync(candidate);
    return isRepository(root) ? root : null;
  } catch {
    return null;
  }
}

export function chooseRepository(dir: string) {
  const root = fs.realpathSync(dir);
  if (!isRepository(root)) throw new Error(`${root} is not an hvnt33 folder: it needs ${SERVER_ENTRY} and AGENTS.md. Clone the repository and choose its top folder.`);
  fs.mkdirSync(path.dirname(chosenFile()), { recursive: true });
  fs.writeFileSync(chosenFile(), JSON.stringify({ path: root }));
  return root;
}

/** What the installed app carries for its workspace (staged by scripts/package.ts). */
const bundledAgent = () => path.join(process.resourcesPath, "hvnt33", "agent");
const researchCli = () => path.join(process.resourcesPath, "hvnt33", "apps", "server", "scripts", "research.ts");

/** Set up the installed app's own workspace from the copies inside the app. Returns its folder, or null outside an installed app. */
export function prepareAppWorkspace(): string | null {
  if (!app.isPackaged || !fs.existsSync(bundledAgent())) return null;
  const dir = path.join(app.getPath("userData"), "workspace");
  const bin = path.join(dir, "bin");
  fs.mkdirSync(bin, { recursive: true });
  // Instructions and skills follow the app's version; the agent's own files are left alone.
  for (const name of ["AGENTS.md", "CLAUDE.md", ".agents", ".claude"]) {
    const from = path.join(bundledAgent(), name);
    if (!fs.existsSync(from)) continue;
    fs.rmSync(path.join(dir, name), { recursive: true, force: true });
    fs.cpSync(from, path.join(dir, name), { recursive: true, dereference: true });
  }
  fs.appendFileSync(path.join(dir, "AGENTS.md"), [
    "",
    "## This workspace",
    "",
    "This is the hvnt33 app's own workspace. `npm run research -- …` works here as in the repository; without npm, run the same commands as `hvnt33-research …`. The app runs the server; do not start services.",
    "",
  ].join("\n"));
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "hvnt33-workspace", private: true, scripts: { research: "hvnt33-research" } }, null, 2) + "\n");
  // The research CLI on the app's own Node (Electron run as Node), with paths fixed at each launch.
  const exe = process.execPath;
  if (process.platform === "win32") {
    fs.writeFileSync(path.join(bin, "hvnt33-research.cmd"), `@echo off\r\nset ELECTRON_RUN_AS_NODE=1\r\n"${exe}" "${researchCli()}" %*\r\n`);
  } else {
    const quote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
    fs.writeFileSync(path.join(bin, "hvnt33-research"), `#!/bin/sh\nELECTRON_RUN_AS_NODE=1 exec ${quote(exe)} ${quote(researchCli())} "$@"\n`, { mode: 0o755 });
  }
  return dir;
}

let appWorkspace: string | null | undefined;

/** Where the agent works: a repository, else the installed app's own workspace. */
export function agentWorkspace(): { dir: string; bin: string | null } {
  const repo = repositoryRoot();
  if (repo) return { dir: repo, bin: null };
  if (appWorkspace === undefined) appWorkspace = prepareAppWorkspace();
  if (appWorkspace) return { dir: appWorkspace, bin: path.join(appWorkspace, "bin") };
  throw new Error(NO_WORKSPACE);
}
