// Evaluated in a browsed page after it loads. Reads the page's declared
// metadata and link structure and returns it as a JSON string, for the data
// panel and visit records. Read-only: no network requests, no page changes.
(function () {
  "use strict";
  function clean(s) { return String(s || "").replace(/\s+/g, " ").trim(); }
  function meta(names) {
    for (var i = 0; i < names.length; i++) {
      var el = document.querySelector('meta[name="' + names[i] + '" i], meta[property="' + names[i] + '" i], meta[itemprop="' + names[i] + '" i]');
      if (el && el.getAttribute("content")) return clean(el.getAttribute("content")).slice(0, 500);
    }
    return "";
  }
  function abs(href) { try { var u = new URL(href, document.baseURI); return /^https?:$/.test(u.protocol) ? u.href : ""; } catch (e) { return ""; } }
  function host(href) { try { return new URL(href).hostname.toLowerCase().replace(/^www\./, ""); } catch (e) { return ""; } }

  // JSON-LD often carries the most reliable author/date/type information.
  var ld = { types: [], author: "", published: "", modified: "" };
  var blocks = document.querySelectorAll('script[type="application/ld+json"]');
  for (var b = 0; b < blocks.length && b < 20; b++) {
    var data;
    try { data = JSON.parse(blocks[b].textContent || ""); } catch (e) { continue; }
    var items = [].concat(data && data["@graph"] ? data["@graph"] : data);
    for (var k = 0; k < items.length; k++) {
      var it = items[k];
      if (!it || typeof it !== "object") continue;
      [].concat(it["@type"] || []).forEach(function (t) { if (typeof t === "string" && ld.types.indexOf(t) < 0) ld.types.push(t); });
      var a = [].concat(it.author || [])[0];
      if (!ld.author && a) ld.author = clean(typeof a === "string" ? a : a.name);
      if (!ld.published && typeof it.datePublished === "string") ld.published = it.datePublished;
      if (!ld.modified && typeof it.dateModified === "string") ld.modified = it.dateModified;
    }
  }

  var here = host(location.href);
  var anchors = document.querySelectorAll("a[href]");
  var domains = {}, total = 0, external = 0, seen = {};
  for (var i = 0; i < anchors.length && i < 5000; i++) {
    var url = abs(anchors[i].getAttribute("href"));
    if (!url || seen[url]) continue;
    seen[url] = true;
    total++;
    var h = host(url);
    if (h && h !== here && !h.endsWith("." + here) && !here.endsWith("." + h)) {
      external++;
      domains[h] = (domains[h] || 0) + 1;
    }
  }
  var topDomains = Object.keys(domains).map(function (d) { return { domain: d, count: domains[d] }; })
    .sort(function (x, y) { return y.count - x.count || (x.domain < y.domain ? -1 : 1); }).slice(0, 15);

  var root = document.querySelector("article") || document.querySelector("main, [role=main]") || document.body;
  var text = root ? (root.innerText || root.textContent || "") : "";
  var words = (text.match(/\S+/g) || []).length;
  var canonical = document.querySelector('link[rel="canonical"]');
  var h1 = document.querySelector("h1");

  return JSON.stringify({
    url: location.href,
    title: clean(document.title).slice(0, 300),
    heading: h1 ? clean(h1.innerText || h1.textContent).slice(0, 300) : "",
    canonical: canonical ? abs(canonical.getAttribute("href")) : "",
    description: meta(["description", "og:description", "twitter:description"]),
    author: ld.author || meta(["author", "article:author", "byl", "parsely-author", "sailthru.author"]),
    published: ld.published || meta(["article:published_time", "datePublished", "pubdate", "date", "dc.date", "parsely-pub-date"]),
    modified: ld.modified || meta(["article:modified_time", "dateModified", "og:updated_time", "last-modified"]),
    siteName: meta(["og:site_name", "application-name"]),
    type: meta(["og:type"]),
    schemaTypes: ld.types.slice(0, 10),
    lang: document.documentElement.lang || "",
    referrer: document.referrer || "",
    wordCount: words,
    links: { total: total, external: external, domains: topDomains },
    images: document.querySelectorAll("img").length
  });
})();
