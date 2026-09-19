import { readFileSync } from "node:fs";
import { Window } from "happy-dom";
import { afterEach, describe, expect, it } from "vitest";
import { pages } from "./fixtures/serp-pages";

const serpJs = readFileSync(new URL("../page-scripts/serp.js", import.meta.url), "utf8");
const captureJs = readFileSync(new URL("../page-scripts/capture.js", import.meta.url), "utf8");
const initJs = readFileSync(new URL("../page-scripts/init.js", import.meta.url), "utf8");
const pageJs = readFileSync(new URL("../page-scripts/page.js", import.meta.url), "utf8");

let win: Window | null = null;
function load(url: string, html: string) {
  win = new Window({ url, settings: { disableJavaScriptEvaluation: false } });
  win.document.write(`<!doctype html><html><head><title>Page</title></head><body>${html}</body></html>`);
  return win;
}
const evaluate = (w: Window, js: string) => JSON.parse((w as unknown as { eval(s: string): string }).eval(js));
afterEach(async () => { await win?.happyDOM.close(); win = null; });

describe("search results extractor", () => {
  for (const [name, page] of Object.entries(pages)) {
    it(`extracts ${name} results in rank order and unwraps redirects`, () => {
      const w = load(page.url, page.html);
      const out = evaluate(w, serpJs);
      expect(out.url).toBe(page.url);
      expect(out.results.map((r: { url: string; title: string; snippet: string }) => ({ url: r.url, title: r.title, snippet: r.snippet }))).toEqual(page.expect);
      expect(out.results.map((r: { rank: number }) => r.rank)).toEqual(page.expect.map((_, i) => i + 1));
    });
  }

  it("labels how trustworthy each Google URL is when links are opaque redirects", () => {
    const w = load(pages.google2026.url, pages.google2026.html);
    const out = evaluate(w, serpJs).results;
    expect(out.map((r: { quality?: string }) => r.quality)).toEqual(["display", "truncated", "opaque"]);
    expect(out.map((r: { link?: string }) => r.link)).toEqual([
      "https://www.google.com/goto?url=CAESYgHrOz1", "https://www.google.com/goto?url=CAESaQHrOz2", "https://www.google.com/goto?url=CAESZAHrOz3",
    ]);
    const direct = evaluate(load(pages.google.url, pages.google.html), serpJs).results;
    expect(direct.every((r: { quality?: string }) => r.quality === undefined)).toBe(true);
  });

  it("flags bot checks and consent walls instead of returning nothing silently", () => {
    const w = load("https://search.brave.com/search?q=x", `<main><h1>Verifying you're not a bot</h1><p>Quick check before you continue searching.</p><button>Verify</button></main>`);
    expect(evaluate(w, serpJs)).toMatchObject({ challenge: true, results: [] });
    // Brave's check as seen in September 2026.
    const b2 = load("https://search.brave.com/search?q=x&source=web", `<main><p>Why am I seeing this?</p><button>Verify</button></main>`);
    expect(evaluate(b2, serpJs)).toMatchObject({ challenge: true, results: [] });
    const g = load("https://www.google.com/search?q=x", `<div>Our systems have detected unusual traffic from your computer network.</div>`);
    expect(evaluate(g, serpJs).challenge).toBe(true);
    expect(evaluate(load(pages.bing.url, pages.bing.html), serpJs).challenge).toBe(false);
  });

  it("never returns engine-internal, script or duplicate links", () => {
    const w = load("https://www.bing.com/search?q=x", `<ol id="b_results">
      <li class="b_algo"><h2><a href="javascript:alert(1)">Bad</a></h2></li>
      <li class="b_algo"><h2><a href="https://www.bing.com/images?q=x">Images</a></h2></li>
      <li class="b_algo"><h2><a href="https://a.example/1">A</a></h2></li>
      <li class="b_algo"><h2><a href="https://a.example/1">A again</a></h2></li></ol>`);
    expect(evaluate(w, serpJs).results.map((r: { url: string }) => r.url)).toEqual(["https://a.example/1"]);
  });
});

describe("capture script", () => {
  const article = `<article><h1>Award</h1><p id="p1">The council <em>awarded</em> the contract to Harbor Works on June 12, according to minutes.</p>
    <figure><img id="img" src="/media/award.jpg" alt="Signing" width="640" height="480"><figcaption>The signing ceremony.</figcaption></figure></article>`;
  const head = `<meta name="author" content="R. Reporter"><meta property="article:published_time" content="2026-06-13T08:00:00Z"><meta property="og:site_name" content="City Paper"><link rel="canonical" href="/story">`;

  function page() {
    const w = load("https://news.example.com/story?utm_source=x", article);
    w.document.head.insertAdjacentHTML("beforeend", head);
    return w;
  }

  it("captures the selection with its paragraph context and citation metadata", () => {
    const w = page();
    const p = w.document.getElementById("p1")!;
    const range = w.document.createRange();
    range.setStart(p.childNodes[2], 1);
    range.setEnd(p.childNodes[2], 37);
    w.getSelection()!.removeAllRanges();
    w.getSelection()!.addRange(range);
    const out = evaluate(w, `${captureJs}("selection")`);
    expect(out.error).toBeUndefined();
    expect(out.selection).toBe("the contract to Harbor Works on June");
    expect(out.context).toContain("The council awarded the contract to Harbor Works on June 12");
    expect(out.meta).toMatchObject({ author: "R. Reporter", published: "2026-06-13T08:00:00Z", siteName: "City Paper", canonical: "https://news.example.com/story" });
    expect(out.url).toBe("https://news.example.com/story?utm_source=x");
  });

  it("captures the hovered image when nothing is selected", () => {
    const w = page();
    w.eval(initJs);
    const img = w.document.getElementById("img")!;
    img.dispatchEvent(new w.MouseEvent("mouseover", { bubbles: true }));
    const out = evaluate(w, `${captureJs}("selection")`);
    expect(out.error).toBeUndefined();
    expect(out.images).toEqual([expect.objectContaining({ src: "https://news.example.com/media/award.jpg", alt: "Signing", caption: "The signing ceremony." })]);
  });

  it("explains what to do when nothing is selected or hovered", () => {
    const out = evaluate(page(), `${captureJs}("selection")`);
    expect(out.error).toMatch(/Nothing selected/);
  });

  it("captures readable page text, preferring the article", () => {
    const w = page();
    w.document.body.insertAdjacentHTML("afterbegin", "<nav>Menu Home About</nav>");
    const out = evaluate(w, `${captureJs}("page")`);
    expect(out.pageText).toContain("The council awarded the contract");
    expect(out.pageText).not.toContain("Menu Home About");
  });
});

describe("page metadata script", () => {
  it("reads declared metadata, preferring JSON-LD, and summarizes outbound links", () => {
    const w = load("https://news.example.com/2026/story?id=1", `<article><h1>Harbor Works wins contract</h1><p>One two three four five.</p>
      <a href="/local">local</a><a href="https://city.gov/minutes">m</a><a href="https://city.gov/award">a</a><a href="https://www.city.gov/award">dup host</a>
      <a href="https://registry.example.org/x">r</a><a href="https://sub.news.example.com/x">same site</a><a href="javascript:void(0)">js</a></article>`);
    w.document.documentElement.lang = "en";
    w.document.head.insertAdjacentHTML("beforeend", `<meta property="og:site_name" content="City Paper"><meta name="author" content="Meta Author">
      <meta property="og:type" content="article"><link rel="canonical" href="/2026/story">
      <script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"NewsArticle","author":[{"@type":"Person","name":"LD Author"}],"datePublished":"2026-06-13T08:00:00Z","dateModified":"2026-06-14T09:00:00Z"},{"@type":"Organization"}]}</script>
      <script type="application/ld+json">{ not json</script>`);
    const out = evaluate(w, pageJs);
    expect(out).toMatchObject({
      heading: "Harbor Works wins contract", canonical: "https://news.example.com/2026/story", author: "LD Author",
      published: "2026-06-13T08:00:00Z", modified: "2026-06-14T09:00:00Z", siteName: "City Paper", type: "article", lang: "en",
      schemaTypes: ["NewsArticle", "Organization"],
    });
    expect(out.links.total).toBe(6);
    expect(out.links.external).toBe(4);
    expect(out.links.domains).toEqual([{ domain: "city.gov", count: 3 }, { domain: "registry.example.org", count: 1 }]);
    expect(out.wordCount).toBeGreaterThan(5);
  });

  it("falls back to meta tags and tolerates pages with nothing declared", () => {
    const w = load("https://plain.example/", "<p>hello</p>");
    const out = evaluate(w, pageJs);
    expect(out).toMatchObject({ author: "", published: "", canonical: "", schemaTypes: [], links: { total: 0, external: 0, domains: [] } });
  });
});
