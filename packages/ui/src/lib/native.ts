// The app's native side: the shell hosting this UI (apps/desktop, on Electron)
// implements these commands and events, and hands its bridge to `mount`
// before the UI renders. The UI never imports the shell. Typed bindings for each command follow.
import type { SerpResult } from "@hvnt33/core/events";

export type Unlisten = () => void;

export interface NativeBridge {
  /** Run a native command; rejects with the command's error message. */
  invoke<T>(command: string, args?: Record<string, unknown>): Promise<T>;
  /** Receive a native event; resolves to a function that stops listening. */
  listen<T>(event: string, fn: (payload: T) => void): Promise<Unlisten>;
  /** Give keyboard focus back to the app (away from a browsed page). */
  focusApp(): Promise<void>;
  /** Where a file dropped on the app lives on disk ('' when it has no path, e.g. dragged from a page). */
  pathForFile?(file: File): string;
}

let bridge: NativeBridge | null = null;

export function setNative(b: NativeBridge) { bridge = b; }

/** Whether the UI runs inside the app (not in a plain browser, where native commands do not exist). */
export const hasNative = () => bridge !== null;

export function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (!bridge) return Promise.reject(new Error("hvnt33's native side is not available here"));
  return bridge.invoke<T>(command, args);
}

function listen<T>(event: string, fn: (payload: T) => void): Promise<Unlisten> {
  if (!bridge) return Promise.resolve(() => {});
  return bridge.listen<T>(event, fn);
}

export const pathForFile = (file: File): string => { try { return bridge?.pathForFile?.(file) ?? ""; } catch { return ""; } };

/** Windows takes quoted paths; the others escape. */
export const onWindows = () => typeof navigator !== "undefined" && /Windows/i.test(navigator.userAgent);

export const focusApp = () => (bridge ? bridge.focusApp().catch(() => {}) : Promise.resolve());

export type AppTheme = "system" | "lapis" | "nox";
/** Keep the operating-system window chrome and native Appearance menu in step with the renderer. */
export const setNativeTheme = (theme: AppTheme) => bridge ? invoke<void>("theme_set", { theme }) : Promise.resolve();

/** Open a small allowlisted set of HVNT33 community links in the system browser. */
export const openExternal = (url: string) => bridge
  ? invoke<void>("external_open", { url })
  : Promise.resolve(window.open(url, "_blank", "noopener,noreferrer")).then(() => undefined);

export interface ServiceStatus { server: boolean; database: boolean; url: string; root: string; startedByApp: boolean; detail: string; current: boolean; remote: boolean; hasWorkspace: boolean }
export interface ConnectionInfo { url: string; remote: boolean; hasToken: boolean; workspace: { id: string; name: string; plan: string } | null }
export const connection = {
  get: () => invoke<ConnectionInfo>("connection_get"),
  set: (url: string, token: string) => invoke<ConnectionInfo>("connection_set", { url, token: token || null }),
  reset: () => invoke<ConnectionInfo>("connection_reset"),
};

/** Where traffic leaves the internet, through a route or directly (no IP address). */
export interface Exit { country: string; city: string; org: string; vpn: string }
export const network = {
  exit: (route: string) => invoke<Exit>("network_exit", { route: route || null }),
};

export const services = {
  status: () => invoke<ServiceStatus>("services_status"),
  start: () => invoke<ServiceStatus>("services_start"),
  /** Native folder picker; null when cancelled. */
  chooseWorkspace: () => invoke<string | null>("workspace_choose"),
};

export interface PageEvent { label: string; kind: "started" | "finished" | "title" | "blocked" | "open"; url: string; title?: string | null }
export interface DownloadEvent { label: string; state: "started" | "finished" | "failed"; url: string; path?: string }

export interface SerpExtraction { engine: string; url: string; title: string; results: SerpResult[]; challenge?: boolean }

export interface PageCapture {
  mode: "selection" | "page";
  url: string;
  title: string;
  selection: string;
  context: string;
  pageText: string;
  images: { src: string; alt: string; caption: string; width: number; height: number }[];
  meta: { description: string; author: string; published: string; siteName: string; canonical: string; lang: string };
  error?: string;
}

export interface PageInfo {
  url: string; title: string; heading: string; canonical: string; description: string; author: string;
  published: string; modified: string; siteName: string; type: string; schemaTypes: string[]; lang: string;
  referrer: string; wordCount: number; images: number;
  links: { total: number; external: number; domains: { domain: string; count: number }[] };
}

export const browser = {
  /** `profile`: "shared" or a case id (that case's own cookies and logins). */
  /** `route`: the proxy the tab connects to; `routeKey`: which of the case's cookie jars ("" direct, "tor", or the proxy). */
  open: (url: string, activate = true, profile = "shared", route = "", routeKey = "") => invoke<string>("browser_open", { url, activate, profile, route: route || null, routeKey: routeKey || null }),
  /** The kill switch: while blocked, a profile's tabs load nothing. */
  blockProfile: (profile: string, blocked: boolean) => invoke<void>("browser_block_profile", { profile, blocked }),
  /** Delete a profile's cookies, logins and site storage (its tabs must be closed). */
  clearProfile: (profile: string, routeKeys: string[] = []) => invoke<void>("browser_clear_profile", { profile, routeKeys }),
  navigate: (label: string, url: string) => invoke<void>("browser_navigate", { label, url }),
  history: (label: string, action: "back" | "forward" | "reload" | "stop") => invoke<void>("browser_history", { label, action }),
  activate: (label: string) => invoke<void>("browser_activate", { label }),
  close: (label: string) => invoke<void>("browser_close", { label }),
  layout: (r: { x: number; y: number; width: number; height: number; visible: boolean }) =>
    invoke<void>("browser_layout", { ...r, viewportHeight: window.innerHeight }),
  focus: (label: string) => invoke<void>("browser_focus", { label }),
  extractSerp: (label: string) => invoke<SerpExtraction>("browser_extract_serp", { label }),
  capture: (label: string, mode: "selection" | "page") => invoke<PageCapture>("browser_capture", { label, mode }),
  pageInfo: (label: string) => invoke<PageInfo>("browser_page_info", { label }),
  onPage: (fn: (e: PageEvent) => void) => listen<PageEvent>("browser:page", fn),
  onOpenRequest: (fn: (e: PageEvent) => void) => listen<PageEvent>("browser:open-request", fn),
  onBlocked: (fn: (e: PageEvent) => void) => listen<PageEvent>("browser:blocked", fn),
  onDownload: (fn: (e: DownloadEvent) => void) => listen<DownloadEvent>("browser:download", fn),
};

export interface CaptureRequest {
  investigationId: string; title: string; text: string; sourceUrl: string; sourceLabel: string;
  contentOrigin: string; researcherNote: string; captureMeta: Record<string, string>; imageUrl: string | null;
}
/** `label`: the tab captured from; its image original is fetched through that tab's connection (the case's route). */
export const submitCapture = (request: CaptureRequest, label?: string) => invoke<{ id: string; title: string }>("capture_submit", { request, label: label ?? null });

export interface Provider { provider: "claude" | "codex" | "shell"; command: string; args: string[]; label: string }
export const pty = {
  providers: () => invoke<Provider[]>("pty_providers"),
  spawn: (provider: string, resume: boolean, cols: number, rows: number) => invoke<string>("pty_spawn", { provider, resume, cols, rows }),
  write: (sessionId: string, data: string) => invoke<void>("pty_write", { sessionId, data }),
  resize: (sessionId: string, cols: number, rows: number) => invoke<void>("pty_resize", { sessionId, cols, rows }),
  kill: (sessionId: string) => invoke<void>("pty_kill", { sessionId }),
  onOutput: (id: string, fn: (data: string) => void): Promise<Unlisten> => listen<{ data: string }>(`pty:output:${id}`, e => fn(e.data)),
  onExit: (id: string, fn: (code: number | null) => void): Promise<Unlisten> => listen<{ code: number | null }>(`pty:exit:${id}`, e => fn(e.code)),
};

export const onMenu = (fn: (id: string) => void) => listen<string>("menu", fn);

export interface UpdateRelease { version: string; name: string; url: string; publishedAt: string; prerelease: boolean }
export interface UpdateState { status: "idle" | "checking" | "current" | "available" | "error"; currentVersion: string; release: UpdateRelease | null; message: string }
export const updates = {
  get: () => invoke<UpdateState>("update_get"),
  check: () => invoke<UpdateState>("update_check"),
  onState: (fn: (state: UpdateState) => void) => listen<UpdateState>("update:state", fn),
};
