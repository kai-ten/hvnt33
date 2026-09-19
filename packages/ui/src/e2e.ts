// Scripted end-to-end session, run only by `npm run e2e` (debug build with
// HVNT33_E2E=1). Exercises the real loop: fan-out search on live engines →
// observed results recorded in ArcadeDB → selection, image and page captures
// filed as intakes → Search Lab queries → isolation probes on a browsed page.
import { invoke } from "./lib/native";
import { ENGINES, type EngineId } from "@hvnt33/core/engines";
import { allEvents, type CaseNetwork, type Investigation, type OwnSnapshot, type SavedSearch } from "@hvnt33/core/events";
import { parseWaybackUrl, urlKey } from "@hvnt33/core/engines";
import type { ArchiveEntry, PanelTab } from "./components/DataPanel";
import { run } from "@hvnt33/core/spl";
import type { PageCapture } from "./lib/native";
import { client, data } from "./lib/data";
import { services } from "./lib/native";
import { loadTabs, tabsKey } from "./lib/tabs";

/** `changing`: a local page whose text changes on every request (for watches). */
/** `only`: run just one scenario while developing it ("profiles"). */
/** `socks`: a test SOCKS5 proxy (logging what passes) for the case-route checks. */
/** `socksAuth`: a proxy requiring the login e2e-user / e2e-pass; `tor`: whether a Tor stand-in is running. */
export interface E2EConfig { query: string; article: string; changing?: string; tour?: boolean; only?: string | null; relaunchCase?: string | null; socks?: string | null; socksAuth?: string | null }

export interface E2EContext {
  engines: EngineId[];
  engineTab(engine: EngineId): string | undefined;
  createCase(title: string, ownProfile?: boolean): Promise<Investigation>;
  selectCase(id: string): void;
  setProfile(choice: "shared" | "own"): Promise<void>;
  clearProfile(profile: string): Promise<void>;
  tabs(): { label: string; url: string; loading: boolean }[];
  /** True while a case's tab set is being swapped in. */
  restoring(): boolean;
  setNetwork(network: CaseNetwork & { tor?: boolean; credentials?: { username: string; password: string } | null }): Promise<void>;
  toggleTor(): Promise<void>;
  newExit(): Promise<void>;
  checkNetwork(): Promise<void>;
  netState(): { status: string; exit?: { country: string; org: string }; message?: string };
  fanOut(query: string): Promise<void>;
  openTab(url: string, foundVia?: { engine: EngineId; query: string } | null): Promise<string>;
  tab(label: string): PanelTab | undefined;
  saveSearch(query: string): Promise<void>;
  rerun(saved: SavedSearch): Promise<void>;
  /** Show a URL in the Search Lab preview pane; returns the preview tab. */
  preview(url: string): Promise<string>;
  archiveEntry(url: string): ArchiveEntry | undefined;
  activeTab(): string | null;
  /** Reload the case from the server (the app's own refresh pauses while its window is hidden). */
  refresh(): Promise<void>;
  /** UI state, for diagnosing failures. */
  debugState(): Record<string, unknown>;
  tabUrl(label: string): string | undefined;
  tabLoading(label: string): boolean;
  capture(label: string, mode: "selection" | "page"): Promise<PageCapture>;
  submit(capture: PageCapture, label: string, investigationId: string, note: string): Promise<{ id: string }>;
  /** The UI actions of the data panel's hvnt33 archive section. */
  snapshotNow(url: string): Promise<void>;
  watchPage(url: string, everyHours: number | null): Promise<void>;
  replay(snapshot: OwnSnapshot): Promise<string | undefined>;
  /** Tour mode: put the UI into a state worth a screenshot. */
  show(state: { view?: "browser" | "lab" | "case"; tab?: string; labQuery?: string; captureToChat?: "selection" | "page"; caseTab?: string }): Promise<void>;
}

type Check = { name: string; ok: boolean; detail?: unknown; ms: number };

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
async function waitFor<T>(what: string, fn: () => Promise<T | null | undefined | false> | T | null | undefined | false, timeout = 30_000, every = 500): Promise<T> {
  const end = Date.now() + timeout;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error(`Timed out waiting for ${what}`);
    await sleep(every);
  }
}
const pageEval = (label: string, body: string) => invoke<Record<string, unknown>>("e2e_eval", { label, js: `JSON.stringify((function(){${body}})())` });
/** pageEval for a page that may still be navigating (a reload makes one evaluation fail). */
const pageEvalSoon = (label: string, body: string) => pageEval(label, body).catch(() => ({} as Record<string, unknown>));

export async function runE2E(config: E2EConfig, ctx: E2EContext) {
  const checks: Check[] = [];
  const started = Date.now();
  let caseId = "";
  const step = async (name: string, fn: () => Promise<unknown>) => {
    const t = Date.now();
    // Progress for the runner, so a run that hangs says where (shells without the hook ignore it).
    void invoke("e2e_progress", { name }).catch(() => {});
    try { checks.push({ name, ok: true, detail: await fn(), ms: Date.now() - t }); }
    catch (e) { checks.push({ name, ok: false, detail: String(e), ms: Date.now() - t }); }
  };

  if (config.only === "real-tor") {
    // npm run e2e -- --real-tor: the built-in Tor, on the real Tor network.
    await step("create an investigation", async () => { caseId = (await ctx.createCase(`E2E — real Tor ${new Date().toISOString()}`, true)).id; return caseId; });
    await step("built-in Tor: a tab browses through the real Tor network", async () => {
      await waitFor("case shown", () => !ctx.restoring() && ctx.debugState().shownCase === caseId, 30_000, 200);
      const started = Date.now();
      await ctx.toggleTor();
      await waitFor("connected through Tor", () => ctx.netState().status === "ok", 180_000, 500);
      const label = await ctx.openTab("https://check.torproject.org/");
      await waitFor("check page", () => { const t = ctx.tab(label); return t && !t.loading; }, 120_000);
      const page = await waitFor("verdict", async () => { const r = await pageEvalSoon(label, `return {h: (document.querySelector('h1')||{}).innerText||'', ip: (document.querySelector('.content strong')||{}).innerText||''};`); return r.h ? r : null; }, 30_000);
      if (!/Congratulations/.test(String(page.h))) throw new Error(`not through Tor: ${page.h}`);
      if (config.tour) { await invoke("e2e_stage", { name: "real-tor" }); await sleep(1500); }
      const exit = ctx.netState().exit;
      await ctx.toggleTor();
      await waitFor("Tor off", () => ctx.netState().status === "direct", 30_000);
      return { verdict: page.h, exit, secondsToConnect: Math.round((Date.now() - started) / 1000) };
    });
    await invoke("e2e_finish", { report: { ok: checks.every(c => c.ok), caseId, extraCases: [], seconds: Math.round((Date.now() - started) / 1000), checks } });
    return;
  }

  if (config.only === "layout") {
    // npm run e2e -- --layout: the agent terminal across the bottom or at the side, at each size.
    // The page view must follow the space left for it, and the agent session must survive every move.
    await step("create an investigation", async () => { caseId = (await ctx.createCase(`E2E — layout ${new Date().toISOString()}`)).id; return caseId; });
    await step("the terminal docks, resizes, minimizes and maximizes; the page and the agent follow", async () => {
      await waitFor("case shown", () => !ctx.restoring() && ctx.debugState().shownCase === caseId, 30_000, 200);
      const q = (sel: string) => document.querySelector(sel) as HTMLElement | null;
      await invoke("e2e_stage", { name: "home" });
      if (document.querySelectorAll(".home-links button").length !== 3) throw new Error("the Home page community links are missing");
      const viewsBox = q(".views")?.getBoundingClientRect(), switcherBox = q(".case-switcher")?.getBoundingClientRect();
      if (!viewsBox || !switcherBox || switcherBox.left < viewsBox.right) throw new Error("the investigation selector is not to the right of the Case button");
      q(".case-switcher-button")?.click(); await sleep(100); q(".case-menu-new")?.click(); await sleep(400);
      if (!q(".case-admin .case-create-card")) throw new Error("new investigation did not open in the Case workspace");
      await invoke("e2e_stage", { name: "case-create" });
      q(".case-create-card .ghost")?.click(); await sleep(250);
      if (!q(".case-admin-grid")) throw new Error("the investigation administration view did not open");
      await invoke("e2e_stage", { name: "case-admin" });
      q(".case-switcher-button")?.click(); await sleep(250);
      if (!q(".case-menu")) throw new Error("the branded investigation menu did not open");
      if (document.querySelectorAll(".case-menu-workspace .workspace-option").length !== 2) throw new Error("workspace choices are not inside the investigation menu");
      await invoke("e2e_stage", { name: "case-menu" });
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      q(".views button:first-child")?.click(); await sleep(150);
      const label = await ctx.openTab(config.article);
      await waitFor("page", () => { const t = ctx.tab(label); return t && !t.loading; }, 30_000);
      const click = async (title: RegExp) => {
        const b = [...document.querySelectorAll<HTMLButtonElement>(".term-controls button")].find(x => title.test(x.title));
        if (!b) throw new Error(`no terminal control matching ${title}`);
        b.click();
        await sleep(600);
      };
      const box = (sel: string) => { const r = q(sel)?.getBoundingClientRect(); return r ? { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } : null; };
      const state = () => ({ viewport: box(".viewport"), terminal: box(".term-dock"), pane: box(".right"), agent: q(".term-dock .dot")?.className ?? "" });
      const agentRunning = () => /running/.test(state().agent);
      await waitFor("the agent (or shell) running", () => agentRunning() || /error/.test(state().agent), 30_000);
      const running = agentRunning();
      const shots: Record<string, ReturnType<typeof state>> = {};
      const shoot = async (name: string) => { shots[name] = state(); await invoke("e2e_stage", { name }); };
      if (!q(".term-dock.bottom")) await click(/across the bottom/);
      await shoot("layout-bottom");
      await click(/^Minimize/); await shoot("layout-bottom-min");
      await click(/^Restore/); await click(/^Maximize/); await shoot("layout-bottom-max");
      await click(/^Restore/); await click(/under the investigation/); await shoot("layout-side");
      await click(/across the bottom/);
      // The dark stone theme, then back.
      const lamp = () => [...document.querySelectorAll<HTMLButtonElement>(".statusbar button")].find(x => /light and dark/.test(x.getAttribute("aria-label") ?? ""));
      lamp()?.click(); await sleep(600); await invoke("e2e_stage", { name: "layout-nox" });
      if (document.documentElement.dataset.theme !== "nox") throw new Error("the lamp did not switch to Nox");
      lamp()?.click(); await sleep(300);
      const b = shots["layout-bottom"], min = shots["layout-bottom-min"], max = shots["layout-bottom-max"], side = shots["layout-side"];
      if (!b.viewport || !b.terminal || !min.viewport || !max.terminal || !side.terminal || !side.viewport) throw new Error(`missing parts: ${JSON.stringify(shots)}`);
      if (!(b.terminal.w > b.viewport.w)) throw new Error("across the bottom, the terminal should span the window");
      if (!(min.viewport.h > b.viewport.h + 100)) throw new Error("minimizing should give the page the space");
      if (!(max.terminal.h > b.terminal.h * 1.5)) throw new Error("maximizing should enlarge the terminal");
      if (!(side.terminal.w < side.viewport.w && side.viewport.h > b.viewport.h)) throw new Error("at the side, the terminal sits beside a taller page");
      if (running && !agentRunning()) throw new Error("the agent session ended while the terminal moved");
      return { agent: running ? "kept running throughout" : "not installed here (layout only)", shots };
    });
    await invoke("e2e_finish", { report: { ok: checks.every(c => c.ok), caseId, extraCases: [], seconds: Math.round((Date.now() - started) / 1000), checks } });
    return;
  }

  if (config.only === "relaunch") {
    // A second launch with the first session's profiles and storage.
    caseId = config.relaunchCase ?? "";
    await step("after relaunching, the case's tabs and sign-ins are back", async () => {
      await waitFor("the case's tabs", () => !ctx.restoring() && ctx.debugState().shownCase === caseId && ctx.tabs().some(t => t.url.startsWith("https://example.com/")), 30_000, 200);
      const label = ctx.tabs().find(t => t.url.startsWith("https://example.com/"))!.label;
      await waitFor("page", () => { const t = ctx.tab(label); return t && !t.loading; }, 30_000);
      const c = String((await waitFor("cookie", async () => { const r = await pageEvalSoon(label, `return {c: document.cookie};`); return "c" in r ? r : null; }, 10_000)).c);
      if (!c.includes("hvnt33_e2e=persist")) throw new Error(`signed out after relaunching: ${JSON.stringify({ cookie: c, tabs: ctx.tabs().map(t => t.url) })}`);
      return { tabs: ctx.tabs().map(t => t.url), cookie: c };
    });
    await invoke("e2e_finish", { report: { ok: checks.every(c => c.ok), caseId, extraCases: [], captured: 0, seconds: Math.round((Date.now() - started) / 1000), checks } });
    return;
  }

  await step("create an investigation", async () => {
    const inv = await ctx.createCase(`E2E — desktop smoke ${new Date().toISOString()}`);
    caseId = inv.id;
    return inv.id;
  });

  if (config.only !== "profiles") await mainSession();
  async function mainSession() {
  // Engines can show consent pages or bot checks; each is reported separately.
  await step("fan out the query to every selected engine", async () => { await ctx.fanOut(config.query); return ctx.engines; });
  const perEngine: Record<string, number> = {};
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline && Object.keys(perEngine).length < ctx.engines.length) {
    const runs = await data.searches(caseId);
    for (const r of runs) perEngine[r.engine] = Math.max(perEngine[r.engine] ?? 0, r.results.length);
    await sleep(1500);
  }
  for (const e of ctx.engines) {
    let detail: unknown = `${perEngine[e] ?? 0} results`;
    const label = ctx.engineTab(e);
    if (!perEngine[e] && label) {
      const page = await invoke<{ challenge?: boolean }>("browser_extract_serp", { label }).catch(() => null);
      if (page?.challenge) {
        // The engine asked for a human check (rate limiting). The app surfaces it to
        // the user; it is not an extraction failure, and it is never bypassed.
        checks.push({ name: `observed results recorded from ${ENGINES.find(x => x.id === e)?.name}`, ok: true, detail: "skipped: engine showed a bot check (reported to the user)", ms: 0 });
        continue;
      }
      // Show what the engine actually rendered (consent page, bot check, new layout…).
      detail = await pageEval(label, `const q=s=>{try{return document.querySelectorAll(s).length}catch(e){return 'bad'}}; return {url:location.href,title:document.title,text:document.body.innerText.slice(0,400),h3:q('h3'),h2:q('h2'),rso:q('#rso > div'),mjj:q('.MjjYud'),g:q('div.g'),braveWeb:q('#results .snippet[data-type=web]'),braveSnippet:q('.snippet'),dataType:[...new Set([...document.querySelectorAll('[data-type]')].map(x=>x.dataset.type))].slice(0,10),links:q('a[href^=http]'),sample:[...document.querySelectorAll('#rso a[jsname] h3, #search a h3')].slice(0,4).map(h=>{const a=h.closest('a'); const blk=a.closest('.MjjYud')||a.closest('[data-hveid]'); return {attrs:[...a.attributes].map(x=>x.name+'='+x.value.slice(0,60)), cite:(blk&&blk.querySelector('cite'))?blk.querySelector('cite').innerText:null, citeAttrs: blk&&blk.querySelector('cite')?[...blk.querySelector('cite').attributes].map(x=>x.name):null, dataUrls:blk?[...blk.querySelectorAll('[data-url],[data-href],[data-lpage]')].map(x=>(x.dataset.url||x.dataset.href||x.dataset.lpage||'').slice(0,100)).slice(0,3):null, snippet: blk&&blk.querySelector('.VwiC3b')?blk.querySelector('.VwiC3b').innerText.slice(0,80):null}})};`).catch(err => String(err));
    }
    // Third-party engines may legitimately render only one or two web results
    // among answer cards, news modules, consent prompts, and other verticals.
    // This check is about persistence; the data-panel check below separately
    // requires a useful multi-result extraction from the primary engine.
    checks.push({ name: `observed results recorded from ${ENGINES.find(x => x.id === e)?.name}`, ok: (perEngine[e] ?? 0) >= 1, detail, ms: 0 });
  }

  await step("data panel shows each results page as data", async () => {
    const label = ctx.engineTab("duckduckgo") ?? ctx.engineTab(ctx.engines[0]);
    const results = label ? ctx.tab(label)?.results ?? [] : [];
    if (results.length < 3) throw new Error(`only ${results.length} live results on the tab`);
    return { tab: label, results: results.length, first: results[0].title };
  });

  let article = "";
  const via = { engine: "duckduckgo" as EngineId, query: config.query };
  await step("open an article in a new tab", async () => {
    article = await ctx.openTab(config.article, via);
    await waitFor("article to load", () => !ctx.tabLoading(article) && ctx.tabUrl(article)?.startsWith("https://"), 30_000);
    await sleep(1200);
    return ctx.tabUrl(article);
  });

  await step("page details read from the article", async () => {
    const info = await waitFor("page details", () => ctx.tab(article)?.info, 15_000);
    if (!info.heading || info.wordCount < 500 || info.links.external < 1) throw new Error(JSON.stringify({ heading: info.heading, words: info.wordCount, external: info.links.external }));
    return { heading: info.heading, words: info.wordCount, types: info.schemaTypes, linksOut: info.links.external, topDomain: info.links.domains[0]?.domain };
  });

  await step("visit logged with metadata and how the page was found", async () => {
    const visit = await waitFor("visit", async () => (await data.visits(caseId)).find(v => urlKey(v.url) === urlKey(config.article)), 10_000);
    if (visit.found?.engine !== via.engine || visit.found?.query !== via.query) throw new Error(`found=${JSON.stringify(visit.found)}`);
    if (!visit.meta?.wordCount) throw new Error("no metadata stored");
    return { visits: visit.visits, found: visit.found, words: visit.meta.wordCount };
  });

  const captured: string[] = [];
  await step("capture a text selection", async () => {
    // Pages can still be settling after load; a user would simply select again.
    let attempts = 0, last = "";
    for (;;) {
      attempts++;
      await pageEval(article, `const p=['#mw-content-text p','article p','main p','p'].map(s=>[...document.querySelectorAll(s)].find(x=>x.innerText.trim().length>120)).find(Boolean); const r=document.createRange(); r.selectNodeContents(p); const s=getSelection(); s.removeAllRanges(); s.addRange(r); return {selected:s.toString().length};`);
      const c = await ctx.capture(article, "selection");
      if (!c.error && c.selection.length >= 100) {
        const saved = await ctx.submit(c, article, caseId, "E2E: selection capture");
        captured.push(saved.id);
        return { chars: c.selection.length, attempts, intake: saved.id };
      }
      last = c.error || "selection too short";
      if (attempts >= 3) throw new Error(last);
      await sleep(800);
    }
  });

  await step("capture the image under the pointer (original archived)", async () => {
    const probe = await pageEval(article, `getSelection().removeAllRanges(); const img=[...document.querySelectorAll('.infobox img, figure img, article img, main img'), ...document.images].find(i=>i.naturalWidth>=150&&/^https?:/.test(i.currentSrc||i.src)); if(!img) return {found:false}; img.dispatchEvent(new MouseEvent('mouseover',{bubbles:true})); return {found:true, src:img.currentSrc||img.src};`);
    if (!probe.found) throw new Error("no suitable image on the page");
    const c = await ctx.capture(article, "selection");
    if (c.error || !c.images.length) throw new Error(c.error || "no image captured");
    const saved = await ctx.submit(c, article, caseId, "E2E: image capture");
    captured.push(saved.id);
    const detail = (await data.intake(saved.id)) as { attachment?: { mime: string; size: number; sha256: string }; text?: string };
    const note = /\[Capture note: [^\]]*\]/.exec(detail.text ?? "")?.[0];
    if (!detail.attachment?.mime.startsWith("image/")) throw new Error(`original not archived: ${note ?? JSON.stringify(detail.attachment ?? null)}`);
    return { src: c.images[0].src, mime: detail.attachment.mime, bytes: detail.attachment.size };
  });

  await step("capture a whole page", async () => {
    const c = await ctx.capture(article, "page");
    if (c.pageText.length < 1000) throw new Error(`page text too short (${c.pageText.length})`);
    const saved = await ctx.submit(c, article, caseId, "");
    captured.push(saved.id);
    return { chars: c.pageText.length };
  });

  await step("captures persisted with provenance", async () => {
    const list = await data.intakes(caseId);
    const mine = list.filter(i => captured.includes(i.id));
    if (mine.length !== 3) throw new Error(`expected 3 intakes, found ${mine.length}`);
    const modes = mine.map(i => i.captureMeta?.mode).sort();
    if (JSON.stringify(modes) !== JSON.stringify(["image", "page", "selection"])) throw new Error(`modes ${modes}`);
    if (!mine.every(i => i.state === "captured" && i.sourceUrl?.startsWith("https://"))) throw new Error("unexpected state or missing source URL");
    return mine.map(i => ({ id: i.id, mode: i.captureMeta?.mode, note: i.researcherNote }));
  });

  await step("Search Lab queries the collected events", async () => {
    const [d, i, r] = await Promise.all([
      data.dossier(caseId),
      data.intakes(caseId),
      data.searches(caseId),
    ]);
    const events = allEvents(d, r, i);
    const compare = run("sourcetype=serp | compare", events);
    const top = run("sourcetype=serp | top limit=5 domain", events);
    const caps = run("sourcetype=capture | stats count by mode", events);
    if (!compare.rows.length || !top.rows.length || caps.rows.length !== 3) throw new Error("unexpected query results");
    return { events: events.length, overlap: compare.rows.filter(x => Number(x.engine_count) > 1).length, topDomains: top.rows.map(x => x.domain) };
  });

  await step("results cross-referenced with captures and visits", async () => {
    const [d, i, r, v] = await Promise.all([
      data.dossier(caseId),
      data.intakes(caseId),
      data.searches(caseId),
      data.visits(caseId),
    ]);
    const events = allEvents(d, r, i, v);
    const hits = run(`sourcetype=serp url_key=${JSON.stringify(urlKey(config.article))}`, events).rows;
    if (!hits.length) throw new Error("the article was not among the observed results");
    if (!hits.every(h => h.captured === true && h.visited === true)) throw new Error(JSON.stringify(hits.map(h => [h.engine, h.captured, h.visited])));
    const leads = run("sourcetype=serp captured=false | dedup url", events).rows.length;
    return { engines: hits.map(h => h.engine), unreadLeads: leads };
  });

  await step("saved search persists and re-runs on its engines", async () => {
    await ctx.saveSearch(config.query);
    const saved = await waitFor("saved search", async () => (await data.savedSearches(caseId)).find(s => s.kind === "web" && s.query === config.query), 5_000);
    await ctx.rerun(saved);
    const after = await waitFor("re-run recorded", async () => (await data.savedSearches(caseId)).find(s => s.id === saved.id && s.lastRunAt), 5_000);
    return { engines: saved.engines, lastRunAt: after.lastRunAt };
  });

  await step("Search Lab previews a result beside the table", async () => {
    await ctx.show({ view: "lab", labQuery: "sourcetype=serp | compare" });
    const target = "https://en.wikipedia.org/wiki/KKR_%26_Co.";
    const label = await ctx.preview(target);
    await waitFor("preview to load", () => { const t = ctx.tab(label); return t && !t.loading && urlKey(t.url) === urlKey(target); }, 20_000);
    if (label === article) throw new Error("preview replaced the article tab instead of using its own tab");
    // Browsing elsewhere and coming back must not leave another page in the pane.
    await ctx.show({ view: "browser", tab: article });
    await ctx.show({ view: "lab" });
    await waitFor("preview tab to be shown again", () => ctx.activeTab() === label, 3_000)
      .catch(e => { throw new Error(`${e.message}: ${JSON.stringify({ preview: label, ...ctx.debugState() })}`); });
    return { tab: label, url: ctx.tab(label)?.url };
  });

  await step("Wayback history of the page being read", async () => {
    const entry = await waitFor("archive lookup", () => { const e = ctx.archiveEntry(config.article); return e && !e.loading ? e : null; }, 60_000);
    if (!entry.history) throw new Error(entry.error ?? "no history");
    const h = entry.history;
    if (h.versions < 1 || !h.snapshots.at(-1)?.snapshotUrl) throw new Error(`versions=${h.versions}`);
    return { versions: h.versions, truncated: h.truncated, first: h.first, last: h.last };
  });

  let snapshotTab = "";
  await step("an archived version opens and is recognised as a snapshot", async () => {
    const h = ctx.archiveEntry(config.article)!.history!;
    const oldest = h.snapshots[0];
    snapshotTab = await ctx.openTab(oldest.snapshotUrl);
    await waitFor("snapshot to load", () => { const t = ctx.tab(snapshotTab); return t && !t.loading && t.info; }, 60_000);
    const parsed = parseWaybackUrl(ctx.tab(snapshotTab)!.url);
    if (!parsed || urlKey(parsed.original) !== urlKey(oldest.original)) throw new Error(`not a snapshot URL: ${ctx.tab(snapshotTab)!.url}`);
    return { capturedAt: parsed.capturedAt, title: ctx.tab(snapshotTab)!.info!.title };
  });

  await step("archive history joins the case's queryable events", async () => {
    const a = await data.archive(caseId);
    const [d, i, r, v] = await Promise.all([
      data.dossier(caseId), data.intakes(caseId),
      data.searches(caseId), data.visits(caseId),
    ]);
    const events = allEvents(d, r, i, v, a.histories);
    const coverage = run("sourcetype=snapshot | stats count as versions, min(_time) as first by domain", events).rows;
    const visit = run(`sourcetype=visit url_key=${JSON.stringify(urlKey(config.article))}`, events).rows[0];
    if (!coverage.some(c => c.domain === "en.wikipedia.org")) throw new Error(JSON.stringify(coverage));
    if (!visit?.wayback_versions) throw new Error("visit not annotated with archive coverage");
    return { coverage: coverage.slice(0, 3), visitVersions: visit.wayback_versions };
  });

  await step("archive now: queued with keys, explained without", async () => {
    const status = await data.archiveStatus();
    if (!status.saveConfigured) {
      const res = await data.archiveSave(caseId, "https://example.com/").then(() => null, e => String(e));
      if (!res || !/archive\.org\/account\/s3\.php/.test(res)) throw new Error(`unexpected: ${res}`);
      return "no archive.org keys configured: the API explains how to add them (Save Page Now not exercised)";
    }
    const job = await data.archiveSave(caseId, "https://example.com/");
    const done = await waitFor("Save Page Now", async () => {
      const j = (await data.archive(caseId)).jobs.find(x => x.id === job.id);
      return j && (j.state === "done" || j.state === "failed") ? j : null;
    }, 240_000, 3000);
    if (done.state !== "done") throw new Error(done.error);
    return done.result;
  });

  // ── hvnt33's own archive ─────────────────────────────────────────────────
  let snap: OwnSnapshot | null = null;
  await step("snapshot the article: archive, screenshot, trusted timestamps", async () => {
    await ctx.snapshotNow(config.article);
    snap = await waitFor("snapshot", async () => (await data.snapshots(caseId)).find(s => urlKey(s.url) === urlKey(config.article)), 240_000, 2000);
    if (!snap.timestamps.length) throw new Error(`no timestamps: ${JSON.stringify(snap.timestampErrors)}`);
    if (snap.method === "browser" && !snap.files.screenshot) throw new Error("the browser capture took no screenshot");
    if (!/Kravis/.test(snap.title)) throw new Error(`unexpected title ${snap.title}`);
    return { method: snap.method, tsa: snap.timestamps.map(t => t.tsa), screenshot: !!snap.files.screenshot, lines: snap.textLines, notes: snap.notes };
  });

  let replayTab = "";
  await step("replay shows the archived page in a tab", async () => {
    if (!snap) throw new Error("no snapshot");
    replayTab = (await ctx.replay(snap)) ?? "";
    if (!replayTab) throw new Error("replay did not open a tab");
    // ReplayWeb.page renders the archive inside shadow roots and frames; look through them for the article's text.
    const found = await waitFor("archived page to render", async () => {
      const r = await pageEvalSoon(replayTab, `const seen=new Set(); const walk=(root)=>{ if(!root||seen.has(root)) return ''; seen.add(root); let t=''; try{ t+=(root.body?root.body.innerText:root.textContent)||''; }catch(e){} const els=root.querySelectorAll?root.querySelectorAll('*'):[]; for(const el of els){ if(el.shadowRoot) t+=walk(el.shadowRoot); if(el.tagName==='IFRAME'){ try{ t+=walk(el.contentDocument); }catch(e){} } } return t; }; const text=walk(document); return {kravis:/Henry Kravis/.test(text), len:text.length, url:location.pathname};`);
      return r.kravis ? r : null;
    }, 90_000, 2000);
    await sleep(2000);
    if ((await data.visits(caseId)).some(v => v.url.includes("/replay/"))) throw new Error("the replay was logged as a visit (its link carries a signed token)");
    if (!ctx.tab(replayTab)?.url.includes("/replay/")) throw new Error("replay tab navigated away");
    return { tab: replayTab, rendered: found };
  });

  await step("archived pages cannot use the API", async () => {
    if (!replayTab || !snap) throw new Error("no replay tab");
    const id = (snap as OwnSnapshot).id;
    const main = (await services.status()).url;
    await waitFor("replay page to settle", async () => (await pageEvalSoon(replayTab, `return {ok: document.readyState === 'complete'};`)).ok, 15_000);
    await pageEval(replayTab, `window.__probe={}; Promise.all([fetch('/api/investigations').then(r=>r.status,e=>'error'), fetch('/api/snapshots/${id}/files/manifest').then(r=>r.status,e=>'error'), fetch('/api/snapshots/${id}/replay-url').then(r=>r.status,e=>'error'), fetch('${main}/api/investigations').then(r=>r.status,e=>'blocked'), fetch('${main}/api/investigations',{method:'POST',headers:{'Content-Type':'text/plain'},body:'{}'}).then(r=>r.status,e=>'blocked')]).then(v=>{window.__probe.v=v}); return {};`);
    const r = await waitFor("API probe", async () => { const x = await pageEvalSoon(replayTab, `return window.__probe||{};`); return x.v ? x : null; }, 10_000);
    const statuses = r.v as unknown[];
    if (statuses.some(v => v === 200)) throw new Error(`an archived page read the API: ${JSON.stringify(statuses)}`);
    return { statuses };
  });

  await step("the web workspace reads the API from its own origin", async () => {
    if ((await data.health()).auth === "token") return "skipped: the web workspace does not send API tokens (local mode only)";
    const main = (await services.status()).url;
    const tab = await ctx.openTab(`${main}/`);
    const titles = await waitFor("case list", async () => {
      const r = await pageEvalSoon(tab, `return {titles:[...document.querySelectorAll('#investigations *')].map(e=>e.textContent).join('|')};`);
      return String(r.titles ?? "").includes("E2E — desktop smoke") ? r.titles : null;
    }, 20_000);
    return { tab, listed: String(titles).split("|").filter(t => t.includes("E2E")).slice(0, 1) };
  });

  await step("evidence package saves to Downloads", async () => {
    if (!snap) throw new Error("no snapshot");
    const path = await data.downloadEvidence(snap);
    if (!/\/Downloads\/hvnt33 evidence .+\.zip$/.test(path)) throw new Error(path);
    return { path, timestamps: (snap as OwnSnapshot).timestamps.length };
  });

  await step("a watched page's changes are recorded with a diff", async () => {
    if (!config.changing) throw new Error("no changing page configured");
    await ctx.watchPage(config.changing, 24);
    const watch = await waitFor("watch", async () => (await data.watches(caseId)).find(w => urlKey(w.url) === urlKey(config.changing!)), 10_000);
    await waitFor("first watch snapshot", async () => (await data.snapshots(caseId)).filter(s => s.watchId === watch.id).length >= 1, 240_000, 2000);
    await data.runWatch(watch.id);
    const change = await waitFor("change", async () => (await data.changes(caseId)).find(c => urlKey(c.url) === urlKey(config.changing!)), 240_000, 2000);
    const diff = await data.changeDiff(change.id);
    if (!diff.parts.some(p => p.kind === "added") || !diff.parts.some(p => p.kind === "removed")) throw new Error(JSON.stringify(diff.parts));
    return { added: change.added, removed: change.removed, similarity: change.similarity, removedLines: change.removedLines, addedLines: change.addedLines };
  });

  await step("own snapshots and changes join the Search Lab events", async () => {
    const [d, i, r, v, snapshots, changes] = await Promise.all([data.dossier(caseId), data.intakes(caseId), data.searches(caseId), data.visits(caseId), data.snapshots(caseId), data.changes(caseId)]);
    const events = allEvents(d, r, i, v, [], { snapshots, changes });
    const own = run("sourcetype=snapshot archive=hvnt33 | stats count by method", events).rows;
    const changed = run("sourcetype=change | table domain added removed", events).rows;
    if (!own.length || !changed.length) throw new Error(JSON.stringify({ own, changed }));
    return { own, changed };
  });

  // ── The Case view, driven through its interface ──────────────────────────
  const clickText = (selector: string, text: string) => waitFor(`"${text}"`, () => {
    const el = [...document.querySelectorAll<HTMLElement>(selector)].find(e => (e.textContent ?? "").includes(text) && !(e as HTMLButtonElement).disabled);
    if (!el) return null;
    el.click();
    return true;
  }, 15_000, 100).catch(e => {
    const seen = [...document.querySelectorAll<HTMLElement>(selector)].map(x => (x.textContent ?? "").trim().slice(0, 60)).slice(0, 12);
    throw new Error(`${e.message}; ${selector} shows: ${JSON.stringify(seen)}; state: ${JSON.stringify({ view: ctx.debugState().view, message: ctx.debugState().message })}`);
  });
  await step("Case view: review a staged capture and file it", async () => {
    const text = "E2E DEMO SOURCE (fictional). On 2025-03-14 the Harbor Board awarded a contract to Calder Marine Works. Ruth Vale chaired the vote.";
    const { data: intake, error: created } = await client.POST("/api/intakes", { body: { investigationId: caseId, title: "E2E staged capture", sourceLabel: "E2E fixture (fictional)", text } as never });
    if (created || !intake) throw new Error(`could not create the capture: ${JSON.stringify(created)}`);
    const intakeId = (intake as { id: string }).id;
    const { error: staged } = await client.POST("/api/intakes/{id}/draft", { params: { path: { id: intakeId } }, body: { draft: {
      summary: "A fictional award.", questions: ["Who else bid?"],
      records: [
        { key: "board", title: "Harbor Board", kind: "Organization", notes: "", eventDate: "", tags: "e2e", quote: "the Harbor Board" },
        { key: "calder", title: "Calder Marine Works", kind: "Organization", notes: "", eventDate: "", tags: "e2e", quote: "Calder Marine Works" },
        { key: "award", title: "Contract awarded", kind: "Event", notes: "", eventDate: "2025-03-14", tags: "e2e", quote: "On 2025-03-14 the Harbor Board awarded a contract to Calder Marine Works." },
        { key: "vale", title: "Ruth Vale", kind: "Person", notes: "", eventDate: "", tags: "e2e", quote: "Ruth Vale chaired the vote." },
      ],
      connections: [{ fromKey: "board", toKey: "calder", label: "awarded a contract to", notes: "", quote: "the Harbor Board awarded a contract to Calder Marine Works" }],
    } } });
    if (staged) throw new Error(`could not stage the draft: ${JSON.stringify(staged)}`);
    await ctx.refresh();
    await ctx.show({ view: "case" });
    await clickText(".case-head [role=tab]", "Review");
    await clickText(".record-item", "E2E staged capture");
    await clickText("button", "File selected");
    const filed = await waitFor("filing", async () => { const i = await data.intake(intakeId) as unknown as { state: string }; return i.state === "approved" ? i : null; }, 15_000);
    const records = (await data.dossier(caseId)).records.filter(r => r.intakeId === intakeId);
    if (records.length < 4) throw new Error(`filed ${records.length} records`);
    return { state: filed.state, records: records.map(r => r.title) };
  });

  await step("Case view: setting a verification status records the review", async () => {
    await clickText(".case-head [role=tab]", "Records");
    await clickText(".record-item", "Calder Marine Works");
    await clickText(".status-seg [role=radio]", "Corroborated");
    const r = await waitFor("review", async () => (await data.dossier(caseId)).records.find(x => x.title === "Calder Marine Works" && x.reviewedAt), 10_000);
    await waitFor("badge", () => document.querySelector(".record-editor .flag.vis")?.textContent?.includes("reviewed"), 5_000);
    return { status: r.status, reviewedAt: r.reviewedAt, reviewedBy: r.reviewedBy };
  });

  await step("Case view: map, timeline and a presentation export", async () => {
    await clickText(".case-head [role=tab]", "Map");
    const nodes = await waitFor("map", () => document.querySelectorAll("svg.map .node").length || null, 5_000);
    const edges = document.querySelectorAll("svg.map .edge").length;
    await clickText(".case-head [role=tab]", "Timeline");
    await waitFor("timeline", () => [...document.querySelectorAll(".timeline-tab li")].some(li => li.textContent?.includes("Contract awarded")), 5_000);
    await clickText(".case-head [role=tab]", "Export");
    await clickText(".export-tab label", "Calder Marine Works");
    await clickText(".export-tab label", "Harbor Board");
    await waitFor("selection saved", async () => (await data.dossier(caseId)).records.filter(r => r.public).length >= 2, 10_000);
    const path = await data.exportCase((await data.investigations()).find(i => i.id === caseId)!, "selected");
    await ctx.show({ view: "browser" });
    return { nodes, edges, path };
  });

  await step("browsed pages cannot invoke app commands", async () => {
    // A page must find no bridge to the app (the app view's preload) and no Node.
    const leaked = await pageEval(article, `return { preload: typeof window.hvnt33, node: typeof require !== 'undefined' || typeof process !== 'undefined', electron: typeof window.electron };`);
    if (leaked.preload !== "undefined" || leaked.node || leaked.electron !== "undefined") throw new Error(`a browsed page can reach the app: ${JSON.stringify(leaked)}`);
    return leaked;
  });

  await step("browsed pages cannot navigate to local files", async () => {
    const before = ctx.tabUrl(article);
    await pageEval(article, `location.href='file:///etc/hosts'; return {};`);
    await sleep(1500);
    const after = ctx.tabUrl(article);
    if (after?.startsWith("file:")) throw new Error("navigated to a file URL");
    return { before, after };
  });

  if (config.tour) {
    const stage = async (name: string) => { await sleep(2500); await invoke("e2e_stage", { name }); await sleep(1800); };
    const google = ctx.engineTab("google");
    if (google) { await ctx.show({ view: "browser", tab: google }); await stage("google"); }
    await pageEval(article, `const p=[...document.querySelectorAll('#mw-content-text p')].find(x=>x.innerText.trim().length>120); const r=document.createRange(); r.selectNodeContents(p); getSelection().removeAllRanges(); getSelection().addRange(r); p.scrollIntoView({block:'center'}); return {};`);
    // ⌘⇧S as a researcher presses it: saved to the case, referenced in the agent's message.
    await ctx.show({ view: "browser", tab: article, captureToChat: "selection" });
    await stage("capture");
    await pageEval(article, `getSelection().removeAllRanges(); const img=document.querySelector('.infobox img'); if(img) img.dispatchEvent(new MouseEvent('mouseover',{bubbles:true})); return {};`);
    await ctx.show({ view: "browser", tab: article, captureToChat: "selection" });
    await stage("capture-image");
    await ctx.show({ view: "browser", tab: ctx.engineTab("duckduckgo") ?? ctx.engineTab(ctx.engines[0]) });
    await stage("data-results");
    await ctx.show({ view: "browser", tab: article });
    await stage("data-page");
    if (snapshotTab) { await ctx.show({ view: "browser", tab: snapshotTab }); await stage("wayback-snapshot"); }
    await ctx.show({ view: "case" });
    await clickText(".case-head [role=tab]", "Records");
    await clickText(".record-item", "Calder Marine Works");
    await stage("case-records");
    await clickText(".case-head [role=tab]", "Map");
    await stage("case-map");
    await clickText(".case-head [role=tab]", "Review");
    await clickText(".record-item", "E2E staged capture");
    await stage("case-review");
    await ctx.show({ view: "case" });
    await clickText(".case-head [role=tab]", "Records");
    await clickText(".record-item", "Calder Marine Works");
    await stage("case-records");
    await clickText(".case-head [role=tab]", "Map");
    await stage("case-map");
    await clickText(".case-head [role=tab]", "Review");
    await clickText(".record-item", "E2E staged capture");
    await stage("case-review");
    await ctx.show({ view: "browser", tab: article, caseTab: "archive" });
    await stage("own-archive");
    if (replayTab) { await ctx.show({ view: "browser", tab: replayTab }); await stage("replay"); }
    await ctx.show({ view: "lab", labQuery: "sourcetype=snapshot archive=hvnt33 OR sourcetype=change | table _time sourcetype domain title changed timestamps added removed" });
    await stage("lab-own-archive");
    await ctx.show({ view: "browser", tab: article, caseTab: "activity" });
    await ctx.show({ view: "lab", labQuery: "sourcetype=snapshot archive=wayback | stats count as versions, min(_time) as first, max(_time) as last by url | sort -versions" });
    await stage("lab-archive");
    await ctx.show({ view: "lab", labQuery: "sourcetype=serp | compare" });
    await stage("lab-compare");
    await ctx.preview(config.article);
    await stage("lab-preview");
    await ctx.show({ view: "lab", labQuery: "sourcetype=serp | dedup url | top limit=12 domain" });
    await stage("lab-domains");
  }

  } // mainSession

  // Last, because it swaps the open tabs: profiles and tabs follow cases.
  const extraCases: string[] = [];
  await step("each case keeps its tabs and its own browser profile", async () => {
    const page = "https://example.com/";
    const settle = () => waitFor("tabs to settle", () => !ctx.restoring(), 20_000, 200);
    const openAndLoad = async (url: string) => {
      const label = await ctx.openTab(url);
      await waitFor("page", () => { const t = ctx.tab(label); return t && !t.loading; }, 30_000)
        .catch(e => { throw new Error(`${e.message} (${label}): ${JSON.stringify(ctx.debugState())}`); });
      return label;
    };
    const cookie = async (label: string) => String((await waitFor("cookie read", async () => { const r = await pageEvalSoon(label, `return {c: document.cookie};`); return "c" in r ? r : null; }, 10_000)).c);
    const findTab = (url: string) => ctx.tabs().find(t => t.url.startsWith(url))?.label;
    // A switch has finished only when the app shows that case's tabs (not merely when no swap is running yet).
    const showing = (id: string) => waitFor(`case ${id.slice(0, 8)}'s tabs`, () => !ctx.restoring() && ctx.debugState().shownCase === id, 30_000, 200);

    // Case A in its own profile: a site sets a cookie.
    await ctx.setProfile("own");
    await settle();
    const a = await openAndLoad(page);
    await pageEval(a, `document.cookie = "hvnt33_e2e=case-a; max-age=3600; path=/"; return {};`);
    if (!(await cookie(a)).includes("hvnt33_e2e=case-a")) throw new Error("could not set a cookie");
    await waitFor("tabs saved", () => loadTabs(localStorage.getItem(tabsKey(caseId))).tabs.some(t => t.url.startsWith(page)), 5_000);
    const a2 = await openAndLoad(page + "?second");
    if (!(await cookie(a2)).includes("hvnt33_e2e=case-a")) throw new Error("another tab of the same case does not see the cookie");

    // Case B, its own profile: no tabs carried over, and A's cookie is invisible.
    const other = await ctx.createCase(`E2E — second case ${new Date().toISOString()}`, true);
    extraCases.push(other.id);
    await showing(other.id);
    if (ctx.tabs().length) throw new Error(`case B opened with tabs: ${JSON.stringify(ctx.tabs())}`);
    const b = await openAndLoad(page);
    const inB = await cookie(b);
    if (inB.includes("hvnt33_e2e")) throw new Error(`case B sees case A's cookie: ${inB}`);

    // Back to A: its tabs are restored, signed in as before.
    ctx.selectCase(caseId);
    await showing(caseId);
    const restored = await waitFor("case A's tabs restored", () => findTab(page), 10_000);
    await waitFor("restored page", () => { const t = ctx.tab(restored); return t && !t.loading; }, 30_000);
    const inA = await cookie(restored);
    if (!inA.includes("hvnt33_e2e=case-a")) throw new Error(`case A lost its cookie: ${inA}`);

    // Clearing A's profile signs it out; its tabs come back.
    await ctx.clearProfile(caseId);
    await showing(caseId);
    const reopened = await waitFor("tabs reopened after clearing", () => findTab(page), 10_000);
    await waitFor("reopened page", () => { const t = ctx.tab(reopened); return t && !t.loading; }, 30_000);
    const cleared = await cookie(reopened);
    if (cleared.includes("hvnt33_e2e")) throw new Error(`clearing kept the cookie: ${cleared}`);
    // For the relaunch check: a sign-in that must survive restarting the app.
    await pageEval(reopened, `document.cookie = "hvnt33_e2e=persist; max-age=3600; path=/"; return {};`);
    return { caseB: inB || "(no cookies)", caseA: inA, afterClearing: cleared || "(no cookies)", restoredTabs: ctx.tabs().length };
  });

  await step("a case route: tabs, snapshots and archive go through it; the kill switch pauses the case", async () => {
    if (!config.socks) throw new Error("no test proxy configured");
    if ((await data.health()).auth === "token") return "skipped: per-case routes need a local server (a hosted server refuses them, tested in the server suite)";
    const route = config.socks;
    const showing = (id: string) => waitFor(`case ${id.slice(0, 8)}'s tabs`, () => !ctx.restoring() && ctx.debugState().shownCase === id, 30_000, 200);
    const openAndLoad = async (url: string) => {
      const label = await ctx.openTab(url);
      await waitFor("page", () => { const t = ctx.tab(label); return t && !t.loading; }, 30_000);
      return label;
    };
    const routed = await ctx.createCase(`E2E — routed case ${new Date().toISOString()}`, true);
    extraCases.push(routed.id);
    await showing(routed.id);
    await ctx.setNetwork({ route, label: "E2E proxy", lock: null });
    await waitFor("exit through the route", () => ctx.netState().status === "ok" && ctx.netState().exit?.org === "E2E Proxy Network", 20_000);

    const tab = await openAndLoad("https://example.com/?routed-tab");
    const page = await pageEval(tab, `return {title: document.title};`);
    // WebRTC could reveal the real IP address past the proxy: it is absent, including in a frame the page creates.
    const rtc = await pageEval(tab, `const f=document.createElement('iframe'); document.body.appendChild(f); const w=f.contentWindow; return {top: typeof window.RTCPeerConnection, webkit: typeof window.webkitRTCPeerConnection, frame: typeof w.RTCPeerConnection, frameWebkit: typeof w.webkitRTCPeerConnection};`);
    if (Object.values(rtc).some(v => v !== "undefined")) throw new Error(`WebRTC is available to pages: ${JSON.stringify(rtc)}`);

    await ctx.snapshotNow("https://example.com/?routed-snapshot");
    const snap = await waitFor("routed snapshot", async () => (await data.snapshots(routed.id)).find(s => s.url.includes("routed-snapshot")), 240_000, 2000) as OwnSnapshot & { network?: { route: string; country: string; org: string } };
    if (snap.network?.route !== "E2E proxy" || snap.network.org !== "E2E Proxy Network") throw new Error(`snapshot network: ${JSON.stringify(snap.network)}`);

    // Locked to an exit elsewhere: paused, tabs closed, nothing opens.
    await ctx.setNetwork({ route, label: "E2E proxy", lock: { country: "Sweden", org: "" } });
    await waitFor("paused", () => ctx.netState().status === "paused" && ctx.tabs().length === 0, 20_000);
    const refused = await ctx.openTab("https://example.com/?while-paused").then(() => false, () => true);
    if (!refused) throw new Error("a paused case opened a tab");
    const pausedBecause = ctx.netState().message;
    // Unlocked: it resumes and its tabs come back.
    await ctx.setNetwork({ route, label: "E2E proxy", lock: null });
    await waitFor("resumed with its tabs", () => ctx.netState().status === "ok" && ctx.tabs().some(t => t.url.includes("routed-tab")), 30_000);
    // A route that is down: paused, never direct.
    await ctx.setNetwork({ route: "socks5://127.0.0.1:1", label: "Dead proxy", lock: null });
    await waitFor("paused on a dead route", () => ctx.netState().status === "paused" && /Could not reach/.test(ctx.netState().message ?? ""), 30_000);
    const deadBecause = ctx.netState().message;
    // A proxy that needs a login: the case's local relay logs in; the tabs never see the password.
    if (!config.socksAuth) throw new Error("no login proxy configured");
    await ctx.setNetwork({ route: config.socksAuth, label: "Login proxy", lock: null, credentials: { username: "e2e-user", password: "wrong" } });
    await waitFor("paused on a wrong password", () => ctx.netState().status === "paused", 30_000);
    await ctx.setNetwork({ route: config.socksAuth, label: "Login proxy", lock: null, credentials: { username: "e2e-user", password: "e2e-pass" } });
    await waitFor("through the login proxy", () => ctx.netState().status === "ok" && ctx.tabs().some(t => t.url.includes("routed-tab")), 30_000);
    const loginTab = await openAndLoad("https://example.com/?login-proxy");
    const loginTitle = (await pageEval(loginTab, `return {t: document.title};`)).t;

    // Tor, in one click, on the case's own circuit; then a new exit.
    await ctx.toggleTor();
    await waitFor("Tor on", () => ctx.netState().status === "ok" && ctx.tabs().some(t => t.url.includes("routed-tab")), 30_000);
    await openAndLoad("https://example.com/?tor-circuit-0");
    await ctx.newExit();
    await waitFor("tabs back after a new exit", () => !ctx.restoring() && ctx.tabs().some(t => t.url.includes("tor-circuit-0")), 30_000);
    await openAndLoad("https://example.com/?tor-circuit-1");
    await ctx.toggleTor();
    await waitFor("Tor off", () => ctx.netState().status === "direct", 20_000);
    ctx.selectCase(caseId);
    await showing(caseId);
    return { title: page.title, rtc, snapshotNetwork: snap.network, pausedBecause, deadBecause, loginTitle, routedCase: routed.id };
  });

  const ok = checks.every(c => c.ok);
  await invoke("e2e_finish", { report: { ok, caseId, extraCases, seconds: Math.round((Date.now() - started) / 1000), checks } });
}
