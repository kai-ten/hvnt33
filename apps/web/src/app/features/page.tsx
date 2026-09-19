import type { Metadata } from "next";
import Link from "next/link";
import { Figure } from "@/components/Figure";
import { PageHead } from "@/components/PageHead";
import { features } from "@/lib/features";
import { shots } from "@/lib/shots";
import { site } from "@/lib/site";

export const metadata: Metadata = {
  title: "Features",
  description: "Everything HVNT33 does today: search every engine at once, capture evidence, a query language over what you've seen, an AI agent that files and a human who verifies, timestamped archives, and a connection per case.",
};

export default function Features() {
  let figure = 0;
  return (
    <div className="wrap ledger-wrap">
      <PageHead title="What HVNT33 does">
        <p>Fourteen things, all shipped and all in the open-source app. Where a feature has a limit, the note under it says so.</p>
        <p className="meta mt-4">{site.platform} · Open source, {site.license}</p>
      </PageHead>
      <nav aria-label="Features on this page" className="border-t border-rule pt-6 pb-4">
        <ol className="grid gap-x-8 gap-y-1 sm:grid-cols-2 lg:grid-cols-3 text-[0.97rem]">
          {features.map(f => (
            <li key={f.id}><a href={`#${f.id}`} className="no-underline hover:underline"><span className="num">{f.numeral}</span>{f.title}</a></li>
          ))}
        </ol>
      </nav>
      <ol className="ledger mt-6">
        {features.map((f, i) => {
          const shot = f.figure && shots[f.figure] ? f.figure : null;
          return (
            <li key={f.id} id={f.id} data-reveal>
              <article className={`entry ${shot ? "has-figure" : ""} ${i % 2 ? "flip" : ""}`}>
                <div className="entry-text">
                  <h2><span className="num">{f.numeral}</span>{f.title}</h2>
                  <p className="mt-4 max-w-[60ch]">{f.body}</p>
                  {f.note ? <p className="note mt-4 max-w-[60ch]"><span className="dagger" aria-hidden="true">†</span>{f.note}</p> : null}
                  <p className="mt-4"><Link href={f.doc.href}>{f.doc.label} in the docs</Link></p>
                </div>
                {shot ? <Figure shot={shot} number={++figure} /> : null}
              </article>
            </li>
          );
        })}
      </ol>
      <p className="border-t border-rule pt-8 text-[1.15rem]"><span aria-hidden="true" className="text-rubric mr-2">☞</span><Link href="/download">Download HVNT33</Link></p>
    </div>
  );
}
