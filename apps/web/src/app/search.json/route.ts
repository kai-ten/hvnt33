import { docPages, renderFile } from "@/lib/markdown";

export const dynamic = "force-static";

// The docs search index: one entry per section, built with the site.
export async function GET() {
  const pages = [...docPages.map(d => ({ file: d.file, url: `/docs/${d.slug}`, title: d.title })), { file: "SECURITY.md", url: "/security", title: "Security" }];
  const entries = [];
  for (const p of pages) {
    const { sections } = await renderFile(p.file);
    for (const s of sections) entries.push({ url: s.id ? `${p.url}#${s.id}` : p.url, page: p.title, title: s.title || p.title, text: s.text.replace(/\s+/g, " ").trim() });
  }
  return Response.json(entries);
}
