// Installed into every frame of every browsed page. WebRTC can reveal the
// computer's real IP address to a page even when the case's traffic goes
// through a proxy or VPN, so browsed pages do not get it at all.
(function () {
  "use strict";
  var names = ["RTCPeerConnection", "webkitRTCPeerConnection", "RTCDataChannel", "RTCIceCandidate", "RTCIceTransport",
    "RTCSessionDescription", "RTCRtpSender", "RTCRtpReceiver", "RTCRtpTransceiver", "RTCDtlsTransport", "RTCSctpTransport"];
  function scrub(w) {
    for (var i = 0; i < names.length; i++) {
      try { Object.defineProperty(w, names[i], { value: undefined, writable: false, configurable: false, enumerable: false }); } catch (e) { /* already locked, or another origin's */ }
    }
  }
  scrub(window);
  // A frame the page creates (about:blank) has a fresh window before any
  // script of ours runs in it: remove WebRTC there when the page reaches it.
  function guard(proto, prop) {
    var d = proto && Object.getOwnPropertyDescriptor(proto, prop);
    if (!d || !d.get || !d.configurable) return;
    var get = d.get;
    Object.defineProperty(proto, prop, {
      configurable: true, enumerable: d.enumerable,
      get: function () {
        var v = get.call(this);
        try { var w = v && v.defaultView !== undefined ? v.defaultView : v; if (w && w !== window) scrub(w); } catch (e) { /* another origin's frame */ }
        return v;
      },
    });
  }
  var frames = [window.HTMLIFrameElement, window.HTMLFrameElement, window.HTMLObjectElement];
  for (var j = 0; j < frames.length; j++) {
    if (!frames[j]) continue;
    guard(frames[j].prototype, "contentWindow");
    guard(frames[j].prototype, "contentDocument");
  }
})();
