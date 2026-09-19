// The one channel between the app interface and the native side. Commands are
// registered by name (the same names the UI's bindings use) and answered only
// for the app's own view: browsed tabs have no preload bridge, and a message
// from any other frame is refused here as well.
import { ipcMain, type WebContents } from "electron";

type Handler = (args: Record<string, unknown>) => unknown;

const handlers = new Map<string, Handler>();
let app: WebContents | null = null;

export function command(name: string, handler: Handler) {
  if (handlers.has(name)) throw new Error(`Command ${name} registered twice`);
  handlers.set(name, handler);
}

export const commandNames = () => [...handlers.keys()];

/** The app view: the only sender commands are answered for, and where events go. */
export function setAppView(contents: WebContents) { app = contents; }

export function emit(event: string, payload: unknown) {
  if (app && !app.isDestroyed()) app.send("hvnt33:event", event, payload);
}

/** Replies are `{ ok, value }` or `{ ok: false, error }`, so the UI gets the command's own message. */
export function listen(isAppUrl: (url: string) => boolean) {
  ipcMain.handle("hvnt33:invoke", async (event, name: unknown, args: unknown) => {
    if (!app || event.sender !== app || event.senderFrame !== app.mainFrame || !isAppUrl(event.senderFrame.url)) {
      return { ok: false, error: "Not allowed" };
    }
    const handler = typeof name === "string" ? handlers.get(name) : undefined;
    if (process.env.HVNT33_TRACE) console.error(`[ipc] ${String(name)}`);
    if (!handler) return { ok: false, error: `Unknown command ${String(name)}` };
    try {
      return { ok: true, value: await handler(args && typeof args === "object" ? (args as Record<string, unknown>) : {}) };
    } catch (e) {
      if (process.env.HVNT33_TRACE) console.error(`[ipc] ${String(name)} failed: ${e instanceof Error ? e.message : String(e)}`);
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });
}
