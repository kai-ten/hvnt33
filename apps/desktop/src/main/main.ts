// hvnt33: search engines, a capture-enabled browser, the live investigation and
// an agent terminal in one window, with the server and database built in.
import { app, BrowserWindow, Menu, nativeTheme, net, protocol, session, shell } from "electron";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { attachWindow, e2eEnabled, e2eRun, learnBrands, removeStaleE2ESessions } from "./browser.ts";
import { initConnection } from "./connection.ts";
import { registerE2E } from "./e2e.ts";
import { command, commandNames, listen, setAppView } from "./ipc.ts";
import { buildMenu, setAppTheme, type AppTheme } from "./menu.ts";
import { killAllPty } from "./pty.ts";
import { stopServices } from "./server.ts";
import { hydrateShellEnv } from "./shell-env.ts";
import { initUpdates } from "./updates.ts";

// The app interface is served from its own scheme, never from the web or file://.
const APP_ORIGIN = "app://hvnt33";
const renderer = path.join(import.meta.dirname, "..", "renderer");
const CSP = [
  "default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline'", "img-src 'self' data: https: http:",
  "font-src 'self' data:", "connect-src 'none'", "object-src 'none'", "base-uri 'none'", "frame-ancestors 'none'",
].join("; ");

protocol.registerSchemesAsPrivileged([{ scheme: "app", privileges: { standard: true, secure: true, supportFetchAPI: false } }]);
// In development macOS otherwise uses the executable's generic "Electron"
// name in the application menu even though packaged builds have productName.
app.setName("HVNT33");
// No DNS prefetching: names are resolved only when a page is actually loaded (through its case's route).
app.commandLine.appendSwitch("dns-prefetch-disable");
// End-to-end runs keep painting while other windows cover the app, so screenshots are current.
if (process.env.HVNT33_E2E === "1" && !app.isPackaged) {
  app.commandLine.appendSwitch("disable-backgrounding-occluded-windows");
  app.commandLine.appendSwitch("disable-renderer-backgrounding");
}
// The app shows its name as HVNT33, but its data stays in a folder named
// "hvnt33": Electron would otherwise follow the product name, and on
// case-sensitive disks existing cases would seem to vanish.
app.setPath("userData", path.join(app.getPath("appData"), "hvnt33"));
// Development runs with HVNT33_USER_DATA keep their browser data apart (tests use this).
if (process.env.HVNT33_USER_DATA && !app.isPackaged) app.setPath("userData", path.resolve(process.env.HVNT33_USER_DATA));

hydrateShellEnv();
registerE2E(() => window);

const EXTERNAL_HOSTS = new Set(["hvnt33.com", "www.hvnt33.com", "github.com", "discord.com", "www.discord.com", "discord.gg"]);
command("external_open", async ({ url: raw }) => {
  const url = new URL(String(raw ?? ""));
  if (url.protocol !== "https:" || !EXTERNAL_HOSTS.has(url.hostname.toLowerCase())) throw Error("External address not allowed");
  await shell.openExternal(url.href);
});
command("theme_set", ({ theme: raw }) => {
  const theme: AppTheme = raw === "system" || raw === "nox" ? raw : "lapis";
  setAppTheme(theme);
});

let window: BrowserWindow | null = null;
const isAppUrl = (url: string) => url.startsWith(`${APP_ORIGIN}/`);

function serveApp(ses: Electron.Session) {
  ses.protocol.handle("app", async request => {
    const url = new URL(request.url);
    if (url.host !== "hvnt33") return new Response("Not found", { status: 404 });
    const file = path.normalize(path.join(renderer, decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname)));
    if (!file.startsWith(renderer + path.sep)) return new Response("Not found", { status: 404 });
    const res = await net.fetch(pathToFileURL(file).href);
    const headers = new Headers(res.headers);
    headers.set("Content-Security-Policy", CSP);
    headers.set("X-Content-Type-Options", "nosniff");
    return new Response(res.body, { status: res.status, headers });
  });
}

function createWindow() {
  // End-to-end runs keep the app's own storage apart from the researcher's too.
  const partition = e2eEnabled() ? `persist:h33e-${e2eRun()}-app` : undefined;
  const appSession = partition ? session.fromPartition(partition) : session.defaultSession;
  serveApp(appSession);
  appSession.setPermissionRequestHandler((_wc, permission, cb) => cb(permission === "clipboard-sanitized-write"));
  window = new BrowserWindow({
    title: "HVNT33", width: 1560, height: 980, minWidth: 1024, minHeight: 640, show: false, backgroundColor: nativeTheme.shouldUseDarkColors ? "#171612" : "#EBE5D8",
    webPreferences: {
      ...(partition ? { partition } : {}),
      preload: path.join(import.meta.dirname, "..", "preload", "app.cjs"),
      sandbox: true, contextIsolation: true, nodeIntegration: false, webviewTag: false, spellcheck: false,
    },
  });
  const contents = window.webContents;
  setAppView(contents);
  attachWindow(window);
  // The app view stays on its own pages; links it shows open as tabs, not here.
  contents.on("will-navigate", e => { if (!isAppUrl(e.url)) e.preventDefault(); });
  contents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.once("ready-to-show", () => window?.show());
  window.on("closed", () => { window = null; });
  void window.loadURL(`${APP_ORIGIN}/index.html`);
}

// One copy of the app at a time: a second launch focuses the first.
if (!app.requestSingleInstanceLock() && !e2eEnabled()) {
  app.quit();
} else {
  app.on("second-instance", () => { if (window) { if (window.isMinimized()) window.restore(); window.focus(); } });
  app.whenReady().then(async () => {
    removeStaleE2ESessions();
    await learnBrands();
    initConnection();
    listen(isAppUrl);
    Menu.setApplicationMenu(buildMenu());
    // Packaged builds take the icon from build-resources; show the same mark in development.
    if (!app.isPackaged) app.dock?.setIcon(path.join(app.getAppPath(), "build-resources", "icon.png"));
    createWindow();
    initUpdates();
    if (process.env.HVNT33_DEBUG_COMMANDS) console.log(commandNames().sort().join("\n"));
  });
}

app.on("window-all-closed", () => app.quit());

// Stop what the app started (the server stops the database with it) before quitting.
let quitting = false;
app.on("before-quit", event => {
  if (quitting) return;
  event.preventDefault();
  quitting = true;
  killAllPty();
  void stopServices().finally(() => app.quit());
});
