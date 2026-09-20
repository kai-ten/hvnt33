import { gzipSync } from "node:zlib";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { routes } from "./routes";

const origin = "http://127.0.0.1:4420";

// Loads a page and collects anything that should never happen on it.
// Lapis is the site; dark stone is the visitor's choice, kept in localStorage.
async function useTheme(page: Page, theme: "light" | "dark") {
  await page.addInitScript(t => { try { localStorage.setItem("theme", t); } catch {} }, theme);
}

async function visit(page: Page, route: string) {
  const problems: string[] = [];
  page.on("console", m => { if (m.type() === "error") problems.push(`console: ${m.text()}`); });
  page.on("pageerror", e => problems.push(`page error: ${e.message}`));
  page.on("request", r => { if (!r.url().startsWith(origin) && !r.url().startsWith("data:")) problems.push(`off-site request: ${r.url()}`); });
  page.on("requestfailed", r => {
    // Next's router cancels its own HEAD probes once it has the headers.
    if (r.method() === "HEAD" && r.failure()?.errorText === "net::ERR_ABORTED") return;
    problems.push(`failed: ${r.method()} ${r.url()} ${r.failure()?.errorText}`);
  });
  page.on("response", r => { if (r.status() >= 400) problems.push(`${r.status()}: ${r.url()}`); });
  await page.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", e => console.error(`CSP violation: ${e.violatedDirective} ${e.blockedURI}`));
  });
  await page.goto(route, { waitUntil: "networkidle" });
  return problems;
}

for (const theme of ["light", "dark"] as const) {
  for (const width of [320, 768, 1440, 2560]) {
    test.describe(`${theme} at ${width}px`, () => {
      test.use({ viewport: { width, height: 900 } });
      for (const route of routes) {
        test(`${route} fits, loads only from this site, and has no errors`, async ({ page }) => {
          await useTheme(page, theme);
          const problems = await visit(page, route);
          const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
          expect(overflow, "horizontal scroll").toBeLessThanOrEqual(0);
          expect(problems).toEqual([]);
        });
      }
    });
  }
}

for (const theme of ["light", "dark"] as const) {
  test.describe(`accessibility, ${theme}`, () => {
    test.use({ reducedMotion: "reduce" });
    for (const route of [...routes, "/missing-page"]) {
      test(`${route} has no WCAG 2.2 AA violations`, async ({ page }) => {
        await useTheme(page, theme);
        await page.goto(route, { waitUntil: "networkidle" });
        const { violations } = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
        expect(violations.map(v => `${v.id}: ${v.nodes.map(n => n.target.join(" ")).join(", ")}`)).toEqual([]);
      });
    }
  });
}

test("security headers are sent, and every page carries its script hashes", async ({ request }) => {
  for (const route of routes) {
    const res = await request.get(route);
    const h = res.headers();
    expect(h["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(h["strict-transport-security"]).toContain("max-age=63072000");
    expect(h["x-content-type-options"]).toBe("nosniff");
    expect(h["referrer-policy"]).toBe("no-referrer");
    expect(h["permissions-policy"]).toContain("camera=()");
    expect(h["cross-origin-opener-policy"]).toBe("same-origin");
    const html = await res.text();
    expect(html).toMatch(/<meta http-equiv="Content-Security-Policy" content="script-src 'self' 'sha256-/);
    expect(html).not.toContain("unsafe-eval");
    expect(html).not.toContain("{{");
  }
});

test("an inline script that isn't hashed is blocked", async ({ page }) => {
  const violations: string[] = [];
  page.on("console", m => { if (/Content Security Policy/i.test(m.text())) violations.push(m.text()); });
  await page.goto("/", { waitUntil: "networkidle" });
  const ran = await page.evaluate(async () => {
    const s = document.createElement("script");
    s.textContent = "window.__injected = true";
    document.body.append(s);
    await new Promise(r => setTimeout(r, 100));
    return (window as unknown as { __injected?: boolean }).__injected === true;
  });
  expect(ran).toBe(false);
});

test.describe("motion", () => {
  test("the mosaic is laid, and the pointer rakes light across it", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    // The floor is laid in about four and a half seconds; the light follows the pointer after that.
    await page.waitForTimeout(5500);
    const ink = () => page.getByTestId("mosaic").evaluate(c => {
      const ctx = (c as HTMLCanvasElement).getContext("2d")!;
      const { width, height } = c as HTMLCanvasElement;
      const d = ctx.getImageData(Math.round(width * 0.6), Math.round(height * 0.3), Math.round(width * 0.2), Math.round(height * 0.2)).data;
      let sum = 0;
      // Brightness of the painted stone: the raking light raises it.
      for (let i = 0; i < d.length; i += 4) if (d[i + 3]) sum += d[i] + d[i + 1] + d[i + 2];
      return sum;
    });
    const before = await ink();
    expect(before).toBeGreaterThan(0);
    await page.mouse.move(1440 * 0.7, 900 * 0.4);
    await page.waitForTimeout(150);
    expect(await ink()).toBeGreaterThan(before);
  });

  for (const [label, viewport] of [["wide", { width: 1440, height: 900 }], ["phone", { width: 390, height: 844 }]] as const) {
    test(`the story is held in place and its mosaic follows the scroll (${label})`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.goto("/");
      const story = page.locator(".story");
      await expect(story).toHaveAttribute("data-live", "");
      const range = await story.evaluate(el => ({ top: el.getBoundingClientRect().top + scrollY, len: (el as HTMLElement).offsetHeight - innerHeight }));
      const film = () => page.getByTestId("story-mosaic").evaluate(c => (c as HTMLCanvasElement).toDataURL());
      const steps = page.locator(".step");
      await expect(steps).toHaveCount(3);
      const frames: string[] = [];
      // Scene 0 at the start, 3 at the end, and each step marked with its scene.
      for (const [f, scene, step] of [[0, 0, 0], [0.33, 1, 1], [0.66, 2, 2], [1, 3, 2]] as const) {
        await page.evaluate(y => scrollTo(0, y), range.top + range.len * f);
        await expect(story).toHaveAttribute("data-scene", String(scene));
        await expect(steps.nth(step)).toHaveAttribute("data-active", "");
        frames.push(await film());
      }
      expect(new Set(frames).size).toBe(4);
      // The mosaic and the steps are both on screen while it plays.
      for (const el of [page.locator(".story-film"), steps.last()]) {
        const box = (await el.boundingBox())!;
        expect(box.y).toBeGreaterThanOrEqual(0);
        expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
      }
      // The step on show is in full ink; the others fall back.
      await page.waitForTimeout(500);
      const color = (i: number) => steps.nth(i).locator("p").evaluate(el => getComputedStyle(el).color);
      expect(await color(2)).not.toBe(await color(0));
    });
  }

  test("with reduced motion the story is not held and shows its last scene, every step in full ink", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    const story = page.locator(".story");
    await expect(story).not.toHaveAttribute("data-live", "");
    await expect(story).toHaveAttribute("data-scene", "3");
    const colors = await page.locator(".step p").evaluateAll(els => els.map(el => getComputedStyle(el).color));
    expect(new Set(colors).size).toBe(1);
  });

  test("sections that scroll into view are revealed, and none stay hidden", async ({ page }) => {
    await page.goto("/features");
    await page.evaluate(async () => { for (let y = 0; y < document.body.scrollHeight; y += 400) { scrollTo(0, y); await new Promise(r => setTimeout(r, 30)); } });
    await page.waitForTimeout(1000);
    const hidden = await page.$$eval("[data-reveal]", els => els.filter(e => getComputedStyle(e).opacity !== "1").length);
    expect(hidden).toBe(0);
  });
});

test("docs search finds a section and opens it", async ({ page }) => {
  await page.goto("/docs", { waitUntil: "networkidle" });
  await page.keyboard.press("/");
  await page.getByRole("searchbox", { name: "Search the docs" }).fill("search lab");
  await expect(page.getByRole("option").first()).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/docs\//);
});

test("Lapis is the default whatever the system prefers, and the dark choice sticks", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/");
  expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe("rgb(235, 229, 216)");
  await page.getByRole("button", { name: "Switch between light and dark stone" }).click();
  await page.goto("/features");
  expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe("dark");
  expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe("rgb(21, 19, 17)");
});

test("copy buttons copy the commands only, without prompts or comments", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/download");
  await page.getByRole("button", { name: "Copy: Get the source" }).click();
  const text = await page.evaluate(() => navigator.clipboard.readText());
  expect(text).toBe("git clone https://github.com/kai-ten/hvnt33.git hvnt33\ncd hvnt33");
});

test("download page shows the current release and signed platform installers", async ({ page }) => {
  await page.goto("/download");
  await expect(page.getByText("Latest: v0.1.0")).toBeVisible();
  await expect(page.getByRole("link", { name: "Download v0.1.0" })).toHaveCount(2);
  await expect(page.getByText("macOS builds are signed, notarized and stapled.")).toBeVisible();
});

test("every internal link and anchor resolves", async ({ page, request }) => {
  const checked = new Map<string, Set<string>>();
  const ids = async (path: string) => {
    if (!checked.has(path)) {
      const res = await request.get(path);
      expect(res.status(), path).toBe(200);
      const html = await res.text();
      checked.set(path, new Set([...html.matchAll(/\sid="([^"]+)"/g)].map(m => m[1])));
    }
    return checked.get(path)!;
  };
  for (const route of routes) {
    await page.goto(route);
    const hrefs = await page.$$eval("a[href]", as => as.map(a => (a as HTMLAnchorElement).href));
    for (const href of new Set(hrefs)) {
      const url = new URL(href);
      if (url.origin !== origin) continue;
      const found = await ids(url.pathname);
      if (url.hash) expect(found.has(decodeURIComponent(url.hash.slice(1))), `${route} → ${href}`).toBe(true);
    }
  }
});

test("pages stay inside their JavaScript budget", async ({ page, request }) => {
  // React and the Next router are about 135KB of this on every page; the rest is ours.
  // Home carries the two mosaics (about 20KB of the site's own code).
  // Download carries the live platform/release selector (about 4 KB compressed).
  const budgets: Record<string, number> = { "/": 170_000, "/features": 160_000, "/download": 165_000, "/investigations": 160_000, "/cloud": 160_000, "/community": 160_000, "/docs/desktop": 160_000 };
  for (const [route, budget] of Object.entries(budgets)) {
    await page.goto(route);
    // noModule scripts are legacy polyfills that modern browsers never download.
    const srcs = await page.$$eval("script[src]:not([nomodule])", s => s.map(x => (x as HTMLScriptElement).src));
    let total = 0;
    for (const src of srcs) total += gzipSync(await (await request.get(src)).body()).length;
    expect(total, `${route} ships ${total} bytes of compressed JavaScript`).toBeLessThanOrEqual(budget);
  }
});
