// Screenshots of the built site for review: every main page at phone and
// desktop widths, in both themes.
//   npm run shots -- [DIR]    (serves out/ itself)
import { spawn } from "node:child_process";
import path from "node:path";
import { chromium } from "@playwright/test";

const dir = path.resolve(process.argv[2] ?? "site-shots");
const port = 4411;
const server = spawn(process.execPath, [path.join(import.meta.dirname, "serve.ts"), "--port", String(port)], { stdio: "ignore" });
await new Promise(r => setTimeout(r, 600));
const routes = ["/", "/features", "/get-started", "/docs", "/docs/desktop", "/security", "/nope"];
const browser = await chromium.launch();
try {
  for (const scheme of ["light", "dark"] as const) {
    for (const width of [375, 1440]) {
      const page = await browser.newPage({ viewport: { width, height: width < 800 ? 812 : 900 }, reducedMotion: "reduce" });
      await page.addInitScript(t => { try { localStorage.setItem("theme", t); } catch { /* none */ } }, scheme);
      for (const route of routes) {
        await page.goto(`http://127.0.0.1:${port}${route}`, { waitUntil: "networkidle" });
        const name = `${route === "/" ? "home" : route.slice(1).replaceAll("/", "-")}-${width}-${scheme}.png`;
        await page.screenshot({ path: path.join(dir, name), fullPage: true });
      }
      await page.close();
    }
  }
  console.log(`shots: ${dir}`);
} finally {
  await browser.close();
  server.kill();
}
