import Link from "next/link";
import type { ReactNode } from "react";
import { docPages, type TocEntry } from "@/lib/markdown";

// A book: the contents on the left, the page, and its sections in the margin.
export function DocsShell({ current, toc, children }: { current?: string; toc?: TocEntry[]; children: ReactNode }) {
  return (
    <div className="wrap docs-grid pt-10">
      <nav aria-label="Docs" className="docs-nav lg:sticky lg:top-24 self-start lg:pt-14">
        <p className="caps dim text-[1.05rem]"><span lang="la">Liber</span> · The manual</p>
        <ol className="mt-3 border-t border-rule pt-3 text-[0.97rem]">
          <li><Link href="/docs" aria-current={current === undefined ? "page" : undefined}>Contents</Link></li>
          <li><Link href="/download">Download</Link></li>
          {docPages.map(d => (
            <li key={d.slug}><Link href={`/docs/${d.slug}`} aria-current={current === d.slug ? "page" : undefined}>{d.title}</Link></li>
          ))}
          <li><Link href="/security">Security</Link></li>
          <li><Link href="/changelog">Changelog</Link></li>
        </ol>
      </nav>
      <div className="min-w-0">{children}</div>
      {toc?.length ? (
        <nav aria-label="On this page" className="toc hidden min-[88rem]:block sticky top-24 self-start pt-14 text-[0.9rem]">
          <p className="caps dim text-[1.05rem]">On this page</p>
          <ol className="mt-3 border-t border-rule pt-3">
            {toc.map(t => <li key={t.id}><a href={`#${t.id}`} className={`depth-${t.depth}`}>{t.text}</a></li>)}
          </ol>
        </nav>
      ) : null}
    </div>
  );
}

export function PhoneToc({ toc }: { toc: TocEntry[] }) {
  if (!toc.length) return null;
  return (
    <details className="min-[88rem]:hidden border border-rule mt-2 mb-8">
      <summary className="cursor-pointer px-4 py-3 min-h-[44px]">On this page</summary>
      <ol className="toc px-4 pb-3">
        {toc.map(t => <li key={t.id}><a href={`#${t.id}`} className={`depth-${t.depth}`}>{t.text}</a></li>)}
      </ol>
    </details>
  );
}
