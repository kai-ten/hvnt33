// Runs inside a search-engine results page. Reads only what is rendered on the
// page and returns a JSON string: {engine, url, title, results:[{rank,title,url,snippet}]}.
// No network requests, no page mutation. Kept dependency-free and synchronous so
// it can be evaluated with a callback and unit-tested against saved fixtures.
(function () {
  "use strict";
  var MAX = 50;
  var loc = document.location;
  var host = loc.hostname.toLowerCase();

  function text(el) {
    return el ? (el.innerText || el.textContent || "").replace(/\s+/g, " ").trim() : "";
  }

  function b64url(s) {
    s = s.replace(/-/g, "+").replace(/_/g, "/");
    while (s.length % 4) s += "=";
    try { return decodeURIComponent(escape(atob(s))); } catch (e) { return ""; }
  }

  // Resolve engine redirect wrappers to the destination URL.
  function unwrap(href) {
    var u;
    try { u = new URL(href, loc.href); } catch (e) { return ""; }
    var h = u.hostname.toLowerCase();
    if (/(^|\.)google\.[a-z.]+$/.test(h) && u.pathname === "/url") return unwrap(u.searchParams.get("q") || u.searchParams.get("url") || "");
    if (/(^|\.)bing\.com$/.test(h) && u.pathname.indexOf("/ck/a") === 0) {
      var enc = u.searchParams.get("u") || "";
      if (enc.indexOf("a1") === 0) return unwrap(b64url(enc.slice(2)));
    }
    if (/(^|\.)duckduckgo\.com$/.test(h) && u.pathname.indexOf("/l/") === 0) return unwrap(u.searchParams.get("uddg") || "");
    if (u.protocol !== "http:" && u.protocol !== "https:") return "";
    return u.href;
  }

  function isEngineHost(href) {
    try {
      var h = new URL(href).hostname.toLowerCase();
      return h === host || /(^|\.)(google|bing|duckduckgo|brave|startpage|mojeek|yandex|gstatic|googleusercontent|webcache\.googleusercontent)\./.test(h + ".") ||
        /(^|\.)(google\.[a-z.]+|bing\.com|duckduckgo\.com|search\.brave\.com|startpage\.com|mojeek\.com|yandex\.(com|ru))$/.test(h);
    } catch (e) { return true; }
  }

  // Engine-specific layouts: container, link and snippet selectors.
  var layouts = [
    { engine: "google", test: /(^|\.)google\./, item: "#search .MjjYud, #search div.g, #rso > div", link: "a:has(h3), a[jsname] h3", title: "h3", snippet: "[data-sncf], .VwiC3b, [style*='-webkit-line-clamp']" },
    { engine: "duckduckgo", test: /(^|\.)duckduckgo\.com$/, item: "article[data-testid='result'], .result.results_links, .result", link: "a[data-testid='result-title-a'], a.result__a", title: "a[data-testid='result-title-a'], a.result__a", snippet: "[data-result='snippet'], .result__snippet" },
    { engine: "bing", test: /(^|\.)bing\.com$/, item: "#b_results > li.b_algo", link: "h2 a", title: "h2", snippet: ".b_caption p, .b_lineclamp2, .b_lineclamp3, .b_lineclamp4, .b_paractl" },
    { engine: "brave", test: /(^|\.)search\.brave\.com$/, item: "#results .snippet[data-type='web'], .snippet[data-type='web']", link: "a", title: ".title, .search-snippet-title", snippet: ".snippet-description, .generic-snippet .content, .snippet-content" },
    { engine: "startpage", test: /(^|\.)startpage\.com$/, item: ".w-gl .result, .result", link: "a.result-title, a.w-gl__result-title, a.result-link", title: "h2, h3, .wgl-title", snippet: "p.description, .w-gl__description" },
    { engine: "mojeek", test: /(^|\.)mojeek\.com$/, item: "ul.results-standard > li", link: "a.title, h2 a", title: "a.title, h2", snippet: "p.s" },
    { engine: "yandex", test: /(^|\.)yandex\.(com|ru)$/, item: "li.serp-item", link: "a.OrganicTitle-Link, h2 a, a.Link", title: "h2, .OrganicTitle-LinkText", snippet: ".OrganicTextContentSpan, .TextContainer, .Organic-ContentWrapper .text-container" }
  ];

  function safeQueryAll(root, sel) {
    try { return Array.prototype.slice.call(root.querySelectorAll(sel)); } catch (e) { return []; }
  }
  function safeQuery(root, sel) {
    var parts = sel.split(",");
    for (var i = 0; i < parts.length; i++) {
      try { var el = root.querySelector(parts[i].trim()); if (el) return el; } catch (e) { /* unsupported selector */ }
    }
    return null;
  }

  // Google shows the destination only as a breadcrumb ("https://site › a › b")
  // when its links are opaque redirects. Rebuild it, noting when it was elided.
  function fromCite(item) {
    var cite = item && item.querySelector("cite");
    var t = text(cite).replace(/\s*\u203a\s*/g, "/");
    var truncated = /(\.\.\.|\u2026)$/.test(t);
    t = t.replace(/\/?(\.\.\.|\u2026)$/, "");
    if (!/^https?:\/\/[^\s/]+\.[^\s/]+/.test(t) || /\s/.test(t)) return null;
    try { return { url: new URL(t).href, quality: truncated ? "truncated" : "display" }; } catch (e) { return null; }
  }

  var results = [];
  var seen = {};
  function push(href, title, snippet, item) {
    var url = unwrap(href), quality = "exact", link = "";
    if (url && isEngineHost(url) && /^\/(goto|url)$/.test(new URL(url).pathname)) {
      // Opaque engine redirect: keep it as the clickable link.
      link = url;
      var shown = fromCite(item);
      if (shown) { url = shown.url; quality = shown.quality; } else quality = "opaque";
    }
    if (!url || !title || seen[url] || (quality !== "opaque" && isEngineHost(url))) return;
    seen[url] = true;
    var r = { rank: results.length + 1, title: title.slice(0, 300), url: url, snippet: (snippet || "").slice(0, 600) };
    if (quality !== "exact") { r.quality = quality; r.link = link; }
    results.push(r);
  }

  var layout = null;
  for (var i = 0; i < layouts.length; i++) if (layouts[i].test.test(host)) { layout = layouts[i]; break; }

  if (layout) {
    var items = safeQueryAll(document, layout.item);
    for (var j = 0; j < items.length && results.length < MAX; j++) {
      var item = items[j];
      var link = safeQuery(item, layout.link);
      if (link && link.tagName !== "A") link = link.closest("a");
      if (!link || !link.getAttribute("href")) continue;
      var titleEl = safeQuery(item, layout.title) || link;
      var snip = safeQuery(item, layout.snippet);
      push(link.getAttribute("href"), text(titleEl) || text(link), text(snip), item);
    }
  }

  // Generic fallback: external links that carry a heading, in document order.
  if (!results.length) {
    var anchors = safeQueryAll(document, "main a[href], #search a[href], #results a[href], body a[href]");
    for (var k = 0; k < anchors.length && results.length < MAX; k++) {
      var a = anchors[k];
      var heading = a.querySelector("h1,h2,h3") || a.closest("h1,h2,h3");
      if (!heading) continue;
      var block = a.closest("li, article, [data-hveid], .result, div") || a.parentElement;
      var t = text(heading);
      var s = text(block).replace(t, "").trim();
      push(a.getAttribute("href"), t, s.slice(0, 400));
    }
  }

  // Consent walls and bot checks: report them so the researcher can act.
  var head = (document.body ? document.body.innerText || "" : "").slice(0, 3000);
  var challenge = !results.length && /unusual traffic|not a (ro)?bot|verify (that )?you('| a)re (a )?human|captcha|are you a robot|press and hold|security check|why am i seeing this\?[\s\S]{0,200}\bverify\b/i.test(head + " " + document.title);

  return JSON.stringify({
    engine: layout ? layout.engine : "",
    challenge: challenge,
    url: loc.href,
    title: document.title,
    results: results
  });
})();
