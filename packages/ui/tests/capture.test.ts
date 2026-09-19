import { describe, expect, it } from "vitest";
import { agentInstruction, buildCapture, captureKind, captureReference, searchContextFrom, sourceLabel, terminalPath, terminalSafe } from "../src/lib/capture";
import { allEvents, captureEvents, recordEvents, serpEvents, type SearchRun } from "@hvnt33/core/events";
import type { PageCapture } from "../src/lib/native";

const page = (over: Partial<PageCapture> = {}): PageCapture => ({
  mode: "selection",
  url: "https://news.example.com/story",
  title: "Harbor Works wins city contract",
  selection: "The council awarded the contract to Harbor Works on June 12.",
  context: "Minutes show the council awarded the contract to Harbor Works on June 12. Two members abstained.",
  pageText: "",
  images: [],
  meta: { description: "", author: "R. Reporter", published: "2026-06-13T08:00:00Z", siteName: "City Paper", canonical: "", lang: "en" },
  ...over,
});

describe("capture requests", () => {
  it("keeps the exact selection as the source text and context as metadata", () => {
    const req = buildCapture(page(), { investigationId: "case-1", note: "  connect to the procurement thread ", searchContext: { engine: "google", query: "harbor works" } });
    expect(req.text).toBe("The council awarded the contract to Harbor Works on June 12.");
    expect(req.title).toBe("The council awarded the contract to Harbor Works on June 12.");
    expect(req.researcherNote).toBe("connect to the procurement thread");
    expect(req.contentOrigin).toBe("source-text");
    expect(req.captureMeta).toMatchObject({ mode: "selection", context: expect.stringContaining("Two members abstained"), engine: "google", query: "harbor works", author: "R. Reporter" });
    expect(req.imageUrl).toBeNull();
    expect(req.sourceLabel).toBe("City Paper — Harbor Works wins city contract — (R. Reporter, 2026-06-13)");
  });

  it("titles short selections with the page title", () => {
    expect(buildCapture(page({ selection: "Harbor Works" }), { investigationId: "c", note: "" }).title).toBe("Harbor Works — Harbor Works wins city contract");
  });

  it("captures an image with its alt text and caption and asks for the original", () => {
    const img = { src: "https://cdn.example.com/signing.jpg", alt: "Signing", caption: "The signing ceremony.", width: 800, height: 600 };
    const c = page({ selection: "", context: "The signing ceremony.", images: [img] });
    expect(captureKind(c)).toBe("image");
    const req = buildCapture(c, { investigationId: "c", note: "" });
    expect(req.imageUrl).toBe(img.src);
    expect(req.text).toBe("Alt text: Signing\nCaption: The signing ceremony.");
    expect(req.title).toBe("Image: The signing ceremony.");
    expect(req.captureMeta.imageUrl).toBe(img.src);
  });

  it("captures whole pages as their readable text", () => {
    const req = buildCapture(page({ mode: "page", selection: "", pageText: "Full article text." }), { investigationId: "c", note: "" });
    expect(req.text).toBe("Full article text.");
    expect(req.title).toBe("Harbor Works wins city contract");
    expect(req.captureMeta.mode).toBe("page");
  });

  it("falls back to the domain when a site has no name", () => {
    expect(sourceLabel(page({ meta: { ...page().meta, siteName: "", author: "", published: "" } }))).toBe("news.example.com — Harbor Works wins city contract");
  });

  it("links a page to the search that found it", () => {
    expect(searchContextFrom("https://www.bing.com/search?q=harbor+works")).toEqual({ engine: "bing", query: "harbor works" });
    expect(searchContextFrom("https://example.com/")).toBeNull();
    expect(searchContextFrom(undefined)).toBeNull();
  });
});

describe("agent instruction", () => {
  it("references captures by ID and never includes page content", () => {
    const msg = agentInstruction([{ intakeId: "0f8e-11aa", kind: "selection" }], { id: "case-9", title: 'Port "deal"\n`rm -rf ~` $(x)' });
    expect(msg).toContain("0f8e-11aa");
    expect(msg).toContain("npm run research -- show --intake");
    expect(msg).not.toMatch(/[\n\r`$]/);
    expect(msg).toContain('case "Port deal rm -rf ~ (x)" (case-9)');
  });

  it("rejects anything that is not an ID", () => {
    expect(() => agentInstruction([{ intakeId: "x; rm -rf /", kind: "page" }], { id: "c", title: "t" })).toThrow();
    expect(() => agentInstruction([], { id: "c", title: "t" })).toThrow();
    expect(() => agentInstruction([{ intakeId: "a", kind: "page" }], { id: "c c", title: "t" })).toThrow();
  });

  it("strips control characters, including escape sequences, from titles", () => {
    expect(terminalSafe("a[31mred b")).toBe("a [31mred b");
    expect(terminalSafe("x".repeat(200)).length).toBe(80);
  });
});

describe("events", () => {
  it("flattens runs, captures and records into queryable events, newest first", () => {
    const runs: SearchRun[] = [{ id: "r1", investigationId: "c", engine: "google", query: "q", url: "https://www.google.com/search?q=q", observedAt: "2026-09-18T10:00:00Z", results: [{ rank: 1, title: "A", url: "https://www.city.gov/a/?utm_source=x", snippet: "s" }] }];
    const s = serpEvents(runs);
    expect(s[0]).toMatchObject({ sourcetype: "serp", domain: "city.gov", tld: "gov", url_key: "https://city.gov/a", run: "r1" });
    const caps = captureEvents([{ id: "i1", title: "T", state: "filed", createdAt: "2026-09-18T12:00:00Z", sourceLabel: "L", sourceUrl: "https://city.gov/a", summary: "", records: 3, connections: 1, captureMeta: { mode: "image" } }]);
    expect(caps[0]).toMatchObject({ sourcetype: "capture", domain: "city.gov", mode: "image", records: 3 });
    const d = { investigation: { id: "c", title: "", description: "", createdAt: "" }, records: [{ id: "p", investigationId: "c", title: "Jane", kind: "Person", status: "Unverified", tags: "a, b", createdAt: "2026-09-18T11:00:00Z" }, { id: "o", investigationId: "c", title: "Harbor", kind: "Organization", status: "Unverified", createdAt: "2026-09-18T11:00:00Z" }], connections: [{ id: "e", investigationId: "c", fromId: "p", toId: "o", label: "awarded", status: "Unverified", createdAt: "2026-09-18T11:30:00Z" }] };
    const r = recordEvents(d);
    expect(r.find(e => e.sourcetype === "record")!.tags).toEqual(["a", "b"]);
    expect(r.find(e => e.sourcetype === "connection")).toMatchObject({ from: "Jane", label: "awarded", to: "Harbor" });
    expect(allEvents(d, runs, []).map(e => e.sourcetype)).toEqual(["connection", "record", "record", "serp"]);
  });
});

describe("capture into the agent's message", () => {
  it("is a reference only: the capture's id, kind and site, never page content", () => {
    expect(captureReference("0f1e2d3c-aaaa-bbbb-cccc-000011112222", "selection", "https://www.kkr.com/about/history?x=1"))
      .toBe("[hvnt33 capture 0f1e2d3c-aaaa-bbbb-cccc-000011112222: selection from kkr.com] ");
    expect(captureReference("abc-1", "page", "not a url")).toBe("[hvnt33 capture abc-1: page] ");
    expect(() => captureReference("id; rm -rf /", "page", "https://example.org/")).toThrow();
    // A hostname cannot smuggle control characters or quotes into the terminal.
    expect(captureReference("abc-1", "image", "https://evil.example/\u001b[2J")).not.toMatch(/[\u0000-\u001f"'`$]/);
  });

  it("dropped file paths are escaped for a shell, or quoted on Windows", () => {
    expect(terminalPath("/Users/me/Case files/photo (1).jpg", false)).toBe("/Users/me/Case\\ files/photo\\ \\(1\\).jpg");
    expect(terminalPath("/tmp/it's here.pdf", false)).toBe("/tmp/it\\'s\\ here.pdf");
    expect(terminalPath("C:\\Users\\me\\Case files\\photo.jpg", true)).toBe('"C:\\Users\\me\\Case files\\photo.jpg"');
    expect(terminalPath("/tmp/a\nb", false)).toBe("/tmp/ab");
  });
});
