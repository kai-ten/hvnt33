// Page snapshots in the app's own browser. The server asks (through its
// channel to the app); a hidden window loads the page in a fresh, throwaway
// session, through the case's route when it has one, and every response is
// recorded with the DevTools protocol: status, headers and body, including
// images, styles and scripts. The page is scrolled so lazy content loads, then
// its screenshot and rendered text are taken. The server builds the archive.
import { BrowserWindow, session } from "electron";
import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { presentAsChromium } from "./browser.ts";
import { parseRoute, proxyConfig } from "./policy.ts";

const MAX_RESOURCE = 25 * 1024 * 1024;
const MAX_TOTAL = 200 * 1024 * 1024;
const MAX_RESOURCES = 2000;

interface Recorded {
  url: string; method: string; status: number; statusText: string; headers: [string, string][]; mime: string; date: string;
  file?: string; redirect?: boolean;
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

const trace = (m: string) => { if (process.env.HVNT33_TRACE) console.error(`[capture] ${m}`); };

export async function capturePage(payload: { url: string; workDir: string; route: string }) {
  trace(`start ${payload.url}`);
  const url = new URL(payload.url);
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Only http(s) pages can be captured");
  const workDir = path.resolve(payload.workDir);
  if (!fs.statSync(workDir).isDirectory()) throw new Error("No capture folder");
  const route = payload.route ? parseRoute(payload.route) : "";
  const capturedAt = new Date().toISOString();
  const notes: string[] = [];

  // A fresh session per capture: no cookies or sign-ins, nothing kept afterwards.
  const ses = session.fromPartition(`capture-${randomBytes(8).toString("hex")}`);
  await ses.setProxy(proxyConfig(route));
  presentAsChromium(ses);
  ses.setPermissionRequestHandler((_wc, _p, cb) => cb(false));
  ses.setPermissionCheckHandler(() => false);
  ses.on("will-download", e => e.preventDefault());
  const win = new BrowserWindow({
    show: false, width: 1366, height: 900, paintWhenInitiallyHidden: true,
    webPreferences: { session: ses, sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false, spellcheck: false, webviewTag: false },
  });
  const wc = win.webContents;
  wc.setWebRTCIPHandlingPolicy("disable_non_proxied_udp");
  wc.setWindowOpenHandler(() => ({ action: "deny" }));
  wc.on("will-navigate", e => { if (!/^https?:/.test(e.url)) e.preventDefault(); });

  const recorded = new Map<string, Recorded>();
  const done: Recorded[] = [];
  const inflight = new Set<string>();
  let lastActivity = Date.now();
  let total = 0, counter = 0, truncated = false;
  let mainStatus = 0, mainMime = "text/html", mainFrame = "";
  const dbg = wc.debugger;
  const pending: Promise<void>[] = [];

  const save = async (requestId: string) => {
    const r = recorded.get(requestId);
    recorded.delete(requestId);
    if (!r) return;
    if (done.length >= MAX_RESOURCES || total >= MAX_TOTAL) { truncated = true; return; }
    try {
      const { body, base64Encoded } = await dbg.sendCommand("Network.getResponseBody", { requestId }) as { body: string; base64Encoded: boolean };
      const bytes = Buffer.from(body, base64Encoded ? "base64" : "utf8");
      if (bytes.length > MAX_RESOURCE || total + bytes.length > MAX_TOTAL) { truncated = true; return; }
      total += bytes.length;
      const file = `body-${String(++counter).padStart(4, "0")}`;
      fs.writeFileSync(path.join(workDir, file), bytes);
      done.push({ ...r, file });
    } catch {
      // The body is gone (a stream, or evicted): nothing to archive for it.
    }
  };

  // The DevTools protocol needs a page to talk to: start from a blank one.
  await wc.loadURL("about:blank");
  dbg.attach("1.3");
  dbg.on("message", (_e, method, params) => {
    lastActivity = Date.now();
    if (method === "Network.requestWillBeSent") {
      inflight.add(params.requestId);
      // A redirect ends the previous response under the same request id.
      if (params.redirectResponse) {
        const prev = recorded.get(params.requestId);
        const res = params.redirectResponse;
        if (prev) {
          const headers = Object.entries(res.headers ?? {}).map(([k, v]) => [k, String(v)] as [string, string]);
          if (done.length < MAX_RESOURCES) done.push({ ...prev, status: res.status, statusText: res.statusText ?? "", headers, mime: res.mimeType ?? "", redirect: true, file: undefined });
        }
      }
      if (/^https?:/.test(params.request.url)) recorded.set(params.requestId, { url: params.request.url, method: params.request.method, status: 0, statusText: "", headers: [], mime: "", date: new Date().toISOString() });
    } else if (method === "Network.responseReceived") {
      const r = recorded.get(params.requestId);
      if (!r) return;
      const res = params.response;
      r.status = res.status; r.statusText = res.statusText ?? ""; r.mime = res.mimeType ?? "";
      r.headers = Object.entries(res.headers ?? {}).map(([k, v]) => [k, String(v)] as [string, string]);
      if (params.type === "Document" && params.frameId === mainFrame) { mainStatus = res.status; mainMime = res.mimeType || mainMime; }
    } else if (method === "Network.loadingFinished") {
      inflight.delete(params.requestId);
      pending.push(save(params.requestId));
    } else if (method === "Network.loadingFailed") {
      inflight.delete(params.requestId);
      recorded.delete(params.requestId);
    }
  });
  trace("attached");
  await dbg.sendCommand("Network.enable", { maxTotalBufferSize: MAX_TOTAL, maxResourceBufferSize: MAX_RESOURCE });
  await dbg.sendCommand("Network.setCacheDisabled", { cacheDisabled: true });
  mainFrame = ((await dbg.sendCommand("Page.getFrameTree")) as { frameTree: { frame: { id: string } } }).frameTree.frame.id;

  /** Wait until nothing has loaded for a while (or give up waiting). */
  const settle = async (quietMs: number, maxMs: number) => {
    const until = Date.now() + maxMs;
    while (Date.now() < until && (inflight.size > 0 || Date.now() - lastActivity < quietMs)) await sleep(100);
  };

  trace("network enabled");
  try {
    let timer: NodeJS.Timeout | undefined;
    await Promise.race([
      wc.loadURL(url.href),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("The page did not load within 60 seconds")), 60_000); }),
    ]).finally(() => clearTimeout(timer));
    trace(`loaded, ${done.length} responses, ${inflight.size} in flight`);
    await settle(1000, 15_000);
    // Scroll through the page so content loaded on scroll is archived too, then back to the top.
    await wc.executeJavaScript(`(async () => { const h = () => document.documentElement.scrollHeight; for (let y = 0, i = 0; y < h() && i < 30; y += innerHeight, i++) { scrollTo(0, y); await new Promise(r => setTimeout(r, 150)); } scrollTo(0, 0); })()`, true).catch(() => {});
    await settle(1000, 10_000);
    await Promise.all(pending);
    trace(`settled, ${done.length} responses`);

    const screenshot = await wc.capturePage().then(img => img.toPNG()).catch(() => null);
    if (screenshot?.length) fs.writeFileSync(path.join(workDir, "screenshot.png"), screenshot);
    else notes.push("No screenshot could be taken.");
    const text = String(await wc.executeJavaScript("document.body ? document.body.innerText : ''", true).catch(() => ""));
    if (truncated) notes.push(`The page loaded more than the archive keeps (${MAX_RESOURCES} responses or ${MAX_TOTAL / 1024 / 1024} MB); the rest was left out.`);
    const finalUrl = wc.getURL();
    if (!mainStatus) mainStatus = done.find(r => r.url === finalUrl && !r.redirect)?.status ?? 0;
    return {
      finalUrl, status: mainStatus, title: wc.getTitle(), text, mime: mainMime, capturedAt,
      screenshot: screenshot?.length ? "screenshot.png" : null,
      responses: done.filter(r => r.file || r.redirect).map(r => ({ url: r.url, method: r.method, status: r.status, statusText: r.statusText, headers: r.headers, mime: r.mime, date: r.date, file: r.file ?? writeEmpty(workDir) })),
      notes,
    };
  } finally {
    try { dbg.detach(); } catch { /* already detached */ }
    win.destroy();
    await ses.clearStorageData().catch(() => {});
  }
}

let empty: string | null = null;
/** Redirects have no body; they share one empty file. */
function writeEmpty(workDir: string): string {
  if (!empty || !fs.existsSync(path.join(workDir, empty))) { empty = "body-empty"; fs.writeFileSync(path.join(workDir, empty), ""); }
  return empty;
}
