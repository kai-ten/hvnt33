// End-to-end test hooks. Inert unless this is a development run started with
// HVNT33_E2E=1 (see scripts/e2e.ts): the app then runs a scripted session
// against real search engines and writes a JSON report.
import { app, nativeImage, type BrowserWindow } from "electron";
import fs from "node:fs";
import path from "node:path";
import { e2eEnabled, evalJson, flushSessions, visibleTab } from "./browser.ts";
import { command } from "./ipc.ts";
import { isTabLabel } from "./policy.ts";
import { stopServices } from "./server.ts";

const hooksOff = () => new Error("E2E hooks are disabled");

export function registerE2E(window: () => BrowserWindow | null) {
  command("e2e_config", () => e2eEnabled() ? {
    query: process.env.HVNT33_E2E_QUERY || "Henry Kravis KKR",
    article: process.env.HVNT33_E2E_ARTICLE || "https://en.wikipedia.org/wiki/Henry_Kravis",
    changing: process.env.HVNT33_E2E_CHANGING ?? null,
    only: process.env.HVNT33_E2E_ONLY ?? null,
    relaunchCase: process.env.HVNT33_E2E_CASE ?? null,
    socks: process.env.HVNT33_E2E_SOCKS ?? null,
    socksAuth: process.env.HVNT33_E2E_SOCKS_AUTH ?? null,
    tour: process.env.HVNT33_E2E_TOUR === "1",
  } : null);

  /** Run test-only JavaScript in a browsed tab (to make a selection or probe isolation). */
  command("e2e_eval", ({ label, js }) => {
    if (!e2eEnabled()) throw hooksOff();
    if (!isTabLabel(label)) throw new Error("No such tab");
    return evalJson(label, String(js ?? ""));
  });

  /** The UI reached a named state: save a screenshot of the window (app and visible page) when asked for. */
  command("e2e_stage", async ({ name }) => {
    if (!e2eEnabled() || typeof name !== "string" || !/^[A-Za-z0-9-]+$/.test(name)) throw hooksOff();
    const dir = process.env.HVNT33_E2E_SHOTS;
    const win = window();
    if (!dir || !win) return;
    fs.mkdirSync(dir, { recursive: true });
    // Both pictures at one pixel per point, so the page lands exactly where it is on screen.
    const [w, h] = win.getContentSize();
    const base = (await win.webContents.capturePage()).resize({ width: w, height: h }).toBitmap();
    const page = visibleTab();
    if (page) {
      const b = page.view.getBounds();
      const top = (await page.view.webContents.capturePage()).resize({ width: b.width, height: b.height }).toBitmap();
      const cols = Math.max(0, Math.min(b.width, w - b.x));
      for (let y = 0; y < b.height && b.y + y < h; y++) top.copy(base, ((b.y + y) * w + b.x) * 4, y * b.width * 4, (y * b.width + cols) * 4);
    }
    fs.writeFileSync(path.join(dir, `${name}.png`), nativeImage.createFromBitmap(base, { width: w, height: h }).toPNG());
  });

  command("e2e_progress", ({ name }) => {
    if (!e2eEnabled()) throw hooksOff();
    console.log(`[e2e] ${String(name).slice(0, 200)}`);
  });

  command("e2e_finish", async ({ report }) => {
    if (!e2eEnabled()) throw hooksOff();
    const file = process.env.HVNT33_E2E_REPORT;
    if (!file) throw new Error("HVNT33_E2E_REPORT not set");
    fs.writeFileSync(file, JSON.stringify(report, null, 2));
    // app.exit skips Chromium's shutdown writes: keep the app's tabs and the cases' sign-ins for the relaunch check.
    const win = window();
    await flushSessions(win ? [win.webContents.session] : []);
    await stopServices();
    app.exit((report as { ok?: boolean })?.ok ? 0 : 1);
  });
}
