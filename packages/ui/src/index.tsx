// The hvnt33 interface. A native shell calls `mount` with its bridge; the UI
// never imports the shell, so the same code runs on any engine.
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { setNative, type NativeBridge } from "./lib/native";
// The brand's typefaces, bundled (the app works offline and loads nothing from the web).
import "@fontsource/castoro-titling/400.css";
import "@fontsource/castoro/400.css";
import "@fontsource/castoro/400-italic.css";
import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/500.css";
import "@fontsource/ibm-plex-sans/600.css";
import "@fontsource/ibm-plex-mono/400.css";
import "./styles.css";

export type { NativeBridge, Unlisten } from "./lib/native";

export function mount(root: HTMLElement, native: NativeBridge) {
  setNative(native);
  // Files dropped outside the agent terminal are ignored, never opened in the app's own view.
  for (const type of ["dragover", "drop"] as const) window.addEventListener(type, e => e.preventDefault());
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
