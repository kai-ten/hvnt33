"use client";
import { useEffect } from "react";
import { LampIcon } from "./Icons";

// Lapis (the site) or Nox (dark stone). The choice is the only thing the site
// keeps in the browser.
export function ThemeToggle() {
  useEffect(() => {
    // Defer document-level attributes until the hydration commit has fully
    // finished. Changing <html> from a child effect during a busy parallel
    // load can otherwise make React treat the server document as mismatched.
    const timer = window.setTimeout(() => {
      document.documentElement.classList.add("js");
      try {
        const saved = localStorage.getItem("theme");
        if (saved === "light" || saved === "dark") document.documentElement.dataset.theme = saved;
      } catch { /* private mode: use the server-rendered light theme */ }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

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
