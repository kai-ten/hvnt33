// Investigations: the newsletter's posts, one Markdown file each in
// content/investigations. The file name is the address. Files starting with
// an underscore are templates; posts marked draft appear only in `next dev`.
import fs from "node:fs";
import path from "node:path";
import { render } from "./markdown";

export interface Post { slug: string; title: string; date: string; summary: string; draft: boolean; body: string; file: string }

const dir = path.resolve(process.cwd(), "content/investigations");
const showDrafts = process.env.NODE_ENV === "development";

// A small front matter reader: `key: value` lines between two `---` lines.
function parse(file: string): Post {
  const raw = fs.readFileSync(path.join(dir, file), "utf8");
  const m = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) throw new Error(`${file}: no front matter`);
  const meta: Record<string, string> = {};
  for (const line of m[1].split("\n")) {
    const kv = line.match(/^(\w+):\s*(.*)$/);
    if (kv) meta[kv[1]] = kv[2].trim().replace(/^["']|["']$/g, "");
  }
  for (const key of ["title", "date", "summary"]) if (!meta[key]) throw new Error(`${file}: front matter needs ${key}`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(meta.date)) throw new Error(`${file}: date must be YYYY-MM-DD`);
  const slug = file.replace(/\.md$/, "");
  if (!/^[a-z0-9-]+$/.test(slug)) throw new Error(`${file}: name files with lowercase letters, digits and hyphens`);
  return { slug, title: meta.title, date: meta.date, summary: meta.summary, draft: meta.draft === "true", body: m[2], file: `apps/web/content/investigations/${file}` };
}

export function posts(): Post[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(f => f.endsWith(".md") && !f.startsWith("_"))
    .map(parse)
    .filter(p => showDrafts || !p.draft)
    .sort((a, b) => b.date.localeCompare(a.date));
}

export const post = (slug: string) => posts().find(p => p.slug === slug);

export const renderPost = (p: Post) => render(p.body, p.file);

export const longDate = (d: string) =>
  new Date(`${d}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
