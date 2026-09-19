"use client";
import { LampIcon } from "./Icons";

// Lapis (the site) or Nox (dark stone). The choice is the only thing the site
// keeps in the browser.
export function ThemeToggle() {
  const toggle = () => {
    const root = document.documentElement;
    const current = root.dataset.theme ?? "light";
    const next = current === "light" ? "dark" : "light";
    root.dataset.theme = next;
    try { localStorage.setItem("theme", next); } catch { /* private mode: the choice lasts this page only */ }
  };
  return (
    <button type="button" className="icon-btn" onClick={toggle} aria-label="Switch between light and dark stone">
      <LampIcon />
    </button>
  );
}
