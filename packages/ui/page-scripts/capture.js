// Evaluated inside a browsed page when the researcher captures. Reads the
// selection (or the hovered image, or the readable page text) plus citation
// metadata and returns it as a JSON string. Does not modify the page.
(function (mode) {
  "use strict";
  var MAX_TEXT = 60000;
  function clean(s) { return String(s || "").replace(/ /g, " ").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim(); }
  function meta(names) {
    for (var i = 0; i < names.length; i++) {
      var el = document.querySelector('meta[name="' + names[i] + '"], meta[property="' + names[i] + '"], meta[itemprop="' + names[i] + '"]');
      if (el && el.getAttribute("content")) return el.getAttribute("content").trim().slice(0, 500);
    }
    return "";
  }
  function abs(src) { try { var u = new URL(src, document.baseURI); return /^https?:$/.test(u.protocol) ? u.href : ""; } catch (e) { return ""; } }
  function image(el) {
    if (!el) return null;
    var src = abs(el.currentSrc || el.src || el.getAttribute("poster") || "");
    if (!src) return null;
    var fig = el.closest && el.closest("figure");
    var caption = fig ? clean((fig.querySelector("figcaption") || {}).innerText || "") : "";
    return { src: src, alt: clean(el.alt || el.getAttribute("aria-label") || el.title || ""), caption: caption.slice(0, 2000), width: el.naturalWidth || el.width || 0, height: el.naturalHeight || el.height || 0 };
  }
  var canonical = document.querySelector('link[rel="canonical"]');
  var out = {
    mode: mode,
    url: document.location.href,
    title: clean(document.title).slice(0, 300),
    selection: "",
    context: "",
    images: [],
    pageText: "",
    meta: {
      description: meta(["description", "og:description", "twitter:description"]),
      author: meta(["author", "article:author", "og:article:author", "byl"]),
      published: meta(["article:published_time", "datePublished", "pubdate", "date", "dc.date", "og:published_time"]),
      siteName: meta(["og:site_name", "application-name"]),
      canonical: canonical ? abs(canonical.getAttribute("href")) : "",
      lang: document.documentElement.lang || ""
    }
  };

  if (mode === "page") {
    var root = document.querySelector("article") || document.querySelector("main, [role=main]") || document.body;
    out.pageText = clean(root ? root.innerText : "").slice(0, MAX_TEXT);
    return JSON.stringify(out);
  }

  var sel = window.getSelection ? window.getSelection() : null;
  var selected = sel ? clean(sel.toString()) : "";
  if (selected) {
    out.selection = selected.slice(0, MAX_TEXT);
    var range = sel.getRangeAt(0);
    var node = range.commonAncestorContainer;
    var block = node.nodeType === 1 ? node : node.parentElement;
    while (block && block !== document.body && /^(A|SPAN|EM|STRONG|B|I|U|MARK|CODE|SMALL|SUB|SUP|ABBR|TIME|Q|CITE)$/.test(block.tagName)) block = block.parentElement;
    var ctx = block ? clean(block.innerText) : "";
    if (ctx.length > 4000) {
      var at = ctx.indexOf(selected.slice(0, 200));
      ctx = at >= 0 ? ctx.slice(Math.max(0, at - 1500), at + selected.length + 1500) : ctx.slice(0, 4000);
    }
    out.context = ctx === out.selection ? "" : ctx;
    var frag = range.cloneContents();
    var imgs = frag.querySelectorAll ? frag.querySelectorAll("img") : [];
    for (var i = 0; i < imgs.length && out.images.length < 10; i++) {
      var im = image(imgs[i]);
      if (im) out.images.push(im);
    }
    return JSON.stringify(out);
  }

  var hover = window.__hvnt33Hover;
  if (hover && hover.el && hover.el.isConnected && Date.now() - hover.at < 15000) {
    var img = image(hover.el);
    if (img) { out.images.push(img); out.context = img.caption; return JSON.stringify(out); }
  }
  out.error = "Nothing selected. Highlight text, or point at an image, then capture.";
  return JSON.stringify(out);
})
