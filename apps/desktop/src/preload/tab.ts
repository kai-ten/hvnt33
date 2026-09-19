// Preload for browsed tabs, in every frame. It exposes nothing to the page: it
// only installs hvnt33's page scripts into the page's own world before the
// page's scripts run. WebRTC is removed so a page cannot learn the computer's
// real address when the case's traffic goes through a route; the init script
// remembers the image under the pointer for captures. The scripts are handed
// over as functions, so a page's Content Security Policy (no eval) does not
// block them.
import { contextBridge } from "electron";
import webrtc from "@hvnt33/ui/page-scripts/webrtc.js?raw";
import init from "@hvnt33/ui/page-scripts/init.js?raw";

const install = (source: string) => contextBridge.executeInMainWorld({ func: new Function(source) as () => void });
install(webrtc);
if (window === window.top) install(init);
