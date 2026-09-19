import type { Metadata } from "next";
import Link from "next/link";
import { DocsShell } from "@/components/DocsShell";
import { PageHead } from "@/components/PageHead";
import { docPages } from "@/lib/markdown";

export const metadata: Metadata = { title: "Docs", description: "The HVNT33 manual: using it, the desktop app, the agent workflow, operations and architecture." };

const roman = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII"];

export default function Docs() {
  const pages = [{ slug: "", href: "/download", title: "Download", summary: "Install the browser and open your first investigation." }, ...docPages.map(d => ({ ...d, href: `/docs/${d.slug}` }))];
  return (
    <DocsShell>
      <PageHead title="The manual" running={<><span lang="la">Liber</span> · Contents</>}>
        <p>How to use HVNT33, how it works, and how to run it. These pages are the repository&rsquo;s own documentation, published as it is.</p>
      </PageHead>
      <ol className="border-t border-rule">
        {pages.map((p, i) => (
          <li key={p.href} className="border-b border-rule">
            <Link href={p.href} className="entry-link grid! grid-cols-[3rem_1fr] gap-2 py-5">
              <span className="num text-[1.35rem] leading-tight">{roman[i]}</span>
              <span>
                <span className="entry-title display text-[1.35rem]">{p.title}</span>
                <span className="block dim mt-1">{p.summary}</span>
              </span>
            </Link>
          </li>
        ))}
      </ol>
    </DocsShell>
  );
}
