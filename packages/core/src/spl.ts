// A small, Splunk-flavoured query language over the research events the app has
// collected: observed search results, captures, records and connections.
//
//   procurement domain=*.gov NOT sourcetype=record | dedup url | stats count by domain | sort -count | head 10
//
// Grammar
//   query    := search? ("|" command)*
//   search   := or-expression of terms (implicit AND); terms are words, "phrases",
//               field=value, field!=value, field>n, field<n …, NOT x, x OR y, ( … )
//   commands := search | where | dedup | sort | head | tail | table | fields |
//               stats | timechart | top | rare | rename | compare | changes
// Values support * wildcards and are case-insensitive, like Splunk.

export type Value = string | number | boolean | null | undefined | string[];
export type Row = Record<string, Value>;

export interface Result {
  rows: Row[];
  /** Column order for tabular display. */
  columns: string[];
  /** True when a transforming command (stats/top/compare…) produced the rows. */
  transformed: boolean;
}

export class QueryError extends Error {}

// ── Tokenizer ────────────────────────────────────────────────────────────────

type Tok = { t: "word" | "str" | "op" | "pipe" | "lp" | "rp" | "comma"; v: string };

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === "|") { out.push({ t: "pipe", v: c }); i++; continue; }
    if (c === "(") { out.push({ t: "lp", v: c }); i++; continue; }
    if (c === ")") { out.push({ t: "rp", v: c }); i++; continue; }
    if (c === ",") { out.push({ t: "comma", v: c }); i++; continue; }
    if (c === '"' || c === "'") {
      let j = i + 1, s = "";
      while (j < src.length && src[j] !== c) {
        if (src[j] === "\\" && j + 1 < src.length) { s += src[j + 1]; j += 2; continue; }
        s += src[j++];
      }
      if (j >= src.length) throw new QueryError("Unclosed quote");
      out.push({ t: "str", v: s });
      i = j + 1;
      continue;
    }
    const two = src.slice(i, i + 2);
    if (["!=", ">=", "<=", "=="].includes(two)) { out.push({ t: "op", v: two === "==" ? "=" : two }); i += 2; continue; }
    if (c === "=" || c === ">" || c === "<") { out.push({ t: "op", v: c }); i++; continue; }
    let j = i, w = "";
    while (j < src.length && !/[\s|()=<>,"']/.test(src[j]) && !(src[j] === "!" && src[j + 1] === "=")) w += src[j++];
    if (!w) throw new QueryError(`Unexpected character "${c}"`);
    out.push({ t: "word", v: w });
    i = j;
  }
  return out;
}

function splitPipes(toks: Tok[]): Tok[][] {
  const parts: Tok[][] = [[]];
  for (const t of toks) {
    if (t.t === "pipe") parts.push([]);
    else parts[parts.length - 1].push(t);
  }
  return parts;
}

// ── Search / where expressions ──────────────────────────────────────────────

type Expr =
  | { k: "and" | "or"; a: Expr; b: Expr }
  | { k: "not"; a: Expr }
  | { k: "term"; v: string; phrase: boolean }
  | { k: "cmp"; field: string; op: string; v: string }
  | { k: "all" };

function parseExpr(toks: Tok[]): Expr {
  let p = 0;
  const peek = () => toks[p];
  const isWord = (t: Tok | undefined, w: string) => !!t && t.t === "word" && t.v.toUpperCase() === w;

  function primary(): Expr {
    const t = peek();
    if (!t) throw new QueryError("Search expression ended early");
    if (t.t === "lp") {
      p++;
      const e = or();
      if (peek()?.t !== "rp") throw new QueryError("Missing )");
      p++;
      return e;
    }
    if (isWord(t, "NOT")) { p++; return { k: "not", a: primary() }; }
    if (t.t === "word" || t.t === "str") {
      p++;
      const next = peek();
      if (t.t === "word" && next?.t === "op") {
        p++;
        const val = peek();
        if (!val || (val.t !== "word" && val.t !== "str")) throw new QueryError(`Missing value after ${t.v}${next.v}`);
        p++;
        return { k: "cmp", field: t.v, op: next.v, v: val.v };
      }
      return { k: "term", v: t.v, phrase: t.t === "str" };
    }
    throw new QueryError(`Unexpected "${t.v}"`);
  }
  function and(): Expr {
    let e = primary();
    for (;;) {
      const t = peek();
      if (!t || t.t === "rp" || isWord(t, "OR")) return e;
      if (isWord(t, "AND")) p++;
      e = { k: "and", a: e, b: primary() };
    }
  }
  function or(): Expr {
    let e = and();
    while (isWord(peek(), "OR")) { p++; e = { k: "or", a: e, b: and() }; }
    return e;
  }
  if (!toks.length) return { k: "all" };
  const e = or();
  if (p < toks.length) throw new QueryError(`Unexpected "${toks[p].v}"`);
  return e;
}

const regexCache = new Map<string, RegExp>();
function wildcard(pattern: string): RegExp {
  let re = regexCache.get(pattern);
  if (!re) {
    re = new RegExp("^" + pattern.split("*").map(s => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*") + "$", "is");
    regexCache.set(pattern, re);
  }
  return re;
}

function asText(v: Value): string {
  if (v === null || v === undefined) return "";
  if (Array.isArray(v)) return v.join(" ");
  return String(v);
}

function raw(row: Row): string {
  let s = "";
  for (const k in row) if (!k.startsWith("_") || k === "_raw") s += " " + asText(row[k]);
  return s.toLowerCase();
}

function numeric(v: string): number | null {
  if (v.trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function compare(fieldValue: Value, op: string, target: string): boolean {
  const values = Array.isArray(fieldValue) ? fieldValue : [fieldValue];
  const test = (v: Value) => {
    const s = asText(v);
    if (op === "=") return wildcard(target).test(s);
    if (op === "!=") return !wildcard(target).test(s);
    const a = numeric(s), b = numeric(target);
    const [x, y] = a !== null && b !== null ? [a, b] : [s, target];
    if (op === ">") return x > y;
    if (op === "<") return x < y;
    if (op === ">=") return x >= y;
    if (op === "<=") return x <= y;
    return false;
  };
  if (op === "!=") return values.every(test);
  return values.some(test);
}

function evaluate(e: Expr, row: Row, text: () => string): boolean {
  switch (e.k) {
    case "all": return true;
    case "and": return evaluate(e.a, row, text) && evaluate(e.b, row, text);
    case "or": return evaluate(e.a, row, text) || evaluate(e.b, row, text);
    case "not": return !evaluate(e.a, row, text);
    case "cmp": return compare(row[e.field], e.op, e.v);
    case "term": {
      const needle = e.v.toLowerCase();
      if (!e.phrase && needle.includes("*")) return text().split(/\s+/).some(w => wildcard(needle).test(w));
      return text().includes(needle);
    }
  }
}

export function matcher(search: string): (row: Row) => boolean {
  const expr = parseExpr(tokenize(search));
  return row => {
    let cached: string | null = null;
    return evaluate(expr, row, () => (cached ??= raw(row)));
  };
}

// ── Commands ────────────────────────────────────────────────────────────────

function words(toks: Tok[]): string[] {
  return toks.filter(t => t.t !== "comma").map(t => t.v);
}

function intArg(toks: Tok[], fallback: number): number {
  const w = toks.find(t => t.t === "word" && /^\d+$/.test(t.v));
  return w ? Math.max(0, parseInt(w.v, 10)) : fallback;
}

function byClause(toks: Tok[]): { before: Tok[]; by: string[] } {
  const i = toks.findIndex(t => t.t === "word" && t.v.toLowerCase() === "by");
  if (i < 0) return { before: toks, by: [] };
  return { before: toks.slice(0, i), by: words(toks.slice(i + 1)) };
}

function columnsOf(rows: Row[]): string[] {
  const seen = new Set<string>();
  for (const r of rows.slice(0, 500)) for (const k of Object.keys(r)) if (!k.startsWith("_") || k === "_time") seen.add(k);
  return [...seen];
}

function sortRows(rows: Row[], specs: { field: string; desc: boolean }[]): Row[] {
  const cmp = (a: Value, b: Value) => {
    const sa = asText(a), sb = asText(b);
    const na = numeric(sa), nb = numeric(sb);
    if (na !== null && nb !== null) return na - nb;
    if (sa === "" && sb !== "") return 1;
    if (sb === "" && sa !== "") return -1;
    return sa.localeCompare(sb);
  };
  return [...rows].sort((a, b) => {
    for (const s of specs) {
      const c = cmp(a[s.field], b[s.field]);
      if (c) return s.desc ? -c : c;
    }
    return 0;
  });
}

type Agg = { fn: string; field: string; as: string };

function parseAggs(toks: Tok[]): Agg[] {
  const aggs: Agg[] = [];
  let i = 0;
  while (i < toks.length) {
    const t = toks[i];
    if (t.t === "comma") { i++; continue; }
    if (t.t !== "word") throw new QueryError(`Unexpected "${t.v}" in stats`);
    const fn = t.v.toLowerCase();
    let field = "";
    if (toks[i + 1]?.t === "lp") {
      field = toks[i + 2]?.v ?? "";
      if (toks[i + 3]?.t !== "rp") throw new QueryError(`Missing ) after ${fn}(`);
      i += 4;
    } else i++;
    let as = field ? `${fn}(${field})` : fn;
    if (toks[i]?.t === "word" && toks[i].v.toLowerCase() === "as") { as = toks[i + 1]?.v ?? as; i += 2; }
    if (!["count", "dc", "distinct_count", "values", "min", "max", "avg", "sum", "first", "last", "earliest", "latest"].includes(fn))
      throw new QueryError(`Unknown stats function "${fn}"`);
    if (fn !== "count" && !field) throw new QueryError(`${fn} needs a field, e.g. ${fn}(domain)`);
    aggs.push({ fn, field, as });
  }
  return aggs.length ? aggs : [{ fn: "count", field: "", as: "count" }];
}

function aggregate(rows: Row[], agg: Agg): Value {
  const vals = agg.field ? rows.flatMap(r => (Array.isArray(r[agg.field]) ? (r[agg.field] as string[]) : [r[agg.field]])).filter(v => v !== undefined && v !== null && v !== "") : [];
  const nums = vals.map(v => numeric(asText(v))).filter((n): n is number => n !== null);
  switch (agg.fn) {
    case "count": return agg.field ? vals.length : rows.length;
    case "dc": case "distinct_count": return new Set(vals.map(asText)).size;
    case "values": return [...new Set(vals.map(asText))].sort();
    case "min": return nums.length ? Math.min(...nums) : sortRows(vals.map(v => ({ v })), [{ field: "v", desc: false }])[0]?.v;
    case "max": return nums.length ? Math.max(...nums) : sortRows(vals.map(v => ({ v })), [{ field: "v", desc: true }])[0]?.v;
    case "avg": return nums.length ? Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 100) / 100 : null;
    case "sum": return nums.reduce((a, b) => a + b, 0);
    case "first": return vals[0];
    case "last": return vals[vals.length - 1];
    case "earliest": return vals.map(asText).sort()[0];
    case "latest": return vals.map(asText).sort().at(-1);
  }
  return null;
}

function groupBy(rows: Row[], by: string[]): Map<string, { key: Row; rows: Row[] }> {
  const groups = new Map<string, { key: Row; rows: Row[] }>();
  for (const r of rows) {
    if (by.some(f => r[f] === undefined || r[f] === null || r[f] === "")) continue;
    const key: Row = {};
    for (const f of by) key[f] = asText(r[f]);
    const id = JSON.stringify(by.map(f => key[f]));
    let g = groups.get(id);
    if (!g) groups.set(id, (g = { key, rows: [] }));
    g.rows.push(r);
  }
  if (!by.length) groups.set("[]", { key: {}, rows });
  return groups;
}

function stats(rows: Row[], toks: Tok[]): Result {
  const { before, by } = byClause(toks);
  const aggs = parseAggs(before);
  const out: Row[] = [];
  for (const g of groupBy(rows, by).values()) {
    const r: Row = { ...g.key };
    for (const a of aggs) r[a.as] = aggregate(g.rows, a);
    out.push(r);
  }
  return { rows: out, columns: [...by, ...aggs.map(a => a.as)], transformed: true };
}

function top(rows: Row[], toks: Tok[], rare: boolean): Result {
  let limit = 10;
  const rest = [...toks];
  const li = rest.findIndex((t, i) => t.t === "word" && t.v.toLowerCase() === "limit" && rest[i + 1]?.v === "=");
  if (li >= 0) {
    limit = parseInt(rest[li + 2]?.v ?? "", 10);
    if (!Number.isFinite(limit)) throw new QueryError("limit needs a number, e.g. limit=5");
    rest.splice(li, 3);
  }
  if (rest[0]?.t === "word" && /^\d+$/.test(rest[0].v)) { limit = parseInt(rest[0].v, 10); rest.shift(); }
  const { before, by } = byClause(rest);
  const fields = words(before);
  if (!fields.length) throw new QueryError(`${rare ? "rare" : "top"} needs a field, e.g. top domain`);
  const total = rows.length || 1;
  const counts = [...groupBy(rows, [...by, ...fields]).values()].map(g => ({ ...g.key, count: g.rows.length, percent: Math.round((g.rows.length / total) * 10000) / 100 }) as Row);
  const sorted = sortRows(counts, [{ field: "count", desc: !rare }]);
  return { rows: sorted.slice(0, limit), columns: [...by, ...fields, "count", "percent"], transformed: true };
}

const SPANS: Record<string, number> = { s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000 };

function niceSpan(ms: number): number {
  const choices = [60_000, 5 * 60_000, 15 * 60_000, 3_600_000, 6 * 3_600_000, 86_400_000, 7 * 86_400_000, 30 * 86_400_000, 365 * 86_400_000];
  return choices.find(x => x >= ms) ?? choices.at(-1)!;
}

/** SPL-style timechart: one time bucket per row, optionally split into a column per field value. */
function timechart(rows: Row[], toks: Tok[]): Result {
  const args = [...toks];
  let span = 0;
  const spanAt = args.findIndex((t, i) => t.t === "word" && t.v.toLowerCase() === "span" && args[i + 1]?.v === "=");
  if (spanAt >= 0) {
    const rawSpan = args[spanAt + 2]?.v ?? "";
    const match = /^(\d+)([smhdw])$/i.exec(rawSpan);
    if (!match || Number(match[1]) < 1) throw new QueryError("timechart span uses values such as span=15m, span=1h, or span=1d");
    span = Number(match[1]) * SPANS[match[2].toLowerCase()];
    args.splice(spanAt, 3);
  }
  const { before, by } = byClause(args);
  if (by.length > 1) throw new QueryError("timechart supports one split field after by");
  const aggs = parseAggs(before);
  const timed = rows.map(row => ({ row, time: Date.parse(asText(row._time)) })).filter(x => Number.isFinite(x.time));
  if (!timed.length) return { rows: [], columns: ["_time", ...aggs.map(a => a.as)], transformed: true };
  const first = Math.min(...timed.map(x => x.time)), last = Math.max(...timed.map(x => x.time));
  span ||= niceSpan(Math.max(1, last - first) / 30);
  const start = Math.floor(first / span) * span;
  const count = Math.max(1, Math.floor((last - start) / span) + 1);
  const buckets = Array.from({ length: count }, (_, i) => ({ at: start + i * span, rows: [] as Row[] }));
  for (const item of timed) buckets[Math.min(buckets.length - 1, Math.floor((item.time - start) / span))].rows.push(item.row);
  const split = by[0];
  const series = split ? [...new Set(timed.flatMap(x => Array.isArray(x.row[split]) ? x.row[split] as string[] : [asText(x.row[split])]).filter(Boolean))].sort() : [];
  const column = (value: string, agg: Agg) => aggs.length === 1 && agg.fn === "count" ? value : `${value}:${agg.as}`;
  const out = buckets.map(bucket => {
    const result: Row = { _time: new Date(bucket.at).toISOString() };
    if (!split) for (const agg of aggs) result[agg.as] = aggregate(bucket.rows, agg);
    else for (const value of series) {
      const matching = bucket.rows.filter(row => (Array.isArray(row[split]) ? row[split] as string[] : [asText(row[split])]).includes(value));
      for (const agg of aggs) result[column(value, agg)] = aggregate(matching, agg);
    }
    return result;
  });
  return { rows: out, columns: ["_time", ...(split ? series.flatMap(value => aggs.map(agg => column(value, agg))) : aggs.map(a => a.as))], transformed: true };
}

/** One row per URL with each engine's best observed rank: the cross-engine view. */
function compareEngines(rows: Row[]): Result {
  const serp = rows.filter(r => r.sourcetype === "serp" && r.url);
  const engines = [...new Set(serp.map(r => asText(r.engine)))].sort();
  const byUrl = new Map<string, Row>();
  for (const r of serp) {
    const key = asText(r.url_key || r.url);
    let row = byUrl.get(key);
    if (!row) byUrl.set(key, (row = { url: r.url, title: r.title, domain: r.domain, first_seen: r._time, last_seen: r._time, engines: [] as string[] }));
    const observed = asText(r._time);
    if (observed && observed < asText(row.first_seen)) row.first_seen = observed;
    if (observed && observed > asText(row.last_seen)) row.last_seen = observed;
    const e = asText(r.engine);
    const rank = Number(r.rank);
    const prev = row[e] as number | undefined;
    if (prev === undefined || rank < prev) row[e] = rank;
    if (!(row.engines as string[]).includes(e)) (row.engines as string[]).push(e);
  }
  const out = [...byUrl.values()].map(r => {
    const ranks = engines.map(e => r[e]).filter((v): v is number => typeof v === "number");
    return { ...r, engines: (r.engines as string[]).sort(), engine_count: (r.engines as string[]).length, best_rank: Math.min(...ranks) } as Row;
  });
  return {
    rows: sortRows(out, [{ field: "engine_count", desc: true }, { field: "best_rank", desc: false }]),
    columns: ["title", "domain", "engine_count", "best_rank", ...engines, "first_seen", "last_seen", "url"],
    transformed: true,
  };
}

/** Compare the latest observed run of each engine+query with the previous one. */
function changes(rows: Row[]): Result {
  const serp = rows.filter(r => r.sourcetype === "serp");
  const runs = new Map<string, Map<string, Row[]>>();
  for (const r of serp) {
    const series = `${asText(r.engine)} ${asText(r.query).toLowerCase()}`;
    let byRun = runs.get(series);
    if (!byRun) runs.set(series, (byRun = new Map()));
    const id = asText(r.run);
    if (!byRun.has(id)) byRun.set(id, []);
    byRun.get(id)!.push(r);
  }
  const out: Row[] = [];
  for (const byRun of runs.values()) {
    const ordered = [...byRun.values()].sort((a, b) => asText(a[0]._time).localeCompare(asText(b[0]._time)));
    if (ordered.length < 2) continue;
    const [prev, latest] = ordered.slice(-2);
    const key = (r: Row) => asText(r.url_key || r.url);
    const before = new Map(prev.map(r => [key(r), r]));
    const after = new Map(latest.map(r => [key(r), r]));
    const base = { engine: latest[0].engine, query: latest[0].query, previous_run: prev[0]._time, latest_run: latest[0]._time };
    for (const [k, r] of after) {
      const old = before.get(k);
      const was = old ? Number(old.rank) : null, now = Number(r.rank);
      const change = !old ? "new" : was! > now ? "up" : was! < now ? "down" : "same";
      out.push({ ...base, change, title: r.title, domain: r.domain, rank: now, previous_rank: was, url: r.url });
    }
    for (const [k, r] of before) if (!after.has(k)) out.push({ ...base, change: "dropped", title: r.title, domain: r.domain, rank: null, previous_rank: Number(r.rank), url: r.url });
  }
  const order: Record<string, number> = { new: 0, dropped: 1, up: 2, down: 3, same: 4 };
  out.sort((a, b) => order[asText(a.change)] - order[asText(b.change)] || Number(a.rank ?? 999) - Number(b.rank ?? 999));
  return { rows: out, columns: ["change", "engine", "query", "rank", "previous_rank", "title", "domain", "url"], transformed: true };
}

export const COMMANDS = ["search", "where", "dedup", "sort", "head", "tail", "table", "fields", "stats", "timechart", "top", "rare", "rename", "compare", "changes"] as const;

export function run(query: string, events: Row[]): Result {
  const parts = splitPipes(tokenize(query));
  let rows = events;
  let columns: string[] | null = null;
  let transformed = false;

  parts.forEach((toks, index) => {
    if (index === 0) {
      // The first segment is an implicit search unless it names a command.
      if (toks[0]?.t === "word" && toks[0].v.toLowerCase() === "search") toks = toks.slice(1);
      const e = parseExpr(toks);
      rows = rows.filter(r => { let c: string | null = null; return evaluate(e, r, () => (c ??= raw(r))); });
      return;
    }
    if (!toks.length) throw new QueryError("Empty command after |");
    const name = toks[0].v.toLowerCase();
    const args = toks.slice(1);
    switch (name) {
      case "search":
      case "where": {
        const e = parseExpr(args);
        rows = rows.filter(r => { let c: string | null = null; return evaluate(e, r, () => (c ??= raw(r))); });
        break;
      }
      case "dedup": {
        const fields = words(args).filter(w => !/^\d+$/.test(w));
        if (!fields.length) throw new QueryError("dedup needs a field, e.g. dedup url");
        const seen = new Set<string>();
        rows = rows.filter(r => {
          const k = JSON.stringify(fields.map(f => asText(f === "url" && r.url_key ? r.url_key : r[f])));
          if (seen.has(k)) return false;
          seen.add(k);
          return true;
        });
        break;
      }
      case "sort": {
        const specs = words(args).filter(w => !/^\d+$/.test(w)).map(w => ({ field: w.replace(/^[-+]/, ""), desc: w.startsWith("-") }));
        if (!specs.length) throw new QueryError("sort needs a field, e.g. sort -count");
        rows = sortRows(rows, specs);
        const n = intArg(args.filter(t => /^\d+$/.test(t.v)), 0);
        if (n) rows = rows.slice(0, n);
        break;
      }
      case "head": rows = rows.slice(0, intArg(args, 10)); break;
      case "tail": rows = rows.slice(-intArg(args, 10) || rows.length); break;
      case "table":
      case "fields": {
        const list = words(args);
        const remove = list[0] === "-";
        const f = remove ? list.slice(1) : list.filter(w => w !== "+");
        if (!f.length) throw new QueryError(`${name} needs field names`);
        if (remove) {
          rows = rows.map(r => Object.fromEntries(Object.entries(r).filter(([k]) => !f.includes(k))));
          columns = (columns ?? columnsOf(rows)).filter(c => !f.includes(c));
        } else {
          const keep = (k: string) => f.some(p => wildcard(p).test(k));
          rows = rows.map(r => Object.fromEntries(Object.entries(r).filter(([k]) => keep(k) || (name === "fields" && k.startsWith("_")))));
          columns = f.flatMap(p => (p.includes("*") ? columnsOf(rows).filter(c => wildcard(p).test(c)) : [p]));
        }
        break;
      }
      case "rename": {
        const list = words(args);
        const pairs: [string, string][] = [];
        for (let i = 0; i < list.length; i += 3) {
          if (list[i + 1]?.toLowerCase() !== "as" || !list[i + 2]) throw new QueryError("rename uses: rename field AS newname");
          pairs.push([list[i], list[i + 2]]);
        }
        rows = rows.map(r => {
          const o: Row = { ...r };
          for (const [a, b] of pairs) if (a in o) { o[b] = o[a]; delete o[a]; }
          return o;
        });
        if (columns) columns = columns.map(c => pairs.find(p => p[0] === c)?.[1] ?? c);
        break;
      }
      case "stats": { const r = stats(rows, args); rows = r.rows; columns = r.columns; transformed = true; break; }
      case "timechart": { const r = timechart(rows, args); rows = r.rows; columns = r.columns; transformed = true; break; }
      case "top":
      case "rare": { const r = top(rows, args, name === "rare"); rows = r.rows; columns = r.columns; transformed = true; break; }
      case "compare": { const r = compareEngines(rows); rows = r.rows; columns = r.columns; transformed = true; break; }
      case "changes": { const r = changes(rows); rows = r.rows; columns = r.columns; transformed = true; break; }
      default:
        throw new QueryError(`Unknown command "${name}". Try: ${COMMANDS.join(", ")}`);
    }
  });

  return { rows, columns: columns ?? columnsOf(rows), transformed };
}

/** Value counts for the most useful fields: the facet sidebar. */
export function facets(rows: Row[], fields: string[], limit = 8): { field: string; values: { value: string; count: number }[]; distinct: number }[] {
  return fields.map(field => {
    const counts = new Map<string, number>();
    for (const r of rows) {
      const v = r[field];
      for (const x of Array.isArray(v) ? v : [v]) {
        const s = asText(x);
        if (s) counts.set(s, (counts.get(s) ?? 0) + 1);
      }
    }
    const values = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, limit).map(([value, count]) => ({ value, count }));
    return { field, values, distinct: counts.size };
  }).filter(f => f.values.length);
}

/** Bucket events by time for the histogram above the results. */
export function histogram(rows: Row[], buckets = 40): { start: number; end: number; count: number }[] {
  const times = rows.map(r => Date.parse(asText(r._time))).filter(Number.isFinite);
  if (!times.length) return [];
  const min = Math.min(...times), max = Math.max(...times);
  if (max === min) return [{ start: min, end: max, count: times.length }];
  const span = Math.max(max - min, 60_000);
  const size = span / buckets;
  const out = Array.from({ length: buckets }, (_, i) => ({ start: min + i * size, end: min + (i + 1) * size, count: 0 }));
  for (const t of times) out[Math.min(buckets - 1, Math.floor((t - min) / size))].count++;
  return out;
}

/** Quote a value for insertion into a query (used by click-to-filter). */
export function quoteValue(v: string): string {
  return /^[\w.:/@*-]+$/.test(v) ? v : JSON.stringify(v);
}
