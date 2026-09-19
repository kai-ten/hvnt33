// In-app browser: one WebContentsView per tab, laid over the browser area of
// the app interface.
//
// Browsed pages are untrusted. Their views are sandboxed, with no Node and no
// bridge (their preload only installs hvnt33's page scripts), so they cannot
// reach commands, the file system, the terminal or the server. The app reads a
// page only when the researcher acts, by running the bundled read-only scripts
// and receiving their JSON result.
//
// Each case (and each route within it) browses in its own session: its own
// cookies, logins, storage and proxy. A paused case (the kill switch) loads
// nothing: every request its sessions make is refused before it leaves.
import { app, BrowserWindow, clipboard, Menu, session, WebContentsView, type Session, type WebContents } from "electron";
import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { command, emit } from "./ipc.ts";
import { allowedNavigation, decodeScriptResult, downloadDestination, isE2EPartition, isTabLabel, parseRoute, parseWebUrl, partitionFor, proxyConfig } from "./policy.ts";
import SERP_JS from "@hvnt33/ui/page-scripts/serp.js?raw";
import CAPTURE_JS from "@hvnt33/ui/page-scripts/capture.js?raw";
import PAGE_JS from "@hvnt33/ui/page-scripts/page.js?raw";
import WEBRTC_JS from "@hvnt33/ui/page-scripts/webrtc.js?raw";


/**
 * Pages see a plain Chromium browser, consistent everywhere a site looks: the
 * user agent (no Electron or app tokens, which some sites refuse), the client
 * hints Chromium sends with every secure request (Electron sends none, which
 * reads as automation), the brands page scripts read from
 * navigator.userAgentData, and the usual Accept-Language.
 */
export const USER_AGENT = (() => {
  const os = process.platform === "darwin" ? "Macintosh; Intel Mac OS X 10_15_7" : process.platform === "win32" ? "Windows NT 10.0; Win64; x64" : "X11; Linux x86_64";
  return `Mozilla/5.0 (${os}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${process.versions.chrome.split(".")[0]}.0.0.0 Safari/537.36`;
})();

const PLATFORM_HINT = process.platform === "darwin" ? "macOS" : process.platform === "win32" ? "Windows" : "Linux";
let brandsHint = "";

/** Read the engine's own brand list once (what navigator.userAgentData reports), for the Sec-CH-UA header. */
export async function learnBrands() {
  // A bare view, not a window: closing a window before the app's own opens would quit the app.
  // Browsers show the brands only to secure pages, so the probe gets one on the app's own scheme.
  const ses = session.fromPartition("brands-probe");
  if (!ses.protocol.isProtocolHandled("app")) ses.protocol.handle("app", () => new Response("<!doctype html><title>brands</title>", { headers: { "Content-Type": "text/html" } }));
  const probe = new WebContentsView({ webPreferences: { partition: "brands-probe", sandbox: true } });
  try {
    await probe.webContents.loadURL("app://probe/");
    const brands = await probe.webContents.executeJavaScript("navigator.userAgentData ? navigator.userAgentData.brands : []") as { brand: string; version: string }[];
    brandsHint = brands.map(b => `"${b.brand.replace(/"/g, "")}";v="${b.version.replace(/"/g, "")}"`).join(", ");
  } catch { /* the headers are left out, as before */ }
  finally { probe.webContents.close(); }
}

/** Present a session as the Chromium it is: user agent, languages and client hints. */
export function presentAsChromium(ses: Session) {
  ses.setUserAgent(USER_AGENT, "en-US,en");
  ses.webRequest.onBeforeSendHeaders((details, callback) => {
    const headers = details.requestHeaders;
    if (brandsHint && details.url.startsWith("https:") && !Object.keys(headers).some(k => k.toLowerCase() === "sec-ch-ua")) {
      headers["sec-ch-ua"] = brandsHint;
      headers["sec-ch-ua-mobile"] = "?0";
      headers["sec-ch-ua-platform"] = `"${PLATFORM_HINT}"`;
    }
    callback({ requestHeaders: headers });
  });
}

// ── End-to-end runs ──────────────────────────────────────────────────────────

export const e2eEnabled = () => !app.isPackaged && process.env.HVNT33_E2E === "1";
/** This run's id: its sessions are its own. HVNT33_E2E_RUN (8 hex digits) reuses a run's sessions, to test relaunching. */
export const e2eRun = (() => {
  let run: string | null = null;
  return () => (e2eEnabled() ? (run ??= /^[0-9a-f]{8}$/i.test(process.env.HVNT33_E2E_RUN ?? "") ? process.env.HVNT33_E2E_RUN!.toLowerCase() : randomBytes(4).toString("hex")) : null);
})();

/** Remove sessions left by earlier end-to-end runs (never the researcher's, never this run's). Before any session opens. */
export function removeStaleE2ESessions() {
  const run = e2eRun();
  const dir = path.join(app.getPath("userData"), "Partitions");
  if (!run || !fs.existsSync(dir)) return;
  for (const name of fs.readdirSync(dir)) {
    if (isE2EPartition(`persist:${name}`) && !name.startsWith(`h33e-${run}-`)) fs.rmSync(path.join(dir, name), { recursive: true, force: true });
  }
}

// ── State ────────────────────────────────────────────────────────────────────

interface Tab { view: WebContentsView; profile: string; partition: string }

let window: BrowserWindow | null = null;
const tabs = new Map<string, Tab>();
const blocked = new Set<string>();
/** Which profile each configured session belongs to, and the proxy it uses. */
const sessions = new Map<string, { profile: string; route: string | null }>();
let bounds = { x: 0, y: 0, width: 800, height: 600 };
let visible = false;
let active: string | null = null;

export function attachWindow(win: BrowserWindow) { window = win; }

/** Write every session's cookies and site storage to disk (before an immediate exit). */
export async function flushSessions(extra: Session[] = []) {
  for (const ses of [...extra, ...[...sessions.keys()].map(p => session.fromPartition(p))]) {
    ses.flushStorageData();
    await ses.cookies.flushStore();
  }
}

/** The tab on screen and where it is, for end-to-end screenshots. */
export function visibleTab(): { view: WebContentsView; bounds: typeof bounds } | null {
  const t = visible && active ? tabs.get(active) : undefined;
  return t ? { view: t.view, bounds } : null;
}

const tabPreload = () => path.join(import.meta.dirname, "..", "preload", "tab.cjs");

/** The session of an open tab (for fetching a capture's image through the tab's route). */
export function tabSession(label: string): Session | null {
  const tab = isTabLabel(label) ? tabs.get(label) : undefined;
  return tab ? tab.view.webContents.session : null;
}

function labelOf(contents: WebContents): string | null {
  for (const [label, tab] of tabs) if (tab.view.webContents === contents) return label;
  return null;
}

/** Set up a profile's session once: user agent, permissions, the kill switch and downloads. */
function prepareSession(partition: string, profile: string): Session {
  const ses = session.fromPartition(partition);
  if (sessions.has(partition)) return ses;
  sessions.set(partition, { profile, route: null });
  presentAsChromium(ses);
  // Pages get no camera, microphone, location, notifications or device access.
  const allowed = new Set(["fullscreen", "clipboard-sanitized-write"]);
  ses.setPermissionRequestHandler((_wc, permission, callback) => callback(allowed.has(permission)));
  ses.setPermissionCheckHandler((_wc, permission) => allowed.has(permission));
  ses.setDevicePermissionHandler(() => false);
  // The kill switch: nothing leaves a paused case, not a navigation, not a subresource.
  ses.webRequest.onBeforeRequest((details, callback) => {
    const owner = sessions.get(partition)?.profile ?? profile;
    callback({ cancel: blocked.has(owner) && !details.url.startsWith("devtools:") });
  });
  ses.on("will-download", (_event, item, contents) => {
    const label = contents ? labelOf(contents) : null;
    const url = item.getURL();
    const target = downloadDestination(app.getPath("downloads"), url);
    item.setSavePath(target);
    emit("browser:download", { label, state: "started", url, path: target });
    item.once("done", (_e, state) => emit("browser:download", { label, state: state === "completed" ? "finished" : "failed", url }));
  });
  return ses;
}

/** Point a session at its route (or direct). Changing it drops connections made the old way. */
async function applyRoute(ses: Session, partition: string, route: string) {
  const entry = sessions.get(partition)!;
  if (entry.route === route) return;
  await ses.setProxy(proxyConfig(route));
  await ses.closeAllConnections();
  entry.route = route;
}

function applyLayout() {
  for (const [label, { view }] of tabs) {
    const show = visible && active === label;
    if (show) view.setBounds({ x: Math.round(bounds.x), y: Math.round(bounds.y), width: Math.max(1, Math.round(bounds.width)), height: Math.max(1, Math.round(bounds.height)) });
    view.setVisible(show);
  }
}

function tab(label: unknown): Tab {
  if (!isTabLabel(label)) throw new Error("Invalid tab");
  const t = tabs.get(label);
  if (!t) throw new Error("Tab is closed");
  return t;
}

// ── Commands ─────────────────────────────────────────────────────────────────

/** Pause or resume a profile (the case's kill switch). While paused, its tabs load nothing. */
command("browser_block_profile", ({ profile, blocked: on }) => {
  if (typeof profile !== "string" || !profile) throw new Error("Unknown browser profile");
  if (on) blocked.add(profile); else blocked.delete(profile);
});

command("browser_open", async ({ url, activate, profile: p, route: r, routeKey }) => {
  const target = parseWebUrl(String(url ?? ""));
  const profile = typeof p === "string" && p ? p : "shared";
  const route = typeof r === "string" && r.trim() ? parseRoute(r) : "";
  if (route && profile === "shared") throw new Error("A route needs the case's own browser profile");
  const partition = partitionFor(profile, typeof routeKey === "string" ? routeKey : "", e2eRun());
  if (blocked.has(profile)) throw new Error("This case is paused: its connection check failed");
  if (!window) throw new Error("Main window missing");
  const ses = prepareSession(partition, profile);
  await applyRoute(ses, partition, route);

  const label = `tab-${randomBytes(16).toString("hex")}`;
  const view = new WebContentsView({
    webPreferences: {
      partition, preload: tabPreload(), sandbox: true, contextIsolation: true, nodeIntegration: false,
      // The preload (page scripts only) also runs in frames, so WebRTC is removed there too.
      nodeIntegrationInSubFrames: true, webviewTag: false, spellcheck: false, safeDialogs: true, navigateOnDragDrop: false,
    },
  });
  const wc = view.webContents;
  // Only proxied traffic for WebRTC, in case a page reaches it before the script runs.
  wc.setWebRTCIPHandlingPolicy("disable_non_proxied_udp");
  const guard = (e: { preventDefault(): void }, next: string) => {
    if (blocked.has(profile) && !next.startsWith("about:")) { e.preventDefault(); return; }
    if (!allowedNavigation(next)) {
      e.preventDefault();
      emit("browser:blocked", { label, kind: "blocked", url: next, title: null });
    }
  };
  wc.on("will-navigate", (e) => guard(e, e.url));
  wc.on("will-frame-navigate", (e) => { if (!e.isMainFrame) guard(e, e.url); });
  wc.on("will-redirect", (e) => guard(e, e.url));
  // Popups and target=_blank links open as app tabs instead of windows.
  wc.setWindowOpenHandler(({ url: next }) => {
    if (allowedNavigation(next)) emit("browser:open-request", { label, kind: "open", url: next, title: null });
    return { action: "deny" };
  });
  wc.on("did-start-navigation", (e) => {
    if (e.isMainFrame && !e.isSameDocument) emit("browser:page", { label, kind: "started", url: e.url, title: null });
  });
  // The end of every load, however it ended (done, failed, stopped or replaced), as WebKit reported it.
  wc.on("did-stop-loading", () => emit("browser:page", { label, kind: "finished", url: wc.getURL(), title: null }));
  wc.on("page-title-updated", (_e, title) => emit("browser:page", { label, kind: "title", url: wc.getURL(), title }));
  // Results pages rewrite their address after loading; report it as the page's current address.
  wc.on("did-navigate-in-page", (_e, next, isMainFrame) => {
    if (isMainFrame) emit("browser:page", { label, kind: "title", url: next, title: wc.getTitle() });
  });
  // Frames get the page scripts through the preload as they load; a frame the page creates
  // gets WebRTC removed as soon as it exists as well.
  wc.on("frame-created", (_e, { frame }) => { if (frame) void frame.executeJavaScript(WEBRTC_JS).catch(() => {}); });
  wc.on("context-menu", (_e, params) => pageMenu(label, wc, params).popup());

  window.contentView.addChildView(view);
  view.setVisible(false);
  tabs.set(label, { view, profile, partition });
  if (activate !== false || active === null) active = label;
  applyLayout();
  void wc.loadURL(target).catch(() => { /* reported through did-fail-load */ });
  return label;
});

command("browser_navigate", async ({ label, url }) => {
  const t = tab(label);
  void t.view.webContents.loadURL(parseWebUrl(String(url ?? ""))).catch(() => {});
});

command("browser_history", ({ label, action }) => {
  const wc = tab(label).view.webContents;
  switch (action) {
    case "back": if (wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack(); return;
    case "forward": if (wc.navigationHistory.canGoForward()) wc.navigationHistory.goForward(); return;
    case "reload": wc.reload(); return;
    case "stop": wc.stop(); return;
    default: throw new Error("Unknown history action");
  }
});

command("browser_activate", ({ label }) => {
  tab(label);
  active = label as string;
  applyLayout();
});

command("browser_close", ({ label }) => {
  const t = tab(label);
  tabs.delete(label as string);
  if (active === label) active = null;
  window?.contentView.removeChildView(t.view);
  t.view.webContents.close();
});

/** The app reports where pages appear, and whether at all (hidden under the Search Lab or a dialog). */
command("browser_layout", ({ x, y, width, height, visible: v }) => {
  bounds = { x: Number(x) || 0, y: Number(y) || 0, width: Number(width) || 0, height: Number(height) || 0 };
  visible = !!v && bounds.width > 1 && bounds.height > 1;
  applyLayout();
});

command("browser_focus", ({ label }) => { tab(label).view.webContents.focus(); });

command("app_focus", () => { window?.webContents.focus(); });

/** Run a bundled read-only script in a tab and return its JSON result. */
export async function evalJson(label: unknown, js: string): Promise<Record<string, unknown>> {
  const wc = tab(label).view.webContents;
  let timer: NodeJS.Timeout | undefined;
  try {
    const raw = await Promise.race([
      wc.executeJavaScript(js, true),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("The page did not respond (still loading?)")), 8000); }),
    ]);
    return decodeScriptResult(raw);
  } catch (e) {
    if (wc.isDestroyed()) throw new Error("The page closed");
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

command("browser_extract_serp", ({ label }) => evalJson(label, SERP_JS));
command("browser_page_info", ({ label }) => evalJson(label, PAGE_JS));
command("browser_capture", ({ label, mode }) => {
  if (mode !== "selection" && mode !== "page") throw new Error("Unknown capture mode");
  return evalJson(label, `${CAPTURE_JS.trimEnd().replace(/;$/, "")}(${JSON.stringify(mode)})`);
});

/** Delete a profile's cookies, logins and site storage on every route it has used. Its tabs must be closed. */
command("browser_clear_profile", async ({ profile, routeKeys }) => {
  if (typeof profile !== "string") throw new Error("Unknown browser profile");
  if ([...tabs.values()].some(t => t.profile === profile)) throw new Error("Close this profile's tabs first");
  const keys = new Set(["", ...(Array.isArray(routeKeys) ? routeKeys.filter((k): k is string => typeof k === "string") : [])]);
  for (const key of keys) {
    const ses = session.fromPartition(partitionFor(profile, key, e2eRun()));
    await ses.clearStorageData();
    await ses.clearCache();
    await ses.clearAuthCache();
    await ses.clearHostResolverCache();
  }
});


// ── Exit check ───────────────────────────────────────────────────────────────

/**
 * Where traffic through a route (or direct) leaves the internet. Checked with
 * the browser's own network stack and the same proxy settings tabs use, so it
 * tests what the tabs will do. The IP address itself is not passed on.
 */
command("network_exit", async ({ route: r }) => {
  const route = typeof r === "string" && r.trim() ? parseRoute(r) : "";
  const ses = session.fromPartition(`exit-check-${route ? Buffer.from(route).toString("hex") : "direct"}`);
  await ses.setProxy(proxyConfig(route));
  await ses.closeAllConnections();
  const check = process.env.HVNT33_EXIT_CHECK_URL || "https://am.i.mullvad.net/json";
  let res: Response;
  try {
    res = await ses.fetch(check, { headers: { Accept: "application/json", "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(15_000), cache: "no-store" });
  } catch (e) {
    throw new Error(`Could not reach the exit check through this route: ${(e as Error).message}`);
  }
  if (!res.ok) throw new Error(`The exit check returned ${res.status}`);
  const v = await res.json() as Record<string, unknown>;
  const text = (x: unknown) => (typeof x === "string" ? x : "");
  return { country: text(v.country), city: text(v.city), org: text(v.organization ?? v.org), vpn: v.mullvad_exit_ip === true ? "Mullvad" : "" };
});

// ── Context menu ─────────────────────────────────────────────────────────────

function pageMenu(label: string, wc: WebContents, p: Electron.ContextMenuParams): Menu {
  const items: Electron.MenuItemConstructorOptions[] = [];
  if (p.linkURL && allowedNavigation(p.linkURL)) {
    items.push({ label: "Open Link in New Tab", click: () => emit("browser:open-request", { label, kind: "open", url: p.linkURL, title: null }) });
    items.push({ label: "Copy Link Address", click: () => clipboard.writeText(p.linkURL) });
    items.push({ type: "separator" });
  }
  if (p.mediaType === "image" && p.srcURL) {
    items.push({ label: "Copy Image Address", click: () => clipboard.writeText(p.srcURL) });
    items.push({ type: "separator" });
  }
  if (p.isEditable) items.push({ role: "cut" }, { role: "copy" }, { role: "paste" });
  else if (p.selectionText) items.push({ role: "copy" });
  items.push({ role: "selectAll" });
  if (!app.isPackaged) items.push({ type: "separator" }, { label: "Inspect Element", click: () => wc.inspectElement(p.x, p.y) });
  return Menu.buildFromTemplate(items);
}
