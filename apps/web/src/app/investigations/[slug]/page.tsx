import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Prose } from "@/components/Prose";
import { Subscribe } from "@/components/Subscribe";
import { longDate, post, posts, renderPost } from "@/lib/investigations";

export const dynamicParams = false;
// A static export needs at least one path; the placeholder is never linked.
export const generateStaticParams = () => {
  const list = posts().map(p => ({ slug: p.slug }));
  return list.length ? list : [{ slug: "none" }];
};

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const p = post(slug);
  return p ? { title: p.title, description: p.summary, openGraph: { type: "article", title: p.title, description: p.summary, publishedTime: p.date } } : {};
}

export default async function Investigation({ params }: Props) {
  const { slug } = await params;
  const p = post(slug);
  if (!p) notFound();
  const { html } = await renderPost(p);
  return (
    <article className="wrap">
      <header className="pt-14 md:pt-20 pb-10 max-w-[70ch]">
        <p className="running-head"><Link href="/investigations" className="no-underline text-rubric">Investigations</Link> · <time dateTime={p.date}>{longDate(p.date)}</time></p>
        <h1 className="display mt-5 text-[clamp(2.1rem,1.3rem+3.3vw,4rem)]">{p.title}</h1>
        <p className="mt-6 text-[1.25rem] leading-relaxed">{p.summary}</p>
      </header>
      <Prose html={html} className="investigation" />
      <div className="mt-20 max-w-[70ch] border-t border-rule pt-10">
        <Subscribe compact />
      </div>
    </article>
  );
}
