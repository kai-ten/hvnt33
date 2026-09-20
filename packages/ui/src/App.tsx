import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AgentTerminal, type TerminalHandle } from "./components/Terminal";
import { ConnectionPanel } from "./components/ConnectionPanel";
import { DataPanel, type ArchiveEntry, type PanelTab } from "./components/DataPanel";
import { InvestigationPane } from "./components/Investigation";
import { SearchLab } from "./components/SearchLab";
import { runE2E, type E2EConfig } from "./e2e";
import { agentInstruction, buildCapture, captureKind, captureReference } from "./lib/capture";
import { DEFAULT_ENGINES, ENGINES, domainOf, engineById, parseReplayUrl, parseSerpUrl, parseWaybackUrl, resolveAddress, sameSerp, urlKey, type EngineId } from "@hvnt33/core/engines";
import mark2x from "../assets/mark@2x.png";
import mark3x from "../assets/mark@3x.png";
import { allEvents, urlIndex, type CaseNetwork, type ArchiveHistory, type ArchiveJob, type Dossier, type IntakeSummary, type Investigation, type OwnSnapshot, type PageChange, type PageVisit, type SavedSearch, type SearchRun, type Watch } from "@hvnt33/core/events";
import { browser, focusApp, hasNative, invoke, network, onMenu, openExternal, services, setNativeTheme, submitCapture, updates, type AppTheme, type Exit, type ServiceStatus, type UpdateState } from "./lib/native";
import { data, type NetworkChange } from "./lib/data";
import { engineOf, loadTabs, profileFor, profileKey, saveTabs, tabsKey, type ProfileChoice } from "./lib/tabs";
import { BrowsingPanel } from "./components/BrowsingPanel";
import { CaseView, type CaseTab } from "./components/CaseView";
import { CaseSwitcher } from "./components/CaseSwitcher";
import { CaseAdmin } from "./components/CaseAdmin";

type SerpRef = { engine: EngineId; query: string };
interface Tab extends PanelTab { lastSerp: SerpRef | null }
type View = "browser" | "lab" | "case";

const store = {
  get: (k: string, fallback: string) => { try { return localStorage.getItem(k) ?? fallback; } catch { return fallback; } },
  set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
};

export default function App() {
  const [status, setStatus] = useState<ServiceStatus | null>(null);
  const [workspace, setWorkspace] = useState<{ id: string; name: string; plan: string } | null>(null);
  const [starting, setStarting] = useState(false);
  const [serviceError, setServiceError] = useState("");
  const [cases, setCases] = useState<Investigation[]>([]);
  const [archivedCases, setArchivedCases] = useState<Investigation[]>([]);
  const [caseId, setCaseId] = useState<string | null>(() => store.get("hvnt33.case", "") || null);
  const [dossier, setDossier] = useState<Dossier | null>(null);
  const [intakes, setIntakes] = useState<IntakeSummary[]>([]);
  const [runs, setRuns] = useState<SearchRun[]>([]);
  const [visits, setVisits] = useState<PageVisit[]>([]);
  const [saved, setSaved] = useState<SavedSearch[]>([]);
  const [archiveJobs, setArchiveJobs] = useState<ArchiveJob[]>([]);
  const [histories, setHistories] = useState<ArchiveHistory[]>([]);
  const [own, setOwn] = useState<{ snapshots: OwnSnapshot[]; watches: Watch[]; changes: PageChange[] }>({ snapshots: [], watches: [], changes: [] });
  const [archiveCache, setArchiveCache] = useState<Record<string, ArchiveEntry>>({});
  const [saveConfigured, setSaveConfigured] = useState(false);
  const [loading, setLoading] = useState(false);
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [view, setView] = useState<View>("browser");
  const [engines, setEngines] = useState<EngineId[]>(() => {
    try {
      const v = JSON.parse(store.get("hvnt33.engines", ""));
      // Migrate only the old untouched default. A custom selection, including
      // Google, remains the researcher's choice.
      const oldDefault = ["google", "duckduckgo", "bing", "brave"];
      if (Array.isArray(v) && v.length) return v.length === oldDefault.length && oldDefault.every((e, i) => v[i] === e) ? DEFAULT_ENGINES : v;
    } catch { /* default */ }
    return DEFAULT_ENGINES;
  });
  const [query, setQuery] = useState("");
  const [address, setAddress] = useState("");
  const [editingAddress, setEditingAddress] = useState(false);
  const [message, setMessage] = useState<{ text: string; tone: "info" | "ok" | "warn" } | null>(null);
  const refreshRef = useRef<() => Promise<void>>(async () => {});
  const messageRef = useRef(message);
  messageRef.current = message;
  const [agentStatus, setAgentStatus] = useState("idle");
  const [rightWidth, setRightWidth] = useState(() => Number(store.get("hvnt33.rightWidth", "460")));
  const [termHeight, setTermHeight] = useState(() => Number(store.get("hvnt33.termHeight", "300")));
  // The agent terminal: under the investigation pane (default) or across the bottom, and its size.
  // Lapis (travertine) or Nox (black stone), as on hvnt33.com. New installs
  // follow the operating system, falling back to Lapis when it cannot report
  // a preference. Preserve an old explicit Nox choice from before System existed.
  const [themeChoice, setThemeChoice] = useState<AppTheme>(() => {
    const saved = store.get("hvnt33.theme-choice", "");
    if (saved === "system" || saved === "lapis" || saved === "nox") return saved;
    return store.get("hvnt33.theme", "lapis") === "nox" ? "nox" : "system";
  });
  const [systemDark, setSystemDark] = useState(() => window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false);
  const theme = themeChoice === "system" ? (systemDark ? "nox" : "lapis") : themeChoice;
  useEffect(() => {
    const media = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (!media) return;
    const changed = (event: MediaQueryListEvent) => setSystemDark(event.matches);
    setSystemDark(media.matches);
    media.addEventListener("change", changed);
    return () => media.removeEventListener("change", changed);
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    store.set("hvnt33.theme", theme);
    store.set("hvnt33.theme-choice", themeChoice);
    void setNativeTheme(themeChoice);
  }, [theme, themeChoice]);
  const [termDock, setTermDock] = useState<"bottom" | "side">(() => (store.get("hvnt33.termDock", "side") === "bottom" ? "bottom" : "side"));
  const [termSize, setTermSize] = useState<"normal" | "min" | "max">("normal");
  const [showData, setShowData] = useState(() => store.get("hvnt33.dataPanel", "1") === "1");
  const [dataWidth, setDataWidth] = useState(() => Number(store.get("hvnt33.dataWidth", "380")));
  const [recordVisits, setRecordVisits] = useState(() => store.get("hvnt33.recordVisits", "1") === "1");
  const [autoArchive, setAutoArchive] = useState(() => store.get("hvnt33.autoArchive", "1") === "1");
  const [viewportEl, setViewportEl] = useState<HTMLDivElement | null>(null);
  const [previewEl, setPreviewEl] = useState<HTMLDivElement | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [showConnection, setShowConnection] = useState(false);
  const [caseAdmin, setCaseAdmin] = useState<"list" | "create" | null>(null);
  const [update, setUpdate] = useState<UpdateState | null>(null);
  const [dismissedUpdate, setDismissedUpdate] = useState(() => store.get("hvnt33.update-dismissed", ""));

  const caseRef = useRef(caseId);
  const tabsRef = useRef(tabs);
  const activeRef = useRef(active);
  const engineTabs = useRef(new Map<EngineId, string>());
  const recording = useRef(new Set<string>());
  const terminal = useRef<TerminalHandle>(null);
  const previewLabel = useRef<string | null>(null);
  /** Why the Lab preview was last cleared (diagnostics for the end-to-end test). */
  const previewCleared = useRef<string[]>([]);
  const clearPreview = useCallback((why: string) => {
    previewCleared.current = [...previewCleared.current.slice(-4), `${new Date().toISOString().slice(11, 23)} ${why}`];
    previewLabel.current = null;
    setPreviewUrl(null);
  }, []);
  const viewRef = useRef(view);
  viewRef.current = view;
  const previewUrlRef = useRef(previewUrl);
  previewUrlRef.current = previewUrl;
  // Replays are served from the server's separate replay origin (from /api/health).
  const [replayBase, setReplayBase] = useState("");
  const [serverAuth, setServerAuth] = useState<"local" | "token">("local");
  const replayBaseRef = useRef(replayBase);
  replayBaseRef.current = replayBase;
  const recordVisitsRef = useRef(recordVisits);
  recordVisitsRef.current = recordVisits;
  const searchInput = useRef<HTMLInputElement>(null);
  const addressInput = useRef<HTMLInputElement>(null);
  caseRef.current = caseId;
  tabsRef.current = tabs;
  activeRef.current = active;

  const flash = useCallback((text: string, tone: "info" | "ok" | "warn" = "info") => setMessage({ text, tone }), []);
  useEffect(() => {
    if (!message) return;
    const t = setTimeout(() => setMessage(null), message.tone === "warn" ? 9000 : 5000);
    return () => clearTimeout(t);
  }, [message]);

  // ── Services and data ──────────────────────────────────────────────────────
  const connected = !!status?.server && !!status?.database;

  const startingRef = useRef(false);
  const startServices = useCallback(async () => {
    if (startingRef.current) return;
    startingRef.current = true;
    setStarting(true); setServiceError("");
    try { setStatus(await services.start()); }
    catch (e) { setServiceError(String(e)); setStatus(await services.status()); }
    finally { setStarting(false); startingRef.current = false; }
  }, []);

  useEffect(() => {
    if (!hasNative()) return;
    services.status().then(s => { setStatus(s); if (!s.server || !s.database) void startServices(); });
  }, [startServices]);
  useEffect(() => {
    if (!hasNative()) return;
    void updates.get().then(setUpdate);
    const off = updates.onState(setUpdate);
    return () => { void off.then(stop => stop()); };
  }, []);

  const loadCases = useCallback(async () => {
    const [list, archived] = await Promise.all([data.investigations(), data.archivedInvestigations()]);
    setCases(list);
    setArchivedCases(archived);
    if (list.length && !list.some(c => c.id === caseRef.current)) setCaseId(list.length === 1 ? list[0].id : null);
    return list;
  }, []);

  const refresh = useCallback(async () => {
    const id = caseRef.current;
    if (!id) return;
    setLoading(true);
    try {
      const [d, i, r, v, s, a, snapshots, watches, changes] = await Promise.all([
        data.dossier(id),
        data.intakes(id),
        data.searches(id).catch(() => [] as SearchRun[]),
        data.visits(id).catch(() => [] as PageVisit[]),
        data.savedSearches(id).catch(() => [] as SavedSearch[]),
        data.archive(id).catch(() => ({ jobs: [] as ArchiveJob[], histories: [] as ArchiveHistory[] })),
        data.snapshots(id).catch(() => [] as OwnSnapshot[]),
        data.watches(id).catch(() => [] as Watch[]),
        data.changes(id).catch(() => [] as PageChange[]),
      ]);
      if (caseRef.current !== id) return;
      setDossier(d); setIntakes(i); setRuns(r); setVisits(v); setSaved(s);
      setArchiveJobs(a.jobs); setHistories(a.histories); setOwn({ snapshots, watches, changes });
      setArchiveCache(c => {
        const next = { ...c };
        for (const h of a.histories) if (!next[urlKey(h.url)]?.loading) next[urlKey(h.url)] = { history: h };
        return next;
      });
    } catch (e) {
      flash(String(e), "warn");
    } finally { setLoading(false); }
  }, [flash]);

  refreshRef.current = refresh;
  useEffect(() => { if (connected) loadCases().catch(e => flash(String(e), "warn")); }, [connected, loadCases, flash]);
  useEffect(() => {
    if (!connected) return;
    data.archiveStatus().then(s => setSaveConfigured(s.saveConfigured)).catch(() => {});
    data.health().then(h => { setReplayBase(h.replayUrl); setServerAuth(h.auth); }).catch(() => {});
    data.workspace().then(w => setWorkspace(w as { id: string; name: string; plan: string })).catch(() => setWorkspace(null));
  }, [connected]);

  // ── Web archive ────────────────────────────────────────────────────────────
  const archiveInflight = useRef(new Set<string>());
  const archiveEntry = useCallback((url: string) => archiveCache[urlKey(url)], [archiveCache]);
  const archiveCacheRef = useRef(archiveCache);
  archiveCacheRef.current = archiveCache;
  const lookupArchive = useCallback(async (url: string, refresh = false) => {
    const key = urlKey(url);
    if (archiveInflight.current.has(key)) return;
    archiveInflight.current.add(key);
    setArchiveCache(c => ({ ...c, [key]: { ...c[key], loading: true, error: undefined } }));
    try {
      const history = await data.archiveLookup(url, refresh, caseRef.current ?? undefined);
      setArchiveCache(c => ({ ...c, [key]: { history } }));
      setHistories(hs => (hs.some(h => urlKey(h.url) === key) ? hs.map(h => (urlKey(h.url) === key ? history : h)) : hs));
    } catch (e) {
      setArchiveCache(c => ({ ...c, [key]: { error: String(e).replace(/^Error: /, "") } }));
    } finally {
      archiveInflight.current.delete(key);
    }
  }, []);
  const archiveNow = useCallback(async (url: string, intakeId = "") => {
    const investigationId = caseRef.current;
    if (!investigationId) { flash("Choose an investigation first.", "warn"); return; }
    try {
      const job = await data.archiveSave(investigationId, url, intakeId);
      setArchiveJobs(js => [job, ...js]);
      flash("Queued for the Wayback Machine. It usually takes under a minute.", "ok");
    } catch (e) {
      flash(String(e).replace(/^Error: /, ""), "warn");
    }
  }, [flash]);
  // ── hvnt33's own archive ───────────────────────────────────────────────────
  const snapshotNow = useCallback(async (url: string, intakeId = "", investigationId = caseRef.current) => {
    if (!investigationId) { flash("Choose an investigation first.", "warn"); return; }
    try {
      const job = await data.snapshot(investigationId, url, intakeId);
      setArchiveJobs(js => [job, ...js]);
      if (!intakeId) flash("Snapshot queued: archive, text, screenshot and trusted timestamps.", "ok");
    } catch (e) { flash(String(e).replace(/^Error: /, ""), "warn"); }
  }, [flash]);
  const watchPage = useCallback(async (url: string, everyHours: number | null) => {
    const investigationId = caseRef.current;
    if (!investigationId) { flash("Choose an investigation first.", "warn"); return; }
    try {
      if (everyHours === null) {
        const w = own.watches.find(x => urlKey(x.url) === urlKey(url));
        if (w) await data.unwatch(w.id);
        flash("Stopped watching. Its snapshots are kept.", "ok");
      } else {
        await data.watch(investigationId, url, everyHours);
        flash("Watching: snapshotting now, then on schedule. Changes appear in the case.", "ok");
      }
      void refresh();
    } catch (e) { flash(String(e).replace(/^Error: /, ""), "warn"); }
  }, [flash, own.watches, refresh]);
  const updateWatch = useCallback(async (w: Watch, action: "pause" | "resume" | "run" | "remove") => {
    try {
      if (action === "run") await data.runWatch(w.id);
      else if (action === "remove") await data.unwatch(w.id);
      else await data.updateWatch(w.id, { active: action === "resume" });
      void refresh();
    } catch (e) { flash(String(e).replace(/^Error: /, ""), "warn"); }
  }, [flash, refresh]);
  const markChangeSeen = useCallback(async (c: PageChange) => {
    if (c.seen) return;
    setOwn(o => ({ ...o, changes: o.changes.map(x => (x.id === c.id ? { ...x, seen: true } : x)) }));
    await data.markChangeSeen(c.id).catch(() => {});
  }, []);
  const downloadEvidence = useCallback(async (s: OwnSnapshot) => {
    try {
      const saved = await data.downloadEvidence(s);
      flash(`Evidence saved to ${saved.replace(/^.*\/(Downloads\/)/, "$1")}`, "ok");
    } catch (e) { flash(String(e).replace(/^Error: /, ""), "warn"); }
  }, [flash]);

  useEffect(() => {
    if (caseId) store.set("hvnt33.case", caseId);
    setDossier(null); setIntakes([]); setRuns([]); setVisits([]); setSaved([]); setArchiveJobs([]); setHistories([]); setOwn({ snapshots: [], watches: [], changes: [] });
    if (connected && caseId) void refresh();
  }, [caseId, connected, refresh]);
  // The agent files captures in the background; keep the case view current.
  useEffect(() => {
    if (!connected || !caseId) return;
    const t = setInterval(() => { if (document.visibilityState === "visible") void refresh(); }, 4000);
    return () => clearInterval(t);
  }, [connected, caseId, refresh]);

  // ── Tabs ───────────────────────────────────────────────────────────────────
  // Tabs open in the current case's browser profile (see lib/tabs.ts).
  const profileRef = useRef(profileFor(caseId, caseId ? store.get(profileKey(caseId), "shared") : null));
  // The case's network route (a proxy for its own profile; "" for direct).
  const routeRef = useRef("");
  // Which of the case's cookie jars its tabs use: "" direct, "tor", or the proxy address.
  const routeKeyRef = useRef("");
  const rememberRouteKey = (profile: string, key: string) => {
    if (!key) return;
    const k = `hvnt33.routekeys.${profile}`;
    try { const list: string[] = JSON.parse(store.get(k, "[]")); if (!list.includes(key)) store.set(k, JSON.stringify([...list, key])); } catch { store.set(k, JSON.stringify([key])); }
  };
  const casesRef = useRef(cases);
  casesRef.current = cases;
  const openTab = useCallback(async (url: string, activate = true, lastSerp: SerpRef | null = null) => {
    rememberRouteKey(profileRef.current, routeKeyRef.current);
    const label = await browser.open(url, activate, profileRef.current, routeRef.current, routeKeyRef.current);
    setTabs(ts => [...ts, { label, url, title: domainOf(url) || "New tab", loading: true, lastSerp, info: null }]);
    if (activate || !activeRef.current) setActive(label);
    return label;
  }, []);

  const activate = useCallback(async (label: string) => {
    setActive(label);
    setView("browser");
    await browser.activate(label);
  }, []);

  const closeTab = useCallback(async (label: string) => {
    const list = tabsRef.current;
    const i = list.findIndex(t => t.label === label);
    await browser.close(label).catch(() => {});
    if (previewLabel.current === label) clearPreview("preview tab closed");
    for (const [e, l] of engineTabs.current) if (l === label) engineTabs.current.delete(e);
    const rest = list.filter(t => t.label !== label);
    setTabs(rest);
    if (activeRef.current === label) {
      const next = rest[Math.min(i, rest.length - 1)];
      setActive(next?.label ?? null);
      if (next) await browser.activate(next.label);
    }
  }, []);

  const go = useCallback(async (input: string) => {
    const url = resolveAddress(input, engines[0]);
    setEditingAddress(false);
    setView("browser");
    const label = activeRef.current;
    if (label) await browser.navigate(label, url);
    else await openTab(url);
  }, [engines, openTab]);

  const setTabField = useCallback((label: string, patch: Partial<Tab>) => {
    setTabs(ts => ts.map(t => (t.label === label ? { ...t, ...patch } : t)));
  }, []);

  /** Run the query on every selected engine (or the given ones), one tab per engine. */
  const fanOut = useCallback(async (q: string, only?: EngineId[]) => {
    const text = q.trim();
    if (!text) return;
    setView("browser");
    let first: string | null = null;
    for (const id of only?.length ? only : engines) {
      const url = engineById(id)!.url(text);
      const existing = engineTabs.current.get(id);
      if (existing && tabsRef.current.some(t => t.label === existing)) {
        await browser.navigate(existing, url);
        first ??= existing;
      } else {
        const label = await openTab(url, !first);
        engineTabs.current.set(id, label);
        first ??= label;
      }
    }
    if (first) await activate(first);
    if (!caseRef.current) flash("Choose or create an investigation to record what each engine returns.", "warn");
  }, [engines, openTab, activate, flash]);

  // ── Recording observed results ─────────────────────────────────────────────
  const recordResults = useCallback(async (label: string, url: string, manual = false) => {
    const serp = parseSerpUrl(url);
    if (!serp) { if (manual) flash("This page is not a recognised search results page.", "warn"); return; }
    const key = `${label}|${url}`;
    if (recording.current.has(key) && !manual) return;
    recording.current.add(key);
    try {
      for (const delay of manual ? [0, 1500] : [900, 2500, 5000]) {
        await new Promise(r => setTimeout(r, delay));
        const tab = tabsRef.current.find(t => t.label === label);
        if (!tab || !sameSerp(tab.url, url)) return; // navigated away
        const page = await browser.extractSerp(label).catch(() => null);
        if (page?.challenge) {
          // Never bypassed: once the researcher completes it, the reload is recorded.
          setTabField(label, { challenge: true, results: [] });
          flash(`${engineById(serp.engine)?.name} wants to verify you're human. Complete the check in its tab; results are recorded when the page loads.`, "warn");
          return;
        }
        if (!page?.results.length) continue;
        // The data panel shows the results whether or not a case is open.
        setTabField(label, { results: page.results, challenge: false });
        const investigationId = caseRef.current;
        if (!investigationId) { if (manual) flash("Choose an investigation to record these results.", "warn"); return; }
        const run = await data.recordSearch({ investigationId, engine: serp.engine, query: serp.query, url, pageTitle: page.title, results: page.results });
        if (!run.duplicate) flash(`Recorded ${run.results.length} ${engineById(serp.engine)?.name} results for “${serp.query}”`, "ok");
        else if (manual) flash("These results were already recorded.", "info");
        void refresh();
        return;
      }
      flash(`No results recognised on this ${engineById(serp.engine)?.name} page. It may be a consent or bot-check page — handle it, then ⌘⇧R.`, "warn");
    } catch (e) {
      flash(`Could not record results: ${e}`, "warn");
    } finally {
      if (!manual) setTimeout(() => recording.current.delete(key), 60_000);
    }
  }, [flash, refresh, setTabField]);

  /** Read what an ordinary page declares about itself, and log the visit to the case. */
  const observePage = useCallback(async (label: string, url: string) => {
    if (!/^https?:/.test(url) || parseSerpUrl(url)) return;
    await new Promise(r => setTimeout(r, 600));
    const tab = tabsRef.current.find(t => t.label === label);
    if (!tab || tab.url !== url) return;
    const info = await browser.pageInfo(label).catch(() => null);
    if (!info) return;
    setTabField(label, { info });
    const investigationId = caseRef.current;
    // Replays of the case's own snapshots are not browsing (and their links carry a signed token).
    if (!investigationId || !recordVisitsRef.current || parseReplayUrl(url, replayBaseRef.current)) return;
    const visit = await data.recordVisit({ investigationId, url: info.url, title: info.title, referrer: info.referrer, found: tab.lastSerp, meta: info as unknown as Record<string, unknown> }).catch(() => null);
    if (visit && caseRef.current === investigationId) setVisits(vs => [visit, ...vs.filter(x => x.id !== visit.id)]);
  }, [setTabField]);

  // ── Browser events ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!hasNative()) return;
    const offs = [
      browser.onPage(e => {
        setTabs(ts => ts.map(t => {
          if (t.label !== e.label) return t;
          const prevSerp = parseSerpUrl(t.url);
          const lastSerp = e.url !== t.url && prevSerp ? prevSerp : t.lastSerp;
          if (e.kind === "title") return { ...t, title: e.title || t.title, url: e.url || t.url, lastSerp };
          // A new page load: what was read from the previous page no longer applies.
          const fresh = e.kind === "started" && e.url !== t.url ? { results: undefined, info: null, challenge: false } : {};
          return { ...t, ...fresh, url: e.url, loading: e.kind === "started", lastSerp };
        }));
        if (e.kind === "finished") { void recordResults(e.label, e.url); void observePage(e.label, e.url); }
      }),
      browser.onOpenRequest(e => {
        const opener = tabsRef.current.find(t => t.label === e.label);
        const context = opener ? parseSerpUrl(opener.url) ?? opener.lastSerp : null;
        void openTab(e.url, true, context);
      }),
      browser.onBlocked(e => flash(`Blocked navigation to ${e.url.slice(0, 80)} — browser tabs only open web pages.`, "warn")),
      browser.onDownload(e => {
        if (e.state === "started") flash(`Downloading to ${e.path}`, "info");
        if (e.state === "finished") flash("Download finished — drag it into the agent terminal to file it.", "ok");
        if (e.state === "failed") flash("Download failed.", "warn");
      }),
    ];
    return () => { offs.forEach(p => p.then(off => off())); };
  }, [openTab, recordResults, observePage, flash]);

  // Keep the native page view glued to whichever area shows it: the browser
  // viewport, or the Search Lab's preview pane.
  const pageTarget = view === "browser" ? (tabs.some(t => t.label === active) ? viewportEl : null) : view === "lab" && previewUrl ? previewEl : null;
  useLayoutEffect(() => {
    if (!hasNative()) return;
    const el = pageTarget;
    if (!el) {
      void browser.layout({ x: 0, y: 0, width: 0, height: 0, visible: false });
      return;
    }
    let frame = 0;
    const sync = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const r = el.getBoundingClientRect();
        void browser.layout({ x: r.left, y: r.top, width: r.width, height: r.height, visible: true });
      });
    };
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    window.addEventListener("resize", sync);
    return () => { ro.disconnect(); window.removeEventListener("resize", sync); cancelAnimationFrame(frame); };
  }, [pageTarget, active]);

  // The Lab's preview pane always shows its own tab, whatever was active in the browser.
  useEffect(() => {
    if (view !== "lab" || !previewUrl) return;
    const label = previewLabel.current;
    if (!label) return; // the preview tab is still opening
    // Closing the preview tab clears the preview where it happens (closeTab, case swaps);
    // a tab list that is momentarily behind must never drop it here.
    if (!tabs.some(t => t.label === label)) return;
    if (active !== label) { setActive(label); void browser.activate(label).catch(() => {}); }
  }, [view, previewUrl, tabs, active]);

  /** Show a URL in the Search Lab's preview pane, reusing one preview tab. */
  const preview = useCallback(async (url: string) => {
    setPreviewUrl(url);
    const existing = previewLabel.current && tabsRef.current.some(t => t.label === previewLabel.current) ? previewLabel.current : null;
    if (existing) {
      setActive(existing);
      await browser.navigate(existing, url);
      await browser.activate(existing);
      return existing;
    }
    previewLabel.current = await openTab(url, true);
    return previewLabel.current;
  }, [openTab]);

  // ── Saved searches ─────────────────────────────────────────────────────────
  const saveSearch = useCallback(async (kind: "web" | "lab", q: string) => {
    const investigationId = caseRef.current;
    if (!investigationId) { flash("Choose an investigation first.", "warn"); return; }
    const s = await data.saveSearch({ investigationId, kind, query: q, engines });
    setSaved(list => [s, ...list.filter(x => x.id !== s.id)]);
    flash(kind === "web" ? `Saved “${q}” — re-run it from the Searches tab.` : "Query saved to this case.", "ok");
  }, [engines, flash]);
  const rerun = useCallback(async (s: SavedSearch) => {
    await fanOut(s.query, s.engines as EngineId[]);
    const updated = await data.markRerun(s.id).catch(() => null);
    if (updated) setSaved(list => list.map(x => (x.id === s.id ? updated : x)));
  }, [fanOut]);
  const deleteSaved = useCallback(async (id: string) => {
    await data.deleteSavedSearch(id).catch(e => flash(String(e), "warn"));
    setSaved(list => list.filter(x => x.id !== id));
  }, [flash]);

  // ── Capture ────────────────────────────────────────────────────────────────
  // A capture is saved to the case at once (with a snapshot of its page), and a
  // reference to it goes into the agent's message at the bottom: the researcher
  // adds a note, or more captures, and sends it. Page content never enters the terminal.
  const [captureSnapshots, setCaptureSnapshots] = useState(() => store.get("hvnt33.captureSnapshots", "1") !== "0");
  const captureSnapshotsRef = useRef(captureSnapshots);
  captureSnapshotsRef.current = captureSnapshots;
  // Asking the Wayback Machine to save each captured page makes its address public: opt in.
  const saveConfiguredRef = useRef(saveConfigured);
  saveConfiguredRef.current = saveConfigured;
  const [captureWayback, setCaptureWayback] = useState(() => store.get("hvnt33.captureWayback", "0") === "1");
  const captureWaybackRef = useRef(captureWayback);
  captureWaybackRef.current = captureWayback;
  const capture = useCallback(async (mode: "selection" | "page") => {
    const tab = tabsRef.current.find(t => t.label === activeRef.current);
    if (!tab) { flash("Open a page first, then highlight text or point at an image.", "warn"); return; }
    const investigationId = caseRef.current;
    if (!investigationId) { flash("Choose or create an investigation first: captures are saved to it.", "warn"); return; }
    try {
      const c = await browser.capture(tab.label, mode);
      if (c.error) { flash(c.error, "warn"); return; }
      if (mode === "page" && !c.pageText) { flash("This page has no readable text to capture.", "warn"); return; }
      const req = buildCapture(c, { investigationId, note: "", searchContext: parseSerpUrl(tab.url) ?? tab.lastSerp });
      const saved = await submitCapture(req, tab.label);
      if (captureSnapshotsRef.current && /^https?:/.test(req.sourceUrl) && !parseWaybackUrl(req.sourceUrl)) void snapshotNow(req.sourceUrl, saved.id, investigationId);
      if (captureWaybackRef.current && saveConfiguredRef.current && /^https?:/.test(req.sourceUrl) && !parseWaybackUrl(req.sourceUrl)) void archiveNow(req.sourceUrl, saved.id);
      setTermSize(s => (s === "min" ? "normal" : s));
      const put = terminal.current?.insert(captureReference(saved.id, captureKind(c), req.sourceUrl)) ?? false;
      if (put) {
        await focusApp();
        terminal.current?.focus();
        flash("Captured. It is in the agent's message below: add a note and press Enter.", "ok");
      } else {
        flash("Captured to the case. Start the agent to file it; it is waiting in Activity.", "warn");
      }
      void refresh();
    } catch (e) {
      flash(String(e), "warn");
    }
  }, [flash, refresh, snapshotNow, archiveNow]);

  const sendToAgent = useCallback((items: { intakeId: string; kind: ReturnType<typeof captureKind> }[], investigationId: string) => {
    const inv = cases.find(c => c.id === investigationId);
    if (!inv) return false;
    return terminal.current?.send(agentInstruction(items, inv)) ?? false;
  }, [cases]);

  const openUrl = useCallback((url: string) => { void openTab(url, true).then(activate).catch(e => flash(String(e), "warn")); }, [openTab, activate, flash]);
  // Replay opens the snapshot on the server through a signed, expiring link.
  const replay = useCallback(async (s: OwnSnapshot) => {
    try {
      const link = await data.replayUrl(s.id);
      const label = await openTab(link.url, true);
      await activate(label);
      return label;
    } catch (e) { flash(String(e).replace(/^Error: /, ""), "warn"); return undefined; }
  }, [openTab, activate, flash]);

  // ── Tabs per case, browser profiles ────────────────────────────────────────
  // Each case keeps its own open tabs (restored on launch and when switching
  // back) and browses in its profile. Switching cases swaps the tab set.
  const shownCase = useRef<string | null | undefined>(undefined);
  const restoring = useRef(false);
  // Swaps run one at a time, in order: switching cases quickly, or changing a
  // profile while tabs are still opening, must never interleave.
  const swapQueue = useRef<Promise<void>>(Promise.resolve());
  const queuedSwaps = useRef(0);
  const inOrder = useCallback((work: () => Promise<void>) => {
    queuedSwaps.current++;
    restoring.current = true;
    const run = swapQueue.current.then(work).finally(() => {
      if (--queuedSwaps.current === 0) restoring.current = false;
    });
    swapQueue.current = run.catch(() => {});
    return run;
  }, []);
  const swapTabs = useCallback(async (id: string | null) => {
    try {
      for (const t of tabsRef.current) await browser.close(t.label).catch(() => {});
      engineTabs.current.clear();
      clearPreview(`swapping to case ${String(id).slice(0, 8)}`);
      tabsRef.current = [];
      activeRef.current = null;
      setTabs([]);
      setActive(null);
      shownCase.current = id;
      profileRef.current = profileFor(id, id ? store.get(profileKey(id), "shared") : null);
      routeRef.current = "";
      routeKeyRef.current = "";
      // A case with a route or lock is checked (and its route resolved) before anything of it loads.
      if (!(await assessRef.current(id, false))) return;
      const saved = loadTabs(store.get(tabsKey(id), ""));
      let current: string | null = null;
      for (const [i, t] of saved.tabs.entries()) {
        const label = await openTab(t.url, false, t.lastSerp as SerpRef | null);
        const engine = engineOf(t.url);
        if (engine && !engineTabs.current.has(engine)) engineTabs.current.set(engine, label);
        if (i === saved.active) current = label;
      }
      if (current) { setActive(current); await browser.activate(current); }
    } catch (e) {
      flash(`Could not restore tabs: ${String(e)}`, "warn");
    }
  }, [openTab, flash]);
  const showTabsOf = useCallback((id: string | null) => inOrder(() => swapTabs(id)), [inOrder, swapTabs]);
  const requestedCase = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (!hasNative() || requestedCase.current === caseId) return;
    requestedCase.current = caseId;
    void showTabsOf(caseId);
  }, [caseId, showTabsOf]);
  useEffect(() => {
    if (restoring.current || shownCase.current === undefined) return;
    store.set(tabsKey(shownCase.current), JSON.stringify(saveTabs(tabs, active, replayBase)));
  }, [tabs, active, replayBase]);

  const [showBrowsing, setShowBrowsing] = useState(false);
  // The Case view (⌘4): its tab and the record in focus.
  const [caseTab, setCaseTab] = useState<CaseTab>("records");
  const [caseFocus, setCaseFocus] = useState<string | null>(null);
  useEffect(() => { setCaseFocus(null); }, [caseId]);
  const reviewCount = (dossier?.records ?? []).filter(r => r.filedBy === "agent" && !r.reviewedAt).length + intakes.filter(i => i.state === "pending").length;
  const setProfileChoiceRef = useRef<(c: ProfileChoice) => Promise<void>>(async () => {});
  const clearProfileRef = useRef<(p: string) => Promise<void>>(async () => {});
  const profileChoice = (caseId ? store.get(profileKey(caseId), "shared") : "shared") as ProfileChoice;
  const setProfileChoice = useCallback(async (choice: ProfileChoice) => {
    const id = caseRef.current;
    if (!id) return;
    store.set(profileKey(id), choice);
    await showTabsOf(id); // reopen this case's tabs in the chosen profile
    flash(choice === "own" ? "This case now browses in its own profile: separate cookies and logins." : "This case now browses in the shared profile.", "ok");
  }, [showTabsOf, flash]);
  /** Delete a profile's site data, then reopen this case's tabs (signed out). */
  const clearProfile = useCallback((profile: string) => inOrder(async () => {
    const reopen = profileRef.current === profile;
    try {
      if (reopen) for (const t of tabsRef.current) await browser.close(t.label).catch(() => {});
      let keys: string[] = [];
      try { keys = JSON.parse(store.get(`hvnt33.routekeys.${profile}`, "[]")); } catch { /* none */ }
      await browser.clearProfile(profile, keys);
      flash(profile === "shared" ? "Cleared the shared profile's cookies, logins and site data." : "Cleared this case's cookies, logins and site data.", "ok");
    } catch (e) {
      flash(String(e), "warn");
    } finally {
      if (reopen) await swapTabs(shownCase.current ?? null);
    }
  }), [inOrder, swapTabs, flash]);
  setProfileChoiceRef.current = setProfileChoice;
  clearProfileRef.current = clearProfile;

  // ── Case network: route, exit check and kill switch ─────────────────────────
  // A case can browse through a proxy (its own profile only). Its exit is
  // checked on switching, every minute and on request; if the case is locked to
  // an exit and it moves, or its route is unreachable, the case is paused:
  // its tabs close (they are kept for later) and nothing loads until it passes.
  type NetState = { status: "direct" | "checking" | "ok" | "paused"; exit?: Exit; message?: string; checkedAt?: string };
  const [net, setNet] = useState<NetState>({ status: "direct" });
  const pausedRef = useRef(new Set<string>());
  const swapTabsRef = useRef(swapTabs);
  swapTabsRef.current = swapTabs;
  /**
   * Check a case's exit and apply the kill switch. Returns whether the case may
   * browse. `reopen`: when a paused case passes again, reopen its tabs.
   */
  const assess = useCallback(async (id: string | null, reopen: boolean): Promise<boolean> => {
    const cfg: CaseNetwork = casesRef.current.find(c => c.id === id)?.network ?? { route: "", label: "", lock: null };
    const profile = profileFor(id, id ? store.get(profileKey(id), "shared") : null);
    // What the tabs actually connect to: the route, or the case's local relay (Tor circuit, proxy login).
    let route = "";
    if (profile !== "shared" && cfg.route && id) {
      try { route = await data.caseRoute(id); } catch (e) { route = cfg.route; void e; }
    }
    if (id === shownCase.current) {
      routeRef.current = route;
      routeKeyRef.current = profile === "shared" || !cfg.route ? "" : cfg.tor ? "tor" : cfg.route;
    }
    const unpause = async () => {
      if (!pausedRef.current.delete(profile)) return;
      await browser.blockProfile(profile, false).catch(() => {});
      if (reopen) await swapTabsRef.current(id);
    };
    if (!route && !cfg.lock) { setNet({ status: "direct" }); await unpause(); return true; }
    setNet(n => ({ ...n, status: n.status === "paused" ? "paused" : "checking" }));
    let exit: Exit | undefined, problem = "";
    try {
      exit = await network.exit(route);
      if (cfg.lock?.country && cfg.lock.country !== exit.country) problem = `the exit is in ${exit.country || "an unknown country"}, not ${cfg.lock.country}`;
      else if (cfg.lock?.org && cfg.lock.org !== exit.org) problem = `the exit network is ${exit.org || "unknown"}, not ${cfg.lock.org}`;
    } catch (e) {
      problem = String(e).replace(/^Error: /, "");
    }
    const checkedAt = new Date().toISOString();
    if (problem) {
      if (!pausedRef.current.has(profile)) {
        pausedRef.current.add(profile);
        await browser.blockProfile(profile, true).catch(() => {});
      }
      if (shownCase.current === id && tabsRef.current.length) {
        for (const t of tabsRef.current) await browser.close(t.label).catch(() => {});
        engineTabs.current.clear();
        clearPreview("the case was paused");
        tabsRef.current = []; activeRef.current = null; setTabs([]); setActive(null);
      }
      setNet({ status: "paused", exit, message: problem, checkedAt });
      return false;
    }
    setNet({ status: "ok", exit, checkedAt });
    await unpause();
    return true;
  }, [clearPreview]);
  const assessRef = useRef(assess);
  assessRef.current = assess;
  const checkNetwork = useCallback(() => inOrder(async () => { await assess(caseRef.current, true); }), [inOrder, assess]);
  const netKey = `${caseId}|${JSON.stringify(cases.find(c => c.id === caseId)?.network ?? null)}|${caseId ? store.get(profileKey(caseId), "shared") : ""}`;
  useEffect(() => {
    if (!hasNative()) return;
    void checkNetwork();
    const t = setInterval(() => { if (document.visibilityState === "visible") void checkNetwork(); }, 60_000);
    return () => clearInterval(t);
  }, [netKey, checkNetwork]);
  /** Save the case's route and lock; a route needs the case's own profile. Its tabs reopen through it. */
  const setCaseNetwork = useCallback(async (cfg: NetworkChange) => {
    const id = caseRef.current;
    if (!id) return;
    const inv = await data.updateInvestigation(id, { network: cfg });
    if (inv.network?.route) store.set(profileKey(id), "own");
    await loadCases();
    casesRef.current = casesRef.current.map(c => (c.id === id ? { ...c, network: inv.network } : c));
    await showTabsOf(id); // checks the new route first, then reopens the tabs through it
  }, [loadCases, showTabsOf]);
  /** While Tor starts: how far along it is (shown on the Tor button). */
  const [torStarting, setTorStarting] = useState<{ progress: number; summary: string } | null>(null);
  /** Tor on or off for the case, in one click. Built-in Tor starts when needed and stops when no case uses it. */
  const toggleTor = useCallback(async () => {
    const id = caseRef.current;
    if (!id) { flash("Choose an investigation first.", "warn"); return; }
    const cfg = casesRef.current.find(c => c.id === id)?.network;
    try {
      if (cfg?.tor) {
        await setCaseNetwork({ route: "", label: "", lock: cfg.lock ?? null });
        flash("Tor is off for this case: it connects directly.", "ok");
        return;
      }
      const tor = await data.torStatus();
      if (!tor.available) {
        flash("Tor isn't installed. Run npm run setup in the hvnt33 folder (or open Tor Browser), then click Tor again.", "warn");
        setShowBrowsing(true);
        return;
      }
      // Starting Tor takes a few seconds (longer the first time): show its progress.
      let polling = tor.builtin.installed && tor.builtin.state !== "running";
      if (polling) {
        setTorStarting({ progress: tor.builtin.progress, summary: "Starting" });
        void (async () => {
          while (polling) {
            await new Promise(r => setTimeout(r, 500));
            const s = await data.torStatus().catch(() => null);
            if (s && polling) setTorStarting({ progress: s.builtin.progress, summary: s.builtin.summary });
          }
        })();
      }
      try { await setCaseNetwork({ route: "", label: "", lock: null, tor: true }); }
      finally { polling = false; setTorStarting(null); }
      flash("This case now goes through Tor, on its own circuit.", "ok");
    } catch (e) { flash(String(e).replace(/^Error: /, ""), "warn"); }
  }, [setCaseNetwork, flash]);
  /** Tor: a new circuit (and exit) for the case; its pages reload through it. */
  const newExit = useCallback(async () => {
    const id = caseRef.current;
    if (!id) return;
    try {
      await data.newExit(id);
      await loadCases();
      await showTabsOf(id);
      flash("New Tor circuit: the case's pages reloaded through a new exit.", "ok");
    } catch (e) { flash(String(e).replace(/^Error: /, ""), "warn"); }
  }, [loadCases, showTabsOf, flash]);
  const setCaseNetworkRef = useRef(setCaseNetwork);
  setCaseNetworkRef.current = setCaseNetwork;
  const toggleTorRef = useRef(toggleTor);
  toggleTorRef.current = toggleTor;
  const newExitRef = useRef(newExit);
  newExitRef.current = newExit;
  const checkNetworkRef = useRef(checkNetwork);
  checkNetworkRef.current = checkNetwork;
  const netRef = useRef(net);
  netRef.current = net;

  // ── Menu shortcuts ─────────────────────────────────────────────────────────
  const menuHandler = useRef<(id: string) => void>(() => {});
  menuHandler.current = (id: string) => {
    const label = activeRef.current;
    switch (id) {
      case "search": void focusApp().then(() => { searchInput.current?.focus(); searchInput.current?.select(); }); break;
      case "address": setView("browser"); setEditingAddress(true); void focusApp().then(() => setTimeout(() => addressInput.current?.select(), 0)); break;
      case "new-tab": setView("browser"); void openTab(engineById(engines[0])!.home).catch(e => flash(String(e), "warn")); break;
      case "close-tab": if (label) void closeTab(label); break;
      case "capture-selection": setView("browser"); void capture("selection"); break;
      case "capture-page": setView("browser"); void capture("page"); break;
      case "record-results": { const t = tabsRef.current.find(x => x.label === label); if (t) void recordResults(t.label, t.url, true); break; }
      case "view-browser": setView("browser"); break;
      case "view-lab": setView("lab"); break;
      case "view-case": setCaseAdmin(null); setView("case"); break;
      case "theme-system": setThemeChoice("system"); break;
      case "theme-lapis": setThemeChoice("lapis"); break;
      case "theme-nox": setThemeChoice("nox"); break;
      case "connection": setShowConnection(true); void focusApp(); break;
      case "clear-browsing-data": setShowBrowsing(true); void focusApp(); break;
      case "check-updates": void updates.check().then(next => {
        setUpdate(next);
        if (next.status === "current") flash(`HVNT33 ${next.currentVersion} is up to date.`, "ok");
        if (next.status === "error") flash(next.message, "warn");
      }); break;
      case "website": void openExternal("https://hvnt33.com"); break;
      case "data-panel": setShowData(v => { store.set("hvnt33.dataPanel", v ? "0" : "1"); return !v; }); break;
      case "toggle-terminal": setTermSize(s => (s === "min" ? "normal" : s)); void focusApp().then(() => terminal.current?.focus()); break;
      case "back": case "forward": case "reload": if (label) void browser.history(label, id); break;
    }
  };
  useEffect(() => {
    if (!hasNative()) return;
    const off = onMenu(id => menuHandler.current(id));
    return () => { off.then(f => f()); };
  }, []);

  // ── End-to-end harness (debug builds with HVNT33_E2E=1 only) ────────────
  const e2eStarted = useRef(false);
  useEffect(() => {
    if (!hasNative() || !connected || e2eStarted.current) return;
    e2eStarted.current = true;
    void invoke<E2EConfig | null>("e2e_config").then(config => {
      if (!config) return;
      void runE2E(config, {
        engines,
        engineTab: engine => engineTabs.current.get(engine),
        createCase: async (title, ownProfile = false) => {
          const inv = await data.createInvestigation(title, "Automated desktop smoke test; safe to delete.");
          store.set(profileKey(inv.id), ownProfile ? "own" : "shared");
          await loadCases();
          setCaseId(inv.id);
          caseRef.current = inv.id;
          return inv;
        },
        fanOut,
        openTab: (url, foundVia) => openTab(url, true, foundVia ?? null),
        tab: label => tabsRef.current.find(t => t.label === label),
        saveSearch: q => saveSearch("web", q),
        rerun,
        preview,
        archiveEntry: url => archiveCacheRef.current[urlKey(url)],
        activeTab: () => activeRef.current,
        refresh: () => refreshRef.current(),
        debugState: () => ({ message: messageRef.current, previewCleared: previewCleared.current, profile: profileRef.current, shownCase: shownCase.current, view: viewRef.current, active: activeRef.current, previewUrl: previewUrlRef.current, previewLabel: previewLabel.current, tabs: tabsRef.current.map(t => `${t.label.slice(0, 8)} ${t.url.slice(0, 60)}`) }),
        tabUrl: label => tabsRef.current.find(t => t.label === label)?.url,
        tabLoading: label => tabsRef.current.find(t => t.label === label)?.loading ?? true,
        capture: (label, mode) => browser.capture(label, mode),
        snapshotNow: url => snapshotNow(url),
        selectCase: id => setCaseId(id),
        setProfile: choice => setProfileChoiceRef.current(choice),
        clearProfile: profile => clearProfileRef.current(profile),
        tabs: () => tabsRef.current.map(t => ({ label: t.label, url: t.url, loading: t.loading })),
        setNetwork: cfg => setCaseNetworkRef.current(cfg),
        toggleTor: () => toggleTorRef.current(),
        newExit: () => newExitRef.current(),
        checkNetwork: () => checkNetworkRef.current(),
        netState: () => netRef.current,
        restoring: () => restoring.current,
        watchPage: (url, every) => watchPage(url, every),
        replay,
        show: async state => {
          if (state.labQuery) localStorage.setItem("hvnt33.lab.last", state.labQuery);
          if (state.view) { setView("browser"); await new Promise(r => setTimeout(r, 50)); setView(state.view); }
          if (state.tab) await activate(state.tab);
          if (state.captureToChat) await capture(state.captureToChat);
          if (state.caseTab) window.dispatchEvent(new CustomEvent("hvnt33:case-tab", { detail: state.caseTab }));
        },
        submit: async (c, label, investigationId, note) => {
          const tab = tabsRef.current.find(t => t.label === label);
          return submitCapture(buildCapture(c, { investigationId, note, searchContext: tab?.lastSerp ?? null }), label);
        },
      });
    }).catch(() => {});
  }, [connected, engines, fanOut, openTab, loadCases, activate, saveSearch, rerun, preview, snapshotNow, watchPage, replay, capture]);

  // ── Derived ────────────────────────────────────────────────────────────────
  const activeTab = tabs.find(t => t.label === active) ?? null;
  const events = useMemo(() => allEvents(dossier, runs, intakes, visits, histories, own), [dossier, runs, intakes, visits, histories, own]);
  const ownArchive = useMemo(() => ({ ...own, jobs: archiveJobs.filter(j => j.kind === "archive.capture") }), [own, archiveJobs]);
  // Look up the archive history of the page being read once its details are in.
  const replayOf = useMemo(() => {
    const r = activeTab ? parseReplayUrl(activeTab.url, replayBase) : null;
    return r ? own.snapshots.find(s => s.id === r.snapshotId) ?? null : null;
  }, [activeTab, replayBase, own.snapshots]);
  const archiveTarget = activeTab && activeTab.info && !parseSerpUrl(activeTab.url) && /^https?:/.test(activeTab.url)
    ? replayOf?.url ?? (parseReplayUrl(activeTab.url, replayBase) ? "" : parseWaybackUrl(activeTab.url)?.original ?? activeTab.url) : "";
  useEffect(() => { if (autoArchive && archiveTarget && !archiveEntry(archiveTarget)) void lookupArchive(archiveTarget); }, [autoArchive, archiveTarget, archiveEntry, lookupArchive]);
  const index = useMemo(() => urlIndex(dossier, intakes, visits), [dossier, intakes, visits]);
  const recentQueries = useMemo(() => [...new Set(runs.map(r => r.query))].slice(0, 8), [runs]);
  const activeSerp = activeTab ? parseSerpUrl(activeTab.url) : null;
  useEffect(() => { if (!editingAddress) setAddress(activeTab?.url ?? ""); }, [activeTab?.url, editingAddress]);

  const toggleEngine = (id: EngineId) => {
    const next = engines.includes(id) ? engines.filter(e => e !== id) : [...engines, id];
    if (!next.length) return;
    const ordered = ENGINES.map(e => e.id).filter(e => next.includes(e));
    setEngines(ordered);
    store.set("hvnt33.engines", JSON.stringify(ordered));
  };

  const openCaseAdmin = (mode: "list" | "create") => {
    setCaseAdmin(mode);
    setView("case");
  };
  const selectCase = (id: string, openCase = false) => {
    setCaseId(id);
    setCaseAdmin(null);
    if (openCase) setView("case");
  };
  const createCase = async (title: string, question: string, ownProfile: boolean) => {
    const inv = await data.createInvestigation(title, question);
    store.set(profileKey(inv.id), ownProfile ? "own" : "shared");
    // A new case starts with the research tabs that were open when it was made.
    store.set(tabsKey(inv.id), store.get(tabsKey(shownCase.current ?? null), ""));
    await loadCases();
    setCaseId(inv.id);
    setCaseAdmin(null);
    setView("case");
  };
  const archiveCase = async (id: string) => {
    await data.archiveInvestigation(id);
    const remaining = await loadCases();
    if (caseRef.current === id) setCaseId(remaining[0]?.id ?? null);
    setCaseAdmin("list");
  };
  const restoreCase = async (id: string) => {
    await data.restoreInvestigation(id);
    await loadCases();
    setCaseId(id);
    setCaseAdmin("list");
  };

  const dragColumn = (e: React.PointerEvent) => {
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => setRightWidth(Math.min(Math.max(window.innerWidth - ev.clientX, 340), window.innerWidth - 480));
    const up = () => { el.removeEventListener("pointermove", move); el.removeEventListener("pointerup", up); setRightWidth(w => { store.set("hvnt33.rightWidth", String(w)); return w; }); };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
  };
  const dragData = (e: React.PointerEvent) => {
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const left = el.parentElement!.getBoundingClientRect().left;
    const move = (ev: PointerEvent) => setDataWidth(Math.min(Math.max(ev.clientX - left, 260), 640));
    const up = () => { el.removeEventListener("pointermove", move); el.removeEventListener("pointerup", up); setDataWidth(w => { store.set("hvnt33.dataWidth", String(w)); return w; }); };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
  };
  const dragRow = (e: React.PointerEvent) => {
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    setTermSize("normal");
    const move = (ev: PointerEvent) => setTermHeight(Math.min(Math.max(window.innerHeight - ev.clientY - 26, 120), window.innerHeight - 220));
    const up = () => { el.removeEventListener("pointermove", move); el.removeEventListener("pointerup", up); setTermHeight(h => { store.set("hvnt33.termHeight", String(h)); return h; }); };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
  };

  const currentCase = cases.find(c => c.id === caseId) ?? null;

  // The terminal is one element placed by the grid, so moving or resizing it never restarts the agent.
  const TERM_HEAD = 30;
  const termRow = termSize === "min" ? `${TERM_HEAD}px` : termSize === "max" ? "minmax(0, 1fr)" : `${termHeight}px`;
  const layout = {
    gridTemplateColumns: `minmax(480px, 1fr) 5px ${rightWidth}px`,
    gridTemplateRows: `46px ${termSize === "max" ? "0px" : "minmax(0, 1fr)"} ${termSize === "normal" ? "5px" : "0px"} ${termRow} 24px`,
    gridTemplateAreas: termDock === "bottom"
      ? `"top top top" "left colr right" "termr termr termr" "term term term" "status status status"`
      : `"top top top" "left colr right" "left colr termr" "left colr term" "status status status"`,
  };
  const dockTerminal = (d: "bottom" | "side") => { setTermDock(d); store.set("hvnt33.termDock", d); };
  const termControls = (
    <div className="term-controls">
      <button className="icon" onClick={() => dockTerminal(termDock === "bottom" ? "side" : "bottom")} title={termDock === "bottom" ? "Move the terminal under the investigation" : "Move the terminal across the bottom"}>{termDock === "bottom" ? "◨" : "⬓"}</button>
      <button className="icon" onClick={() => setTermSize(s => (s === "min" ? "normal" : "min"))} title={termSize === "min" ? "Restore the terminal" : "Minimize the terminal"}>{termSize === "min" ? "▴" : "▾"}</button>
      <button className="icon" onClick={() => setTermSize(s => (s === "max" ? "normal" : "max"))} title={termSize === "max" ? "Restore the terminal" : "Maximize the terminal"}>{termSize === "max" ? "❐" : "□"}</button>
    </div>
  );

  return (
    <div className="app" style={layout}>
      <header className="topbar">
        <div className="brand"><img src={mark2x} srcSet={`${mark2x} 2x, ${mark3x} 3x`} alt="HVNT33" width={36} height={36} /></div>
        <form className="omnisearch" onSubmit={e => { e.preventDefault(); void fanOut(query); }}>
          <input ref={searchInput} value={query} onChange={e => setQuery(e.target.value)} placeholder="Search every engine…" aria-label="Search engines" />
          <kbd>⌘K</kbd>
        </form>
        <div className="engines">
          {ENGINES.map(e => (
            <button key={e.id} className={engines.includes(e.id) ? "engine on" : "engine"} style={{ ["--c" as string]: e.color }} onClick={() => toggleEngine(e.id)} title={`${e.name} — click to ${engines.includes(e.id) ? "exclude" : "include"}`}>
              {e.name}
            </button>
          ))}
        </div>
        <span className="grow" />
        <div className="views seg">
          <button className={view === "browser" ? "on" : ""} onClick={() => setView("browser")}>Browser <kbd>⌘1</kbd></button>
          <button className={view === "lab" ? "on" : ""} onClick={() => setView("lab")}>Search Lab <kbd>⌘2</kbd></button>
          <button className={view === "case" ? "on" : ""} onClick={() => { setCaseAdmin(null); setView("case"); }}>Case{reviewCount > 0 && <span className="count" title="Waiting for your review">{reviewCount}</span>} <kbd>⌘4</kbd></button>
        </div>
        <CaseSwitcher
          cases={cases}
          caseId={caseId}
          workspaceName={workspace?.name ?? (connected ? "Workspace" : "Database offline")}
          workspaceKind={status?.remote ? "cloud" : "local"}
          connected={connected}
          onSelect={id => selectCase(id)}
          onCreate={() => openCaseAdmin("create")}
          onManage={() => openCaseAdmin("list")}
          onWorkspace={() => setShowConnection(true)}
          onCloud={() => { void openExternal("https://hvnt33.com"); }}
        />
      </header>

      <main className="left">
        {view === "browser" && (
          <>
            <div className="tabstrip">
              <button className={`home-tab ${!activeTab ? "on" : ""}`} onClick={() => { setActive(null); setView("browser"); }} title="Research home" aria-label="Research home">⌂</button>
              {tabs.map(t => {
                const serp = parseSerpUrl(t.url);
                const engine = serp ? engineById(serp.engine) : null;
                return (
                  <div key={t.label} className={t.label === active ? "tab on" : "tab"} onClick={() => void activate(t.label)} onAuxClick={e => { if (e.button === 1) void closeTab(t.label); }} title={t.url}>
                    <span className="fav" style={engine ? { background: engine.color } : undefined}>{engine ? engine.short : (domainOf(t.url)[0] ?? "·").toUpperCase()}</span>
                    <span className="tab-title">{t.loading ? "Loading…" : t.title}</span>
                    <button className="x" onClick={e => { e.stopPropagation(); void closeTab(t.label); }} aria-label="Close tab">×</button>
                  </div>
                );
              })}
              <button className="newtab" onClick={() => menuHandler.current("new-tab")} title="New tab (⌘T)">+</button>
            </div>
            {activeTab && (
              <div className="navbar">
                <button className="icon" onClick={() => void browser.history(activeTab.label, "back")} title="Back (⌘[)">‹</button>
                <button className="icon" onClick={() => void browser.history(activeTab.label, "forward")} title="Forward (⌘])">›</button>
                <button className="icon" onClick={() => void browser.history(activeTab.label, activeTab.loading ? "stop" : "reload")} title="Reload (⌘R)">{activeTab.loading ? "×" : "↻"}</button>
                <form className="address" onSubmit={e => { e.preventDefault(); void go(address); }}>
                  <input ref={addressInput} value={address} onFocus={() => setEditingAddress(true)} onBlur={() => setEditingAddress(false)} onChange={e => setAddress(e.target.value)} spellCheck={false} aria-label="Address" />
                </form>
                {activeSerp
                  ? <button className="action" onClick={() => void recordResults(activeTab.label, activeTab.url, true)} title="Record these results again (⌘⇧R)">⟳ Record results</button>
                  : <button className="action" onClick={() => void capture("page")} title="Capture the readable text of this page (⌘⇧P)">Capture page</button>}
                <button className="action primary" onClick={() => void capture("selection")} title="Capture highlighted text, or the image under the pointer (⌘⇧S)">Capture ⌘⇧S</button>
                <button className={`icon ${showData ? "on" : ""}`} onClick={() => menuHandler.current("data-panel")} title="Show the page as data (⌘3)">▤</button>
              </div>
            )}
            <div className="browser-body">
            {showData && activeTab && (
              <>
                <div style={{ width: dataWidth }} className="data-dock">
                  <DataPanel
                    tab={activeTab}
                    runs={runs}
                    visits={visits}
                    saved={saved}
                    index={index}
                    hasCase={!!caseId}
                    onOpen={(url, background) => { void openTab(url, !background, parseSerpUrl(activeTab.url) ?? activeTab.lastSerp).catch(e => flash(String(e), "warn")); }}
                    onBackToResults={() => {
                      const s = activeTab.lastSerp;
                      const t = s && tabs.find(x => sameSerp(x.url, engineById(s.engine)!.url(s.query)));
                      if (t) void activate(t.label); else void browser.history(activeTab.label, "back");
                    }}
                    onSaveSearch={q => void saveSearch("web", q)}
                    onCapture={mode => void capture(mode)}
                    archiveEntry={archiveEntry}
                    onArchiveLookup={(url, refresh) => void lookupArchive(url, refresh)}
                    onArchiveNow={url => void archiveNow(url)}
                    archiveJobs={archiveJobs}
                    saveConfigured={saveConfigured}
                    autoArchiveLookup={autoArchive}
                    own={ownArchive}
                    replayOf={replayOf}
                    onSnapshot={url => void snapshotNow(url)}
                    onReplay={s => void replay(s)}
                    onEvidence={s => void downloadEvidence(s)}
                    onWatch={(url, every) => void watchPage(url, every)}
                  />
                </div>
                <div className="data-resizer" onPointerDown={dragData} title="Drag to resize">
                  <button className="data-toggle" onPointerDown={e => e.stopPropagation()} onClick={() => menuHandler.current("data-panel")} title="Hide the page as data (⌘3)">‹</button>
                </div>
              </>
            )}
            {!showData && activeTab && (
              <button className="data-rail" onClick={() => menuHandler.current("data-panel")} title="Show the page as data (⌘3)">›</button>
            )}
            <div ref={setViewportEl} className="viewport">
              {net.status === "paused" && (
                <div className="paused-banner" role="alert">
                  <b>This case is paused.</b> Its connection check failed: {net.message}. Its tabs are closed and nothing loads until the check passes; they reopen then.
                  <div className="row"><button className="primary" onClick={() => void checkNetwork()}>Check again</button><button className="ghost" onClick={() => setShowBrowsing(true)}>Connection settings…</button></div>
                </div>
              )}
              {!activeTab && net.status !== "paused" && (
                <div className="home">
                  <img className="home-mark" src={mark2x} srcSet={`${mark2x} 2x, ${mark3x} 3x`} alt="" aria-hidden="true" />
                  <h1>Every secret is a mosaic of public pieces.</h1>
                  <p className="sub">Search every engine, capture the pieces, and let the agent show how they fit.</p>
                  <form onSubmit={e => { e.preventDefault(); void fanOut(query); }}>
                    <input autoFocus value={query} onChange={e => setQuery(e.target.value)} placeholder={`Search ${engines.map(e => engineById(e)!.name).join(", ")}…`} />
                  </form>
                  {recentQueries.length > 0 && (
                    <div className="recent">{recentQueries.map(q => <button key={q} className="chip" onClick={() => { setQuery(q); void fanOut(q); }}>{q}</button>)}</div>
                  )}
                  <dl className="shortcuts">
                    <div><dt>⌘K</dt><dd>Search every selected engine</dd></div>
                    <div><dt>⌘⇧S</dt><dd>Capture the highlighted text or the image under the pointer</dd></div>
                    <div><dt>⌘⇧P</dt><dd>Capture a whole page</dd></div>
                    <div><dt>⌘2</dt><dd>Search Lab: query everything you've seen and kept</dd></div>
                    <div><dt>⌘J</dt><dd>Talk to the agent</dd></div>
                  </dl>
                  <nav className="home-links" aria-label="HVNT33 links">
                    <button data-label="Website" onClick={() => void openExternal("https://hvnt33.com")} aria-label="Website">
                      <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3.2 4.3 6.2 4.3 9S15 17.8 12 21c-3-3.2-4.3-6.2-4.3-9S9 6.2 12 3Z"/></svg>
                    </button>
                    <button data-label="Community" onClick={() => void openExternal("https://discord.gg/Y22TyQAQmu")} aria-label="Community">
                      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8.2 7.5A9.6 9.6 0 0 1 12 6.8c1.3 0 2.6.2 3.8.7l.7-1.3c1.7.5 3 1.3 4 2.3.7 2.8.7 5.5 0 8.1a12.5 12.5 0 0 1-4.9 2.5l-1.2-1.7c.7-.2 1.4-.6 2-1-2.7 1.2-6.1 1.2-8.8 0 .6.4 1.3.8 2 1l-1.2 1.7a12.5 12.5 0 0 1-4.9-2.5 16 16 0 0 1 0-8.1 11.2 11.2 0 0 1 4-2.3l.7 1.3Z"/><circle cx="8.7" cy="12.7" r="1"/><circle cx="15.3" cy="12.7" r="1"/></svg>
                    </button>
                    <button data-label="Source Code" onClick={() => void openExternal("https://github.com/kai-ten/hvnt33")} aria-label="Source Code">
                      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.8a9.2 9.2 0 0 0-2.9 17.9c.5.1.6-.2.6-.5v-1.8c-2.7.6-3.3-1.1-3.3-1.1-.4-1.1-1.1-1.4-1.1-1.4-.9-.6.1-.6.1-.6 1 0 1.5 1 1.5 1 .9 1.5 2.3 1.1 2.9.8.1-.6.3-1.1.6-1.4-2.2-.2-4.5-1.1-4.5-4.6 0-1 .4-1.9 1-2.5-.1-.3-.4-1.3.1-2.5 0 0 .8-.3 2.6 1a9 9 0 0 1 4.8 0c1.8-1.3 2.6-1 2.6-1 .5 1.2.2 2.2.1 2.5.6.6 1 1.5 1 2.5 0 3.5-2.3 4.4-4.5 4.6.4.3.7.9.7 1.8v2.5c0 .3.2.6.7.5A9.2 9.2 0 0 0 12 2.8Z"/></svg>
                    </button>
                  </nav>
                </div>
              )}
            </div>
            </div>
          </>
        )}
        {view === "case" && (caseAdmin ? (
          <CaseAdmin
            cases={cases}
            archived={archivedCases}
            caseId={caseId}
            mode={caseAdmin}
            profileOf={id => store.get(profileKey(id), "shared") as ProfileChoice}
            onSelect={id => selectCase(id, true)}
            onCreate={createCase}
            onArchive={archiveCase}
            onRestore={restoreCase}
            onCancelCreate={() => setCaseAdmin(caseAdmin === "create" ? "list" : "create")}
          />
        ) : currentCase ? (
          <CaseView
            investigation={currentCase}
            titleControl={<CaseSwitcher
              cases={cases}
              caseId={caseId}
              workspaceName={workspace?.name ?? (connected ? "Workspace" : "Database offline")}
              workspaceKind={status?.remote ? "cloud" : "local"}
              connected={connected}
              placement="page"
              onSelect={id => selectCase(id, true)}
              onCreate={() => openCaseAdmin("create")}
              onManage={() => openCaseAdmin("list")}
              onWorkspace={() => setShowConnection(true)}
              onCloud={() => { void openExternal("https://hvnt33.com"); }}
            />}
            dossier={dossier}
            intakes={intakes}
            tab={caseTab}
            onTab={setCaseTab}
            focus={caseFocus}
            onFocus={setCaseFocus}
            onChanged={refresh}
            onOpen={openUrl}
            onSendToAgent={i => {
              if (!caseId) return;
              const sent = sendToAgent([{ intakeId: i.id, kind: (i.captureMeta?.mode as "selection" | "image" | "page") || "selection" }], caseId);
              flash(sent ? "Sent to the agent." : "Start the agent terminal first.", sent ? "ok" : "warn");
            }}
            flash={flash}
          />
        ) : <CaseAdmin cases={cases} archived={archivedCases} caseId={caseId} mode="list" profileOf={id => store.get(profileKey(id), "shared") as ProfileChoice} onSelect={id => selectCase(id, true)} onCreate={createCase} onArchive={archiveCase} onRestore={restoreCase} onCancelCreate={() => setCaseAdmin("create")} />)}
        {view === "lab" && (
          <SearchLab
            events={events}
            loading={loading}
            onOpen={openUrl}
            onPreview={url => void preview(url).catch(e => flash(String(e), "warn"))}
            previewUrl={previewUrl}
            previewRef={setPreviewEl}
            onClosePreview={() => clearPreview("closed by the researcher")}
            saved={saved.filter(s => s.kind === "lab")}
            onSave={q => void saveSearch("lab", q)}
            onDeleteSaved={id => void deleteSaved(id)}
          />
        )}
      </main>

      <div className="col-resizer" onPointerDown={dragColumn} />

      <aside className={`right ${termSize === "max" && termDock === "side" ? "collapsed" : ""}`} style={{ gridTemplateRows: "auto minmax(0, 1fr)" }}>
        <div>
          {update && ["available", "downloading", "downloaded"].includes(update.status) && update.release && dismissedUpdate !== update.release.version && (
            <div className="service-banner update-banner" role="status">
              <b>{update.status === "downloaded" ? `HVNT33 ${update.release.version} is ready` : `Downloading HVNT33 ${update.release.version}`}</b>
              <p>{update.status === "downloaded"
                ? "Restart when you are ready. HVNT33 will close the agent and database cleanly, install the signed update, and reopen."
                : update.installable
                  ? `Your investigation stays open while the signed update downloads${update.status === "downloading" ? ` — ${Math.round(update.progress)}%` : ""}.`
                  : "This Linux package is updated through your package manager; the signed download is available on the website."}</p>
              {update.status === "downloading" && <progress className="update-progress" max="100" value={update.progress} aria-label={`Update download ${Math.round(update.progress)}%`} />}
              <div className="row">
                {update.status === "downloaded" && <button className="primary" onClick={() => void updates.install()}>Restart and install</button>}
                {update.status === "available" && update.installable && <button className="primary" onClick={() => void updates.download()}>Download now</button>}
                {!update.installable && <button className="primary" onClick={() => void openExternal("https://hvnt33.com/download")}>View download</button>}
                <button className="ghost" onClick={() => void openExternal(update.release!.url)}>Release notes</button>
                {update.status !== "downloading" && <button className="ghost" onClick={() => { store.set("hvnt33.update-dismissed", update.release!.version); setDismissedUpdate(update.release!.version); }}>Later</button>}
              </div>
            </div>
          )}
          {connected && status && !status.current && (
            <div className="service-banner">
              <b>Restart the HVNT33 server</b>
              <p>{status.detail}</p>
              <button className="ghost" onClick={() => void services.status().then(setStatus)}>Check again</button>
            </div>
          )}
          {showBrowsing && (
            <BrowsingPanel
              caseTitle={currentCase?.title ?? null}
              caseId={caseId}
              choice={profileChoice}
              onChoose={c => void setProfileChoice(c)}
              onClear={p => clearProfile(p)}
              onClose={() => setShowBrowsing(false)}
              network={currentCase?.network ?? { route: "", label: "", lock: null }}
              net={net}
              onSaveNetwork={cfg => setCaseNetwork(cfg)}
              onCheck={() => void checkNetwork()}
              routesAvailable={serverAuth === "local"}
              onToggleTor={() => void toggleTor()}
              onNewExit={() => void newExit()}
            />
          )}
          {showConnection && (
            <ConnectionPanel
              onClose={() => setShowConnection(false)}
              onChanged={() => { setCases([]); setCaseId(null); setWorkspace(null); void services.status().then(setStatus); }}
            />
          )}
          {!connected && (
            <div className="service-banner">
              <b>{starting ? "Starting HVNT33…" : status ? status.detail : "Connecting…"}</b>
              {serviceError && serviceError !== status?.root && <p>{serviceError}</p>}
              {!starting && status && !status.remote && status.hasWorkspace && <button className="primary" onClick={() => void startServices()}>Start ArcadeDB and server</button>}
              {status && !status.remote && (status.hasWorkspace
                ? <p className="dim small">Workspace: {status.root}</p>
                : <>
                    <p className="small">{status.root}</p>
                    <button className="primary" onClick={() => void services.chooseWorkspace().then(() => services.status().then(setStatus)).catch(e => setServiceError(String(e)))}>Choose hvnt33 folder…</button>
                  </>)}
              <button className="link small" onClick={() => setShowConnection(true)}>{status?.remote ? "Change server…" : "Use a hosted server…"}</button>
            </div>
          )}
        </div>
        <InvestigationPane
          cases={cases}
          caseId={caseId}
          dossier={dossier}
          intakes={intakes}
          runs={runs}
          saved={saved.filter(s => s.kind === "web")}
          archiveJobs={archiveJobs}
          own={ownArchive}
          onReplay={s => void replay(s)}
          onEvidence={s => void downloadEvidence(s)}
          onWatchAction={(w, a) => void updateWatch(w, a)}
          onChangeSeen={c => void markChangeSeen(c)}
          onRerun={s => void rerun(s)}
          onDeleteSaved={id => void deleteSaved(id)}
          onSelectCase={id => selectCase(id)}
          onManageCases={openCaseAdmin}
          onOpen={openUrl}
          onOpenRecord={id => { setCaseFocus(id); setCaseTab("records"); setView("case"); }}
          onSendToAgent={i => {
            if (!caseId) return;
            const sent = sendToAgent([{ intakeId: i.id, kind: (i.captureMeta?.mode as "selection" | "image" | "page") || "selection" }], caseId);
            flash(sent ? "Sent to the agent." : "Start the agent terminal first.", sent ? "ok" : "warn");
          }}
        />
      </aside>

      <div className="row-resizer term-resizer" onPointerDown={dragRow} onDoubleClick={() => setTermSize(s => (s === "max" ? "normal" : "max"))} />
      <div className={`term-dock ${termDock} ${termSize}`}>
        <AgentTerminal handle={terminal} onStatus={setAgentStatus} controls={termControls} />
      </div>

      <footer className="statusbar">
        <span className={`msg ${message?.tone ?? ""}`}>{message?.text ?? (currentCase ? `Case: ${currentCase.title}` : "No investigation selected")}</span>
        <span className="grow" />
        {serverAuth === "local" && caseId && (
          <button className={`svc tor ${currentCase?.network?.tor ? "ok" : ""}`} onClick={() => void toggleTor()} title={torStarting ? `Connecting to the Tor network: ${torStarting.summary}` : currentCase?.network?.tor ? "Tor is on for this case (its own circuit). Click to connect directly." : "Send this case through Tor (built in; it starts when you turn it on)"}>
            {torStarting ? `Starting Tor ${torStarting.progress}%` : currentCase?.network?.tor ? "Tor on" : "Tor off"}
          </button>
        )}
        <button className={`svc ${net.status === "paused" ? "bad" : "ok"}`} onClick={() => setShowBrowsing(true)} title={net.status === "paused" ? `Paused: ${net.message}` : "This case's connection and browser profile"}>
          {net.status === "paused" ? "Paused: connection check failed" : net.exit ? `Exit: ${net.exit.country || "?"} · ${net.exit.org || "?"}${currentCase?.network?.label ? ` (${currentCase.network.label})` : ""}` : "Direct"}
          {" · "}{profileChoice === "own" && caseId ? "own profile" : "shared profile"}
        </button>
        {saveConfigured && <button className={`svc ${captureWayback ? "ok" : ""}`} onClick={() => setCaptureWayback(v => { store.set("hvnt33.captureWayback", v ? "0" : "1"); return !v; })} title="Also ask the Wayback Machine to save each page you capture from. Its address becomes public in the Internet Archive.">{captureWayback ? "Wayback saves with captures" : "No Wayback saves"}</button>}
        <button className={`svc ${captureSnapshots ? "ok" : ""}`} onClick={() => setCaptureSnapshots(v => { store.set("hvnt33.captureSnapshots", v ? "0" : "1"); return !v; })} title="Take a timestamped snapshot of the page each time you capture from it">{captureSnapshots ? "Snapshots with captures" : "No snapshots with captures"}</button>
        <button className={`svc ${recordVisits ? "ok" : ""}`} onClick={() => setRecordVisits(v => { store.set("hvnt33.recordVisits", v ? "0" : "1"); return !v; })} title="Log pages you open (with their declared metadata) to the current case">{recordVisits ? "Logging visits" : "Visits not logged"}</button>
        <button className={`svc ${autoArchive ? "ok" : ""}`} onClick={() => setAutoArchive(v => { store.set("hvnt33.autoArchive", v ? "0" : "1"); return !v; })} title="Look up pages you read in the Wayback Machine automatically. Each lookup sends the page's URL to the Internet Archive.">{autoArchive ? "Wayback lookups on" : "Wayback lookups off"}</button>
        <button className={`svc ${connected ? "ok" : "bad"}`} onClick={() => setShowConnection(true)} title="The database connection is global to this workspace; records and links are scoped to the selected case">
          {connected ? (status?.remote ? `Connected to ${status.url.replace(/^https?:\/\//, "")}` : `${workspace?.name ?? "Local workspace"} database`) : "Offline"}
        </button>
        <span className={`svc ${agentStatus === "running" ? "ok" : ""}`}>Agent {agentStatus}</span>
        <button className="svc" onClick={() => setThemeChoice(theme === "lapis" ? "nox" : "lapis")} title={`${themeChoice === "system" ? "Following system · " : ""}${theme === "lapis" ? "Switch to dark stone (Nox)" : "Switch to travertine (Lapis)"}`} aria-label="Switch between light and dark">{themeChoice === "system" ? `System · ${theme === "lapis" ? "Light" : "Dark"}` : theme === "lapis" ? "Nox" : "Lapis"}</button>
      </footer>
    </div>
  );
}
