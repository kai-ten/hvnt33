import type { Metadata } from "next";
import Link from "next/link";
import { PageHead } from "@/components/PageHead";
import { Subscribe } from "@/components/Subscribe";
import { longDate, posts } from "@/lib/investigations";

export const metadata: Metadata = {
  title: "Investigations",
  description: "Research traced in the open with HVNT33: what was found, where it came from, and how it fits together. By email or RSS.",
  alternates: { types: { "application/rss+xml": "/investigations/feed.xml" } },
};

export default function Investigations() {
  const list = posts();
  return (
    <div className="wrap">
      <PageHead title="Investigations">
        <p>Things worth tracing, traced in the open: what was found, where each piece came from, and how they fit. Every claim links to its source.</p>
      </PageHead>
      <div className="grid gap-14 lg:grid-cols-[minmax(0,1fr)_22rem] lg:gap-20 items-start">
        <div>
          {list.length ? (
            <ol className="border-t border-rule">
              {list.map(p => (
                <li key={p.slug} className="border-b border-rule" data-reveal>
                  <Link href={`/investigations/${p.slug}`} className="entry-link py-8">
                    <span className="meta block">{longDate(p.date)}{p.draft ? " · draft" : ""}</span>
                    <span className="entry-title display block mt-2 text-[clamp(1.5rem,1.1rem+1.4vw,2.3rem)]">{p.title}</span>
                    <span className="block mt-3 max-w-[62ch]">{p.summary}</span>
                  </Link>
                </li>
              ))}
            </ol>
          ) : (
            <p className="border-t border-rule pt-8 max-w-[52ch]">The first investigation is being written. Subscribe, and it comes to your inbox when it&rsquo;s published.</p>
          )}
        </div>
        <aside className="lg:sticky lg:top-24">
          <Subscribe />
          <p className="meta mt-6">Or follow the <a href="/investigations/feed.xml">RSS feed</a>.</p>
        </aside>
      </div>
    </div>
  );
}
