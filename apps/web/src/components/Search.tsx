"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { SearchIcon } from "./Icons";

interface Entry { url: string; page: string; title: string; text: string }

// Search the manual, in the browser, over an index built with the site.
// No query ever leaves the page.
export function Search() {
  const dialog = useRef<HTMLDialogElement>(null);
  const [index, setIndex] = useState<Entry[] | null>(null);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const router = useRouter();

  const open = () => {
    dialog.current?.showModal();
    if (!index) fetch("/search.json").then(r => r.json()).then(setIndex, () => setIndex([]));
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && e.target.closest("input, textarea, [contenteditable]");
      if ((e.key === "k" && (e.metaKey || e.ctrlKey)) || (e.key === "/" && !typing)) { e.preventDefault(); open(); }
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  });

  const results = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (!index || !words.length) return [];
    return index
      .map(e => {
        const title = e.title.toLowerCase(), text = e.text.toLowerCase();
        if (!words.every(w => title.includes(w) || text.includes(w))) return null;
        const score = words.reduce((s, w) => s + (title.includes(w) ? 10 : 0) + Math.min(text.split(w).length - 1, 5), 0);
        const at = text.indexOf(words[0]);
        const snippet = (at > 40 ? "…" : "") + e.text.slice(Math.max(0, at - 40), at + 110).trim() + "…";
        return { ...e, score, snippet };
      })
      .filter(r => r !== null)
      .sort((a, b) => b.score - a.score)
      .slice(0, 12);
  }, [index, query]);

  const go = (url: string) => { dialog.current?.close(); setQuery(""); router.push(url); };

  return (
    <>
      <button type="button" className="icon-btn" onClick={open} aria-label="Search the docs (press /)">
        <SearchIcon />
      </button>
      <dialog ref={dialog} className="search" aria-label="Search the docs" onClick={e => { if (e.target === dialog.current) dialog.current.close(); }}>
        <input
          type="search"
          value={query}
          placeholder="Search the docs"
          aria-label="Search the docs"
          aria-controls="search-results"
          autoFocus
          onChange={e => { setQuery(e.target.value); setActive(0); }}
          onKeyDown={e => {
            if (e.key === "ArrowDown") { e.preventDefault(); setActive(a => Math.min(a + 1, results.length - 1)); }
            if (e.key === "ArrowUp") { e.preventDefault(); setActive(a => Math.max(a - 1, 0)); }
            if (e.key === "Enter" && results[active]) go(results[active].url);
          }}
        />
        <ul id="search-results" role="listbox" aria-label="Results">
          {results.map((r, i) => (
            <li key={r.url} role="option" aria-selected={i === active}>
              <a href={r.url} onClick={e => { e.preventDefault(); go(r.url); }}>
                <span className="block font-medium">{r.title}</span>
                <span className="meta block">{r.page}</span>
                <span className="block text-[0.9rem] dim mt-1">{r.snippet}</span>
              </a>
            </li>
          ))}
          {query && index && !results.length ? <li className="p-4 dim">Nothing in the docs matches that.</li> : null}
        </ul>
      </dialog>
    </>
  );
}
