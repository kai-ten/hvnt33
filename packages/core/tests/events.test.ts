import { describe, expect, it } from "vitest";
import { allEvents, visitEvents, type Dossier, type IntakeSummary, type PageVisit, type SearchRun } from "../src/events";
import { run } from "../src/spl";

const runs: SearchRun[] = [{
  id: "r1", investigationId: "c", engine: "google", query: "harbor works", url: "https://www.google.com/search?q=harbor+works", observedAt: "2026-09-18T10:00:00Z",
  results: [
    { rank: 1, title: "Award", url: "https://www.city.gov/award/?utm_source=x", snippet: "" },
    { rank: 2, title: "Registry", url: "https://registry.example.org/harbor", snippet: "" },
    { rank: 3, title: "News", url: "https://news.example.com/harbor", snippet: "" },
  ],
}];
const intakes: IntakeSummary[] = [{ id: "i1", title: "Award", state: "captured", createdAt: "2026-09-18T11:00:00Z", sourceLabel: "city.gov", sourceUrl: "https://city.gov/award", summary: "", records: 0, connections: 0 }];
const dossier: Dossier = {
  investigation: { id: "c", title: "Case", description: "", createdAt: "" },
  records: [{ id: "r", investigationId: "c", title: "Harbor Works Ltd", kind: "Organization", status: "Unverified", sourceUrl: "http://registry.example.org/harbor#top", createdAt: "2026-09-18T12:00:00Z" }],
  connections: [],
};
const visits: PageVisit[] = [{
  id: "v1", investigationId: "c", url: "https://news.example.com/harbor", title: "News", firstVisitedAt: "2026-09-18T10:05:00Z", lastVisitedAt: "2026-09-18T10:30:00Z", visits: 3,
  found: { engine: "google", query: "harbor works" },
  meta: { author: "R. Reporter", schemaTypes: ["NewsArticle"], wordCount: 900, linksExternal: 12, topDomains: [{ domain: "city.gov", count: 3 }] },
}];

describe("research events", () => {
  it("flattens visits with the metadata the page declared", () => {
    expect(visitEvents(visits)[0]).toMatchObject({ sourcetype: "visit", domain: "news.example.com", visits: 3, engine: "google", author: "R. Reporter", page_type: "NewsArticle", links_out: 12, linked_domains: ["city.gov"] });
  });

  it("marks each observed result as captured, cited in records, or visited, by normalized URL", () => {
    const serp = allEvents(dossier, runs, intakes, visits).filter(e => e.sourcetype === "serp");
    const by = Object.fromEntries(serp.map(e => [e.title as string, [e.captured, e.in_records, e.visited]]));
    expect(by).toEqual({ Award: [true, false, false], Registry: [false, true, false], News: [false, false, true] });
  });

  it("answers the unread-leads question in the query language", () => {
    const leads = run("sourcetype=serp captured=false in_records=false visited=false", allEvents(dossier, runs, intakes, visits));
    expect(leads.rows).toEqual([]);
    const unread = run("sourcetype=serp captured=false", allEvents(dossier, runs, intakes, []));
    expect(unread.rows.map(r => r.title).sort()).toEqual(["News", "Registry"]);
  });

  it("uses a Splunk-style index field for every case event", () => {
    const all = allEvents(dossier, runs, intakes, visits);
    expect(run("search index=hvnt33", all).rows).toHaveLength(all.length);
    expect(new Set(all.map(e => e.index))).toEqual(new Set(["hvnt33"]));
  });
});

import { parseWaybackUrl } from "../src/engines";
import { snapshotEvents, type ArchiveHistory } from "../src/events";

describe("web archive", () => {
  const history: ArchiveHistory = {
    url: "https://news.example.com/harbor", source: "wayback", checkedAt: "2026-09-18T12:00:00Z", versions: 2,
    first: "2019-01-02T03:04:05Z", last: "2026-06-01T00:00:00Z", byYear: { 2019: 1, 2026: 1 }, truncated: false,
    snapshots: [
      { timestamp: "20190102030405", capturedAt: "2019-01-02T03:04:05Z", original: "https://news.example.com/harbor", status: "200", mime: "text/html", digest: "A", length: 100, snapshotUrl: "https://web.archive.org/web/20190102030405/https://news.example.com/harbor" },
      { timestamp: "20260601000000", capturedAt: "2026-06-01T00:00:00Z", original: "https://news.example.com/harbor", status: "200", mime: "text/html", digest: "B", length: 140, snapshotUrl: "https://web.archive.org/web/20260601000000/https://news.example.com/harbor" },
    ],
  };

  it("parses Wayback snapshot URLs, including modifiers and short timestamps", () => {
    expect(parseWaybackUrl("https://web.archive.org/web/20190102030405/https://news.example.com/harbor?x=1")).toEqual({ original: "https://news.example.com/harbor?x=1", timestamp: "20190102030405", capturedAt: "2019-01-02T03:04:05Z" });
    expect(parseWaybackUrl("https://web.archive.org/web/20190102id_/http://a.example/")?.capturedAt).toBe("2019-01-02T00:00:00Z");
    expect(parseWaybackUrl("https://web.archive.org/web/*/example.com")).toBeNull();
    expect(parseWaybackUrl("https://example.com/web/2019/https://x")).toBeNull();
  });

  it("turns archive history into snapshot events and annotates visited pages", () => {
    const rows = snapshotEvents([history]);
    expect(rows.map(r => [r._time, r.version, r.versions, r.bytes])).toEqual([["2019-01-02T03:04:05Z", 1, 2, 100], ["2026-06-01T00:00:00Z", 2, 2, 140]]);
    const all = allEvents(dossier, runs, intakes, visits, [history]);
    expect(all.find(e => e.sourcetype === "visit")).toMatchObject({ wayback_versions: 2, first_archived: "2019-01-02T03:04:05Z" });
    const coverage = run("sourcetype=snapshot | stats count as versions, min(_time) as first, max(_time) as last by domain", all);
    expect(coverage.rows).toEqual([{ domain: "news.example.com", versions: 2, first: "2019-01-02T03:04:05Z", last: "2026-06-01T00:00:00Z" }]);
  });
});

import type { OwnSnapshot, PageChange } from "../src/events";

describe("own archive", () => {
  const snap = (id: string, capturedAt: string, changed: boolean | null): OwnSnapshot => ({
    id, investigationId: "i", url: "https://harbor.example/board", finalUrl: "https://harbor.example/board", status: 200, title: "Board",
    method: "browsertrix", capturedAt, trigger: "watch", changed, changeId: "", previousId: "", textLines: 12, notes: [],
    timestamps: [{ tsa: "http://timestamp.digicert.com", genTime: capturedAt }], timestampErrors: [], files: { wacz: { sha256: "a", size: 5000 } },
  });
  const change: PageChange = {
    id: "c1", investigationId: "i", url: "https://harbor.example/board", title: "Board", fromSnapshotId: "s1", toSnapshotId: "s2",
    fromAt: "2026-09-01T00:00:00Z", toAt: "2026-09-02T00:00:00Z", added: 2, removed: 1, similarity: 0.8,
    addedLines: ["Ann Cole, treasurer"], removedLines: ["Tom Reed, treasurer"], seen: false, detectedAt: "2026-09-02T00:00:01Z",
  };

  it("lists hvnt33 snapshots and changes alongside Wayback captures, searchable by what changed", () => {
    const all = allEvents(dossier, runs, intakes, visits, [], { snapshots: [snap("s1", "2026-09-01T00:00:00Z", null), snap("s2", "2026-09-02T00:00:00Z", true)], changes: [change] });
    const own = run("sourcetype=snapshot archive=hvnt33 | table _time changed timestamps tsa", all);
    expect(own.rows).toEqual([
      { _time: "2026-09-02T00:00:00Z", changed: true, timestamps: 1, tsa: ["timestamp.digicert.com"] },
      { _time: "2026-09-01T00:00:00Z", changed: "first", timestamps: 1, tsa: ["timestamp.digicert.com"] },
    ]);
    const who = run('sourcetype=change removed_text="*Tom Reed*" | table domain added removed', all);
    expect(who.rows).toEqual([{ domain: "harbor.example", added: 2, removed: 1 }]);
  });
});
