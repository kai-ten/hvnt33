// Which hvnt33 server the app talks to: the local one (default), or a hosted
// one reached with an API token. The URL is saved in the app's settings; the
// token is encrypted with the operating system's credential store
// (safeStorage: Keychain, DPAPI, or the Secret Service keyring) and never
// written in the clear. HVNT33_URL / HVNT33_TOKEN override both, for tests
// and scripted runs.
import { app, safeStorage } from "electron";
import fs from "node:fs";
import path from "node:path";
import { command } from "./ipc.ts";
import { isLoopback, normalizeServerUrl } from "./policy.ts";

export interface Connection { url: string; token: string | null }

let saved: Connection = { url: "", token: null };
const file = () => path.join(app.getPath("userData"), "connection.json");

export function initConnection() {
  try {
    const v = JSON.parse(fs.readFileSync(file(), "utf8")) as { url?: string; token?: string };
    const url = v.url ? normalizeServerUrl(v.url) : "";
    let token: string | null = null;
    if (url && v.token && safeStorage.isEncryptionAvailable()) token = safeStorage.decryptString(Buffer.from(v.token, "base64"));
    saved = { url, token };
  } catch { /* none saved */ }
}

/** The connection in effect, with environment overrides applied. */
export function currentConnection(): Connection {
  if (process.env.HVNT33_URL) return { url: process.env.HVNT33_URL.replace(/\/+$/, ""), token: process.env.HVNT33_TOKEN || null };
  return saved;
}

function info(c: Connection, workspace: unknown = null) {
  return { url: c.url, remote: !!c.url && !isLoopback(c.url), hasToken: !!c.token, workspace };
}

async function getJson(url: string, token?: string): Promise<{ status: number; body: any }> {
  try {
    const res = await fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {}, signal: AbortSignal.timeout(15_000) });
    return { status: res.status, body: await res.json().catch(() => null) };
  } catch (e) {
    throw new Error(`Could not reach the server: ${(e as Error).message}`);
  }
}

command("connection_get", () => info(currentConnection()));

/** Check a server (and token) and save it as the app's connection. */
command("connection_set", async ({ url: rawUrl, token: rawToken }) => {
  const url = normalizeServerUrl(String(rawUrl ?? ""));
  const token = typeof rawToken === "string" && rawToken.trim() ? rawToken.trim() : null;
  const health = await getJson(`${url}/api/health`);
  if (health.status !== 200 || !health.body || !("database" in health.body)) throw new Error("That address did not answer as an hvnt33 server");
  let workspace: unknown = null;
  if ((health.body.auth ?? "local") === "token") {
    if (!token) throw new Error("This server needs an API token");
    const ws = await getJson(`${url}/api/workspace`, token);
    if (ws.status === 401) throw new Error("The server rejected this API token");
    if (ws.status !== 200) throw new Error(`The server returned ${ws.status} for the workspace`);
    workspace = ws.body;
  }
  let stored: string | undefined;
  if (token) {
    if (!safeStorage.isEncryptionAvailable()) throw new Error("This computer's credential store is unavailable, so the token cannot be kept safely");
    stored = safeStorage.encryptString(token).toString("base64");
  }
  fs.mkdirSync(path.dirname(file()), { recursive: true });
  fs.writeFileSync(file(), JSON.stringify({ url, ...(stored ? { token: stored } : {}) }), { mode: 0o600 });
  saved = { url, token };
  return info(saved, workspace);
});

/** Go back to the local server. */
command("connection_reset", () => {
  fs.rmSync(file(), { force: true });
  saved = { url: "", token: null };
  return info(saved);
});
