"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { github, site } from "@/lib/site";
import { DiscordIcon, GithubIcon, MenuIcon } from "./Icons";
import { Search } from "./Search";
import { ThemeToggle } from "./ThemeToggle";

const links = [
  { href: "/download", label: "Download" },
  { href: "/cloud", label: "Cloud" },
  { href: "/investigations", label: "Investigations" },
  { href: "/docs", label: "Docs" },
];

export function Nav() {
  const path = usePathname();
  const current = (href: string) => (path === href || path.startsWith(`${href}/`) ? "page" : undefined);
  return (
    <>
      <nav aria-label="Main" className="nav hidden md:flex items-center gap-6">
        {links.map(l => <Link key={l.href} href={l.href} aria-current={current(l.href)}>{l.label}</Link>)}
        <span className="social-links">
          <Search />
          <a href={site.discord} target="_blank" rel="noopener noreferrer" className="social-icon-link" aria-label="Discord community" title="Discord"><DiscordIcon /></a>
          <a href={github} target="_blank" rel="noopener noreferrer" className="social-icon-link" aria-label="GitHub source code" title="GitHub"><GithubIcon /></a>
          <ThemeToggle />
        </span>
      </nav>
      <details className="menu md:hidden">
        <summary className="icon-btn" aria-label="Menu"><MenuIcon /></summary>
        <nav aria-label="Main" className="menu-sheet">
          {links.map(l => <Link key={l.href} href={l.href} aria-current={current(l.href)} onClick={e => e.currentTarget.closest("details")?.removeAttribute("open")}>{l.label}</Link>)}
          <span className="menu-social-links">
            <a href={site.discord} target="_blank" rel="noopener noreferrer" aria-label="Discord community" title="Discord"><DiscordIcon /></a>
            <a href={github} target="_blank" rel="noopener noreferrer" aria-label="GitHub source code" title="GitHub"><GithubIcon /></a>
            <ThemeToggle />
          </span>
        </nav>
      </details>
    </>
  );
}
