"use client";
import { useEffect } from "react";
import { usePathname } from "next/navigation";

// Marks [data-reveal] elements as shown when they scroll into view; the CSS
// does the rest. Runs again after every client-side navigation.
export function Reveals() {
  const path = usePathname();
  useEffect(() => {
    const io = new IntersectionObserver(entries => {
      for (const e of entries) if (e.isIntersecting) { (e.target as HTMLElement).dataset.shown = ""; io.unobserve(e.target); }
    }, { rootMargin: "0px 0px -8% 0px" });
    document.querySelectorAll("[data-reveal]:not([data-shown])").forEach(el => io.observe(el));
    return () => io.disconnect();
  }, [path]);
  return null;
}
