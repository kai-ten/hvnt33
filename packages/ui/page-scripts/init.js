// Installed into every browsed page. Remembers the image under the pointer so
// "Capture" can take an image without a text selection. Nothing leaves the page
// unless the researcher triggers a capture from the app.
(function () {
  "use strict";
  if (window.top !== window || window.__hvnt33Init) return;
  Object.defineProperty(window, "__hvnt33Init", { value: true });
  var last = { el: null, at: 0 };
  Object.defineProperty(window, "__hvnt33Hover", { value: last });
  function remember(e) {
    var t = e.target;
    var img = t && t.closest ? t.closest("img, picture, video[poster]") : null;
    if (img && img.tagName === "PICTURE") img = img.querySelector("img");
    if (img) { last.el = img; last.at = Date.now(); }
  }
  document.addEventListener("mouseover", remember, true);
  document.addEventListener("contextmenu", remember, true);
})();
