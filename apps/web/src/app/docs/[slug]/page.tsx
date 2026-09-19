import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { DocsShell, PhoneToc } from "@/components/DocsShell";
import { PageHead } from "@/components/PageHead";
import { Prose } from "@/components/Prose";
import { docPages, renderFile } from "@/lib/markdown";
import { blob } from "@/lib/site";

export const dynamicParams = false;
export const generateStaticParams = () => docPages.map(d => ({ slug: d.slug }));

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const doc = docPages.find(d => d.slug === slug);
  return doc ? { title: doc.title, description: doc.summary } : {};
}

const roman = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII"];

export default async function DocPage({ params }: Props) {
  const { slug } = await params;
  const i = docPages.findIndex(d => d.slug === slug);
  if (i < 0) notFound();
  const doc = docPages[i];
  const { html, toc } = await renderFile(doc.file);
  const prev = docPages[i - 1], next = docPages[i + 1];
  return (
    <DocsShell current={slug} toc={toc}>
      <PageHead title={doc.title} running={<><span lang="la">Liber {roman[i + 1]}</span> · {doc.title}</>} />
      <PhoneToc toc={toc} />
      <Prose html={html} />
      <nav aria-label="Pages" className="mt-16 pt-6 border-t border-rule grid gap-4 sm:grid-cols-2 max-w-[70ch]">
        {prev ? <Link href={`/docs/${prev.slug}`} className="no-underline"><span className="meta block">Previous</span>{prev.title}</Link> : <Link href="/download" className="no-underline"><span className="meta block">Previous</span>Download</Link>}
        {next ? <Link href={`/docs/${next.slug}`} className="no-underline sm:text-right"><span className="meta block">Next</span>{next.title}</Link> : null}
      </nav>
      <p className="meta mt-8"><a href={blob(doc.file)} rel="noopener noreferrer">Edit this page on GitHub</a> (<code>{doc.file}</code>)</p>
    </DocsShell>
  );
}
