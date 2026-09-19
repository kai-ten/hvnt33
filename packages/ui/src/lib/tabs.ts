// Open tabs are kept per case (restored on launch and when switching cases),
// and each case browses in a profile: the shared one, or its own (separate
// cookies, logins and site storage). Stored in the app's local storage.
import { parseReplayUrl, parseSerpUrl, type EngineId } from "@hvnt33/core/engines";

export type ProfileChoice = "shared" | "own";
export interface SavedTab { url: string; title: string; lastSerp: { engine: EngineId; query: string } | null }
export interface SavedTabs { tabs: SavedTab[]; active: number }

export const MAX_SAVED_TABS = 30;
export const tabsKey = (caseId: string | null) => `hvnt33.tabs.${caseId ?? "none"}`;
export const profileKey = (caseId: string) => `hvnt33.profile.${caseId}`;

/** The browser profile a case browses in: its id when it has its own, else "shared". */
export function profileFor(caseId: string | null, choice: string | null): string {
  return caseId && choice === "own" ? caseId : "shared";
}

/**
 * What to remember of the open tabs: web pages only. Replays are left out
 * (their links carry a signed token and expire), as are blank and internal pages.
 */
export function saveTabs(tabs: { label: string; url: string; title: string; lastSerp: SavedTab["lastSerp"] }[], active: string | null, replayBase: string): SavedTabs {
  const kept = tabs.filter(t => /^https?:\/\//.test(t.url) && !parseReplayUrl(t.url, replayBase)).slice(0, MAX_SAVED_TABS);
  return { tabs: kept.map(t => ({ url: t.url, title: t.title, lastSerp: t.lastSerp })), active: Math.max(0, kept.findIndex(t => t.label === active)) };
}

/** Saved tabs from storage, tolerating anything malformed. */
export function loadTabs(raw: string | null): SavedTabs {
  try {
    const v = JSON.parse(raw ?? "");
    const tabs = (Array.isArray(v?.tabs) ? v.tabs : [])
      .filter((t: unknown): t is SavedTab => !!t && typeof (t as SavedTab).url === "string" && /^https?:\/\//.test((t as SavedTab).url))
      .slice(0, MAX_SAVED_TABS)
      .map((t: SavedTab) => ({ url: t.url, title: typeof t.title === "string" ? t.title : "", lastSerp: t.lastSerp && typeof t.lastSerp.query === "string" ? t.lastSerp : null }));
    const active = Number.isInteger(v?.active) && v.active >= 0 && v.active < tabs.length ? v.active : 0;
    return { tabs, active };
  } catch {
    return { tabs: [], active: 0 };
  }
}

/** Which engine each restored results tab belongs to, so new searches reuse it. */
export function engineOf(url: string): EngineId | null {
  return (parseSerpUrl(url)?.engine as EngineId | undefined) ?? null;
}
