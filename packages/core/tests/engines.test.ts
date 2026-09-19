import { describe, expect, it } from "vitest";
import { ENGINES, domainOf, parseSerpUrl, resolveAddress, sameSerp, urlKey } from "../src/engines";

describe("engines", () => {
  it("builds a results URL for every engine that parses back to the same engine and query", () => {
    const query = 'harbor works "contract award" 2025 & co';
    for (const e of ENGINES) {
      const url = e.url(query);
      expect(url.startsWith("https://")).toBe(true);
      expect(parseSerpUrl(url), e.id).toEqual({ engine: e.id, query });
    }
  });

  it("ignores engine homepages, other verticals and unrelated sites", () => {
    expect(parseSerpUrl("https://www.google.com/")).toBeNull();
    expect(parseSerpUrl("https://www.google.com/search?q=x&tbm=isch")).toBeNull();
    expect(parseSerpUrl("https://duckduckgo.com/?q=x&iax=images&ia=images")).toBeNull();
    expect(parseSerpUrl("https://www.bing.com/maps?q=x")).toBeNull();
    expect(parseSerpUrl("https://example.com/search?q=x")).toBeNull();
    expect(parseSerpUrl("https://notgoogle.com/search?q=x")).toBeNull();
    expect(parseSerpUrl("file:///etc/passwd")).toBeNull();
    expect(parseSerpUrl("not a url")).toBeNull();
  });

  it("recognises regional hosts and DuckDuckGo's html endpoint", () => {
    expect(parseSerpUrl("https://www.google.com/search?q=a+b")).toEqual({ engine: "google", query: "a b" });
    expect(parseSerpUrl("https://html.duckduckgo.com/html/?q=a")).toEqual({ engine: "duckduckgo", query: "a" });
    expect(parseSerpUrl("https://yandex.ru/search/?text=a")).toEqual({ engine: "yandex", query: "a" });
  });

  it("resolves the address bar into URLs or searches", () => {
    expect(resolveAddress("https://example.org/a")).toBe("https://example.org/a");
    expect(resolveAddress("example.org/path?x=1")).toBe("https://example.org/path?x=1");
    expect(resolveAddress("localhost:4310")).toBe("https://localhost:4310");
    expect(resolveAddress("who owns harbor works", "bing")).toBe("https://www.bing.com/search?q=who%20owns%20harbor%20works");
    expect(resolveAddress("javascript:alert(1)")).toMatch(/^https:\/\/duckduckgo\.com\/\?q=javascript/);
    expect(resolveAddress("   ")).toBe("about:blank");
  });

  it("normalizes URLs for de-duplication without losing meaningful parameters", () => {
    expect(urlKey("https://WWW.Example.org/a/?utm_source=x&b=2&a=1#frag")).toBe("https://example.org/a?a=1&b=2");
    expect(urlKey("http://example.org/")).toBe("https://example.org");
    expect(urlKey("https://example.org/doc?id=7&fbclid=abc")).toBe("https://example.org/doc?id=7");
    expect(urlKey("https://example.org/doc?id=7")).not.toBe(urlKey("https://example.org/doc?id=8"));
    expect(domainOf("https://www.Reuters.com/x")).toBe("reuters.com");
    expect(domainOf("garbage")).toBe("");
  });
});

describe("engine start pages", () => {
  it("are https pages on the engine's own host and are not results pages", () => {
    for (const e of ENGINES) {
      const u = new URL(e.home);
      expect(u.protocol).toBe("https:");
      expect(e.hosts.some(h => u.hostname === h || u.hostname.endsWith("." + h))).toBe(true);
      expect(parseSerpUrl(e.home)).toBeNull();
    }
  });
});

describe("sameSerp", () => {
  it("treats engine URL rewrites after load as the same results page", () => {
    expect(sameSerp("https://www.google.com/search?q=a+b&hl=en", "https://www.google.com/search?q=a%20b&hl=en&sei=xyz")).toBe(true);
    expect(sameSerp("https://search.brave.com/search?q=a&source=web", "https://search.brave.com/search?q=a&source=web&conversation=1")).toBe(true);
    expect(sameSerp("https://www.google.com/search?q=a", "https://www.google.com/search?q=b")).toBe(false);
    expect(sameSerp("https://www.google.com/search?q=a", "https://www.bing.com/search?q=a")).toBe(false);
    expect(sameSerp("https://example.com/", "https://example.com/")).toBe(false);
  });
});

import { parseReplayUrl } from "../src/engines";

describe("replay pages", () => {
  const id = "2c58bca3-e533-443b-b29c-efe6e375eeb5";
  it("recognises the server's own replay pages only", () => {
    expect(parseReplayUrl(`http://127.0.0.1:4391/replay/${id}?t=1.abc`, "http://127.0.0.1:4391")).toEqual({ snapshotId: id });
    expect(parseReplayUrl(`https://hvnt33.example/replay/${id}`, "https://hvnt33.example/")).toEqual({ snapshotId: id });
    expect(parseReplayUrl(`http://127.0.0.1:4391/replay/${id}`, "http://localhost:4391")).toBeNull();
    expect(parseReplayUrl(`https://evil.example/replay/${id}`, "https://hvnt33.example")).toBeNull();
    expect(parseReplayUrl("http://127.0.0.1:4391/replay/ui.js", "http://127.0.0.1:4391")).toBeNull();
    expect(parseReplayUrl(`http://127.0.0.1:4391/replay/${id}`, undefined)).toBeNull();
    expect(parseReplayUrl("not a url", "http://127.0.0.1:4391")).toBeNull();
  });
});
