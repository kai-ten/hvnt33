// Bridge to the hvnt33 server, and the local services the app runs.
//
// The app view never talks to the server directly: requests go through these
// commands, confined to `/api/` paths, with the API token added here. That
// keeps the server's strict Origin check intact and the token out of the view.
//
// Locally, the app starts the server from its own copy (inside the app, or the
// repository in development) as a background Node process. The server starts
// the built-in database itself. Nothing needs Docker.
import { app, dialog, net, shell, utilityProcess, type Session, type UtilityProcess } from "electron";
import fs from "node:fs";
import path from "node:path";
import { parseEnv } from "node:util";
import { currentConnection } from "./connection.ts";
import { agentWorkspace, chooseRepository, NO_WORKSPACE, repositoryRoot, SERVER_ENTRY } from "./workspace.ts";
import { command } from "./ipc.ts";
import { hasRequiredFeatures, imageExtension, imageFilename, isLoopback, portFromEnvFile, safeFileName, unusedPath, validApiPath } from "./policy.ts";
import { tabSession, USER_AGENT } from "./browser.ts";
import { capturePage } from "./capture.ts";

const MAX_IMAGE_BYTES = 25 * 1024 * 1024;

// ── Server location ──────────────────────────────────────────────────────────

/** The repository in use, if any (see workspace.ts). */
const tryWorkspace = () => repositoryRoot();

/** The server the app runs: the copy inside an installed app, else the repository's. */
function serverHome(): string {
  const bundled = path.join(process.resourcesPath, "hvnt33");
  if (app.isPackaged && fs.existsSync(path.join(bundled, SERVER_ENTRY))) return bundled;
  const root = tryWorkspace();
  if (!root) throw new Error(NO_WORKSPACE);
  return root;
}

/** The server's environment: the repository's `.env` (existing variables win, as with `node --env-file`). */
function serverEnv(): Record<string, string> {
  const root = tryWorkspace();
  let fileVars: Record<string, string> = {};
  if (root) { try { fileVars = parseEnv(fs.readFileSync(path.join(root, ".env"), "utf8")) as Record<string, string>; } catch { /* no .env */ } }
  const env: Record<string, string> = { ...fileVars };
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
  // An installed app keeps its research in its own data folder unless a repository is chosen.
  if (!env.HVNT33_DATA_DIR) env.HVNT33_DATA_DIR = root ? path.join(root, "data") : path.join(app.getPath("userData"), "data");
  return env;
}

command("workspace_choose", async () => {
  const picked = await dialog.showOpenDialog({ title: "Choose your hvnt33 folder", properties: ["openDirectory"] });
  if (picked.canceled || !picked.filePaths[0]) return null;
  return chooseRepository(picked.filePaths[0]);
});

// ── Requests ─────────────────────────────────────────────────────────────────

export function localUrl(): string {
  const env = serverEnv();
  const port = env.PORT ? portFromEnvFile(`PORT=${env.PORT}`) : null;
  return `http://127.0.0.1:${port ?? 4310}`;
}

/** The server requests go to: the configured connection, else the local server. */
export const baseUrl = () => currentConnection().url || localUrl();

const authorized = (headers: Record<string, string> = {}) => {
  const token = currentConnection().token;
  return token ? { ...headers, Authorization: `Bearer ${token}` } : headers;
};

const unreachable = (e: unknown) => {
  const cause = (e as { cause?: { code?: string } }).cause;
  return new Error(cause?.code === "ECONNREFUSED" ? "hvnt33 server is not running" : (e as Error).message);
};

async function serverFetch(pathname: string, init: RequestInit = {}): Promise<Response> {
  try {
    return await fetch(baseUrl() + pathname, { ...init, headers: authorized(init.headers as Record<string, string>), signal: init.signal ?? AbortSignal.timeout(120_000) });
  } catch (e) {
    throw unreachable(e);
  }
}

async function errorMessage(res: Response, fallback: string): Promise<string> {
  const text = await res.text().catch(() => "");
  try { const v = JSON.parse(text); if (typeof v?.error === "string") return v.error; } catch { /* not JSON */ }
  return fallback;
}

/** Forward one JSON request. HTTP errors come back as status and body; only transport failures throw. */
command("api", async ({ method, path: p, body }) => {
  if (!validApiPath(p)) throw new Error("Invalid API path");
  if (!["GET", "POST", "PATCH", "DELETE"].includes(String(method))) throw new Error("Unsupported method");
  const hasBody = body !== null && body !== undefined;
  const res = await serverFetch(p, { method: String(method), headers: hasBody ? { "Content-Type": "application/json" } : {}, body: hasBody ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let parsed: unknown = null;
  if (text) { try { parsed = JSON.parse(text); } catch { parsed = text; } }
  return { status: res.status, body: parsed };
});

function downloads(): string {
  const dir = app.getPath("downloads");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** Download a file from the API (e.g. an evidence package) into Downloads, never overwriting, and show it. */
command("api_download", async ({ path: p, fileName }) => {
  if (!validApiPath(p)) throw new Error("Invalid API path");
  const res = await serverFetch(p);
  if (!res.ok) throw new Error(await errorMessage(res, `Download failed (${res.status})`));
  const target = unusedPath(downloads(), safeFileName(String(fileName ?? "")));
  fs.writeFileSync(target, Buffer.from(await res.arrayBuffer()));
  shell.showItemInFolder(target);
  return target;
});

/** An image from the API (a record's original) as a data URL, for previews in the app. */
command("api_image", async ({ path: p }) => {
  if (!validApiPath(p)) throw new Error("Invalid API path");
  const res = await serverFetch(p);
  if (!res.ok) throw new Error(`The server returned ${res.status}`);
  const mime = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (!imageExtension(mime) || mime === "image/svg+xml") throw new Error("Not a previewable image");
  if (Number(res.headers.get("content-length") ?? 0) > MAX_IMAGE_BYTES) throw new Error("Too large to preview; download it instead");
  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.length > MAX_IMAGE_BYTES) throw new Error("Too large to preview; download it instead");
  return `data:${mime};base64,${bytes.toString("base64")}`;
});

/** Save text the app generated (e.g. the connection map as SVG) to Downloads, never overwriting. */
command("save_text", ({ fileName, content }) => {
  const text = String(content ?? "");
  if (text.length > 20 * 1024 * 1024) throw new Error("Too large");
  const target = unusedPath(downloads(), safeFileName(String(fileName ?? "")));
  fs.writeFileSync(target, text);
  shell.showItemInFolder(target);
  return target;
});

/** A GET through a browser session (its route, cookies and kill switch), with a size limit. */
function sessionGet(ses: Session, url: string, headers: Record<string, string>, limit: number): Promise<{ status: number; type: string; bytes: Buffer }> {
  return new Promise((resolve, reject) => {
    const req = net.request({ url, session: ses, useSessionCookies: true, redirect: "follow", referrerPolicy: "strict-origin-when-cross-origin" });
    for (const [k, v] of Object.entries(headers)) req.setHeader(k, v);
    const timer = setTimeout(() => { req.abort(); reject(new Error("timed out")); }, 45_000);
    req.on("response", res => {
      const type = String(res.headers["content-type"] ?? "");
      const chunks: Buffer[] = [];
      let size = 0;
      res.on("data", chunk => {
        size += chunk.length;
        if (size > limit) { clearTimeout(timer); req.abort(); reject(new Error("image larger than 25 MB")); return; }
        chunks.push(chunk);
      });
      res.on("end", () => { clearTimeout(timer); resolve({ status: res.statusCode, type, bytes: Buffer.concat(chunks) }); });
      res.on("error", (e: Error) => { clearTimeout(timer); reject(e); });
    });
    req.on("error", e => { clearTimeout(timer); reject(e); });
    req.end();
  });
}

/**
 * Fetch a captured image's original. Through the tab it came from when it is
 * still open, so the request uses that tab's session: the case's route, its
 * sign-ins, and its paused state (a paused case fetches nothing).
 */
async function downloadImage(url: string, referer: string, label: string | null): Promise<{ bytes: Buffer; mime: string; name: string }> {
  let parsed: URL;
  try { parsed = new URL(url); } catch { throw new Error("Invalid image URL"); }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("Image URL must be http(s)");
  // What the page's own image request sent under Chrome's default referrer policy: the page's origin
  // (Chromium refuses a full address for another site under that policy).
  let origin = "";
  try { const r = new URL(referer); if (r.protocol === "http:" || r.protocol === "https:") origin = `${r.origin}/`; } catch { /* no page address */ }
  const headers = { "User-Agent": USER_AGENT, ...(origin ? { Referer: origin } : {}) };
  const ses = label ? tabSession(label) : null;
  let got: { status: number; type: string; bytes: Buffer };
  if (ses) {
    got = await sessionGet(ses, url, headers, MAX_IMAGE_BYTES);
  } else {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(45_000) });
    if (Number(res.headers.get("content-length") ?? 0) > MAX_IMAGE_BYTES) throw new Error("image larger than 25 MB");
    got = { status: res.status, type: res.headers.get("content-type") ?? "", bytes: Buffer.from(await res.arrayBuffer()) };
    if (got.bytes.length > MAX_IMAGE_BYTES) throw new Error("image larger than 25 MB");
  }
  if (got.status < 200 || got.status >= 300) throw new Error(`image server returned ${got.status}`);
  const ext = imageExtension(got.type);
  if (!ext) throw new Error(`not an image (${got.type || "no type"})`);
  return { bytes: got.bytes, mime: got.type.split(";")[0].trim(), name: imageFilename(url, ext) };
}

/**
 * Save a browser capture as an intake. Image originals are fetched and
 * archived; when that fails the capture is still saved and its text says the
 * original bytes were not archived.
 */
command("capture_submit", async ({ request, label }) => {
  const r = request as Record<string, unknown>;
  let text = String(r.text ?? "");
  const form = new FormData();
  const imageUrl = typeof r.imageUrl === "string" ? r.imageUrl : "";
  if (imageUrl) {
    try {
      const { bytes, mime, name } = await downloadImage(imageUrl, String(r.sourceUrl ?? ""), typeof label === "string" ? label : null);
      form.append("file", new Blob([new Uint8Array(bytes)], { type: mime }), name);
    } catch (e) {
      text += `\n\n[Capture note: the original image at ${imageUrl} could not be archived (${(e as Error).message}). Only the page context above was preserved.]`;
    }
  }
  for (const [k, v] of [
    ["investigationId", r.investigationId], ["title", r.title], ["text", text], ["sourceUrl", r.sourceUrl], ["sourceLabel", r.sourceLabel],
    ["contentOrigin", r.contentOrigin], ["researcherNote", r.researcherNote], ["captureMeta", JSON.stringify(r.captureMeta ?? {})],
  ] as const) form.append(k, String(v ?? ""));
  const res = await serverFetch("/api/intakes", { method: "POST", body: form });
  if (!res.ok) throw new Error(await errorMessage(res, `hvnt33 returned ${res.status}`));
  return res.json();
});

// ── Local services ───────────────────────────────────────────────────────────

let server: UtilityProcess | null = null;
let serverExit: number | null = null;
let serverLog = "";

export async function servicesStatus() {
  const url = baseUrl();
  const remote = !isLoopback(url);
  let rootText: string, hasWorkspace = true;
  try { rootText = agentWorkspace().dir; } catch (e) { rootText = (e as Error).message; hasWorkspace = false; }
  const startedByApp = server !== null && serverExit === null;
  let s = { server: false, database: false, current: true, detail: "" };
  try {
    const res = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(5000) });
    if (res.ok) {
      const body = await res.json().catch(() => null);
      s = hasRequiredFeatures(body)
        ? { server: true, database: true, current: true, detail: "Connected" }
        : { server: true, database: true, current: false, detail: remote ? "The hvnt33 server is an older version than this app expects." : "The running hvnt33 server is an older version. Restart it (Ctrl+C, then npm start) to record searches and browser captures." };
    } else {
      s = { server: true, database: false, current: true, detail: `Server is up but the database is unavailable (${res.status})` };
    }
  } catch (e) {
    const refused = (e as { cause?: { code?: string } }).cause?.code === "ECONNREFUSED";
    s = { server: false, database: false, current: true, detail: refused ? (remote ? `Could not reach ${url}` : "hvnt33 server is not running") : (e as Error).message };
  }
  return { ...s, url, root: rootText, startedByApp, remote, hasWorkspace };
}

command("services_status", servicesStatus);

let starting: Promise<unknown> | null = null;

/** Start the local server (which starts the built-in database) if it is not running. */
command("services_start", () => (starting ??= startServices().finally(() => { starting = null; })));

async function startServices() {
  if (process.env.HVNT33_TRACE) console.error(`[services] start ${baseUrl()}`);
  if (!isLoopback(baseUrl())) throw new Error("Connected to a hosted server: there is nothing to start on this computer.");
  if (!(server && serverExit === null) && !(await servicesStatus()).server) {
    const home = serverHome();
    serverExit = null;
    serverLog = "";
    const child = utilityProcess.fork(path.join(home, SERVER_ENTRY), [], { cwd: tryWorkspace() ?? home, env: serverEnv(), stdio: "pipe", serviceName: "hvnt33 server" });
    const keep = (d: Buffer) => { serverLog = (serverLog + d.toString()).slice(-8000); };
    child.stdout?.on("data", keep);
    child.stderr?.on("data", keep);
    child.once("exit", code => { serverExit = code; if (server === child) server = null; });
    // Requests from the server that only the app can serve (see apps/server/src/seams/app.ts).
    child.on("message", (m: { request?: number; type?: string; payload?: unknown }) => {
      if (process.env.HVNT33_TRACE) console.error(`[server→app] ${JSON.stringify(m).slice(0, 200)}`);
      if (typeof m?.request !== "number") return;
      const reply = (ok: boolean, value: unknown) => { if (serverExit === null) child.postMessage(ok ? { reply: m.request, ok, value } : { reply: m.request, ok, error: value }); };
      const work = m.type === "capture" ? capturePage(m.payload as Parameters<typeof capturePage>[0]) : Promise.reject(new Error(`Unknown request ${m.type}`));
      work.then(v => reply(true, v), (e: Error) => reply(false, e.message));
    });
    server = child;
  }
  // The server starts the database and prepares the schema before it listens.
  for (let i = 0; i < 180; i++) {
    const status = await servicesStatus();
    if (process.env.HVNT33_TRACE) console.error(`[services] ${i} ${JSON.stringify(status)}`);
    if (status.server && status.database) return status;
    if (serverExit !== null) {
      const last = serverLog.trim().split("\n").slice(-3).join(" ").slice(0, 600);
      throw new Error(`hvnt33 server exited (${serverExit})${last ? `: ${last}` : ""}`);
    }
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error("Timed out waiting for hvnt33 to become healthy");
}

/** Stop the server if this app started it (it stops the database with it); a server the user started stays up. */
export async function stopServices(): Promise<void> {
  const child = server;
  if (!child || serverExit !== null) return;
  const exited = new Promise<void>(resolve => child.once("exit", () => resolve()));
  const wait = async (ms: number) => {
    let timer: NodeJS.Timeout | undefined;
    const done = await Promise.race([exited.then(() => true), new Promise<boolean>(r => { timer = setTimeout(() => r(false), ms); })]);
    clearTimeout(timer);
    return done;
  };
  // A clean stop closes the database's files; the kill is the fallback.
  child.postMessage("shutdown");
  if (!(await wait(20_000))) { child.kill(); await wait(5_000); }
}
