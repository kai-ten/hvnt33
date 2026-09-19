import { describe, expect, it } from "vitest";
import { MAX_SAVED_TABS, engineOf, loadTabs, profileFor, saveTabs, tabsKey } from "../src/lib/tabs";

describe("tabs per case and browser profiles", () => {
  const replay = "http://localhost:4311";
  const tab = (label: string, url: string) => ({ label, url, title: label, lastSerp: null });

  it("remembers web pages, never replays or internal pages, and the active tab", () => {
    const saved = saveTabs([
      tab("a", "https://duckduckgo.com/?q=harbor"),
      tab("b", `${replay}/replay/2c58bca3-e533-443b-b29c-efe6e375eeb5?t=1.sig`),
      tab("c", "about:blank"),
      tab("d", "https://example.org/board"),
    ], "d", replay);
    expect(saved.tabs.map(t => t.url)).toEqual(["https://duckduckgo.com/?q=harbor", "https://example.org/board"]);
    expect(saved.active).toBe(1);
    expect(saveTabs([tab("a", "https://example.org/")], "gone", replay).active).toBe(0);
  });

  it("round-trips, caps the list, and survives corrupt storage", () => {
    const many = Array.from({ length: 40 }, (_, i) => tab(`t${i}`, `https://example.org/${i}`));
    const saved = saveTabs(many, "t3", replay);
    expect(saved.tabs).toHaveLength(MAX_SAVED_TABS);
    expect(loadTabs(JSON.stringify(saved))).toEqual(saved);
    expect(loadTabs(null)).toEqual({ tabs: [], active: 0 });
    expect(loadTabs("{not json")).toEqual({ tabs: [], active: 0 });
    expect(loadTabs(JSON.stringify({ tabs: [{ url: "file:///etc/hosts" }, { url: "https://ok.example/" }, 7], active: 9 }))).toEqual({ tabs: [{ url: "https://ok.example/", title: "", lastSerp: null }], active: 0 });
  });

  it("chooses a case's own profile only when asked", () => {
    const id = "2c58bca3-e533-443b-b29c-efe6e375eeb5";
    expect(profileFor(id, "own")).toBe(id);
    expect(profileFor(id, "shared")).toBe("shared");
    expect(profileFor(id, null)).toBe("shared");
    expect(profileFor(null, "own")).toBe("shared");
    expect(tabsKey(null)).toBe("hvnt33.tabs.none");
    expect(engineOf("https://www.bing.com/search?q=harbor")).toBe("bing");
    expect(engineOf("https://example.org/")).toBeNull();
  });
});
