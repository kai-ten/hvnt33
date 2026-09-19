import { describe, expect, it } from "vitest";
import { QueryError, facets, histogram, quoteValue, run, type Row } from "../src/spl";

const serp = (engine: string, rank: number, url: string, extra: Row = {}): Row => ({
  _time: "2026-09-18T10:00:00.000Z", sourcetype: "serp", engine, query: "harbor works", rank,
  title: `Result ${url}`, url, url_key: url, domain: new URL(url).hostname, run: `${engine}-1`, ...extra,
});

const events: Row[] = [
  serp("google", 1, "https://city.gov/award"),
  serp("google", 2, "https://news.example.com/harbor"),
  serp("google", 3, "https://blog.example.net/rumor"),
  serp("bing", 1, "https://news.example.com/harbor"),
  serp("bing", 2, "https://city.gov/award"),
  serp("duckduckgo", 1, "https://city.gov/award"),
  { _time: "2026-09-18T11:00:00.000Z", sourcetype: "record", kind: "Person", status: "Unverified", title: "Jane Vale", tags: ["procurement", "council"], url: "" },
  { _time: "2026-09-18T11:05:00.000Z", sourcetype: "record", kind: "Claim", status: "Disputed", title: "Contract award to Harbor Works", tags: [], url: "https://city.gov/award" },
];

describe("search expressions", () => {
  it("matches free text case-insensitively across fields with implicit AND", () => {
    expect(run("jane", events).rows).toHaveLength(1);
    expect(run("HARBOR works", events).rows).toHaveLength(7);
    expect(run('"contract award"', events).rows.map(r => r.title)).toEqual(["Contract award to Harbor Works"]);
  });

  it("supports field comparisons, wildcards, NOT, OR and parentheses", () => {
    expect(run("domain=*.gov", events).rows).toHaveLength(3);
    expect(run("sourcetype=serp engine!=google", events).rows).toHaveLength(3);
    expect(run("sourcetype=serp rank<=1", events).rows).toHaveLength(3);
    expect(run("NOT sourcetype=serp", events).rows).toHaveLength(2);
    expect(run("kind=person OR kind=claim", events).rows).toHaveLength(2);
    expect(run("(engine=bing OR engine=duckduckgo) domain=city.gov", events).rows).toHaveLength(2);
    expect(run("tags=council", events).rows).toHaveLength(1);
    expect(run("vale*", events).rows).toHaveLength(1);
  });

  it("treats rank numerically, not lexically", () => {
    const rows: Row[] = [{ rank: 9 }, { rank: 10 }, { rank: 2 }];
    expect(run("rank>5", rows).rows).toHaveLength(2);
    expect(run("| sort rank", rows).rows.map(r => r.rank)).toEqual([2, 9, 10]);
    expect(run("| sort -rank", rows).rows.map(r => r.rank)).toEqual([10, 9, 2]);
  });

  it("reports readable errors", () => {
    expect(() => run('"unterminated', events)).toThrow(QueryError);
    expect(() => run("| explode", events)).toThrow(/Unknown command "explode"/);
    expect(() => run("(a", events)).toThrow(/Missing \)/);
    expect(() => run("| stats avg", events)).toThrow(/needs a field/);
    expect(() => run("| top", events)).toThrow(/needs a field/);
  });
});

describe("pipeline commands", () => {
  it("stats count/dc/values by field", () => {
    const r = run("sourcetype=serp | stats count, dc(engine) as engines, values(engine) by domain | sort -count", events);
    expect(r.transformed).toBe(true);
    expect(r.columns).toEqual(["domain", "count", "engines", "values(engine)"]);
    expect(r.rows[0]).toEqual({ domain: "city.gov", count: 3, engines: 3, "values(engine)": ["bing", "duckduckgo", "google"] });
  });

  it("stats without by aggregates everything", () => {
    expect(run("sourcetype=serp | stats count min(rank) max(rank) avg(rank)", events).rows).toEqual([{ count: 6, "min(rank)": 1, "max(rank)": 3, "avg(rank)": 1.67 }]);
  });

  it("dedup, head, tail, table, rename", () => {
    expect(run("sourcetype=serp | dedup url", events).rows).toHaveLength(3);
    expect(run("sourcetype=serp | head 2", events).rows).toHaveLength(2);
    expect(run("sourcetype=serp | tail 1", events).rows[0].engine).toBe("duckduckgo");
    const t = run("sourcetype=serp | table engine rank | rename rank as position", events);
    expect(t.columns).toEqual(["engine", "position"]);
    expect(t.rows[0]).toEqual({ engine: "google", position: 1 });
  });

  it("top and rare compute counts and percentages", () => {
    const t = run("sourcetype=serp | top limit=2 domain", events);
    expect(t.rows).toEqual([{ domain: "city.gov", count: 3, percent: 50 }, { domain: "news.example.com", count: 2, percent: 33.33 }]);
    expect(run("sourcetype=serp | rare 1 domain", events).rows[0].domain).toBe("blog.example.net");
  });

  it("where filters after a transform", () => {
    expect(run("sourcetype=serp | stats count by domain | where count>=2", events).rows).toHaveLength(2);
  });

  it("timechart makes continuous SPL time buckets and can split by a field", () => {
    const later = serp("bing", 4, "https://later.example/a", { _time: "2026-09-18T11:00:00.000Z" });
    const chart = run("sourcetype=serp | timechart span=30m count by engine", [...events, later]);
    expect(chart.columns).toEqual(["_time", "bing", "duckduckgo", "google"]);
    expect(chart.rows).toHaveLength(3);
    expect(chart.rows.map(r => [r.bing, r.duckduckgo, r.google])).toEqual([[2, 1, 3], [0, 0, 0], [1, 0, 0]]);
  });

  it("compare lines up each URL's rank across engines", () => {
    const c = run("| compare", events);
    expect(c.columns).toEqual(["title", "domain", "engine_count", "best_rank", "bing", "duckduckgo", "google", "first_seen", "last_seen", "url"]);
    expect(c.rows[0]).toMatchObject({ url: "https://city.gov/award", engine_count: 3, best_rank: 1, google: 1, bing: 2, duckduckgo: 1 });
    expect(c.rows.at(-1)).toMatchObject({ url: "https://blog.example.net/rumor", engine_count: 1 });
  });

  it("changes reports new, dropped and moved results between the two latest runs", () => {
    const later = "2026-09-19T10:00:00.000Z";
    const rerun: Row[] = [
      serp("google", 1, "https://news.example.com/harbor", { _time: later, run: "google-2" }),
      serp("google", 2, "https://city.gov/award", { _time: later, run: "google-2" }),
      serp("google", 3, "https://leak.example.org/docs", { _time: later, run: "google-2" }),
    ];
    const c = run("engine=google | changes", [...events, ...rerun]);
    const by = Object.fromEntries(c.rows.map(r => [r.url as string, r.change]));
    expect(by).toEqual({
      "https://leak.example.org/docs": "new",
      "https://blog.example.net/rumor": "dropped",
      "https://news.example.com/harbor": "up",
      "https://city.gov/award": "down",
    });
    expect(c.rows[0].change).toBe("new");
  });
});

describe("facets and histogram", () => {
  it("counts values including multi-valued fields", () => {
    const f = facets(events, ["engine", "tags", "missing"]);
    expect(f.map(x => x.field)).toEqual(["engine", "tags"]);
    expect(f[0].values[0]).toEqual({ value: "google", count: 3 });
    expect(f[1].distinct).toBe(2);
  });

  it("buckets event times", () => {
    const h = histogram([...events, { _time: "2026-09-18T11:00:00.000Z" }], 4);
    expect(h).toHaveLength(4);
    expect(h.reduce((a, b) => a + b.count, 0)).toBe(events.length + 1);
    expect(histogram(events.slice(0, 6), 4)).toEqual([{ start: Date.parse("2026-09-18T10:00:00.000Z"), end: Date.parse("2026-09-18T10:00:00.000Z"), count: 6 }]);
    expect(histogram([], 4)).toEqual([]);
  });

  it("quotes values safely for click-to-filter", () => {
    expect(quoteValue("city.gov")).toBe("city.gov");
    expect(quoteValue('two words "quoted"')).toBe('"two words \\"quoted\\""');
    expect(run(`title=${quoteValue("Jane Vale")}`, events).rows).toHaveLength(1);
  });
});
