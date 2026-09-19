// Send an investigation to subscribers.
//   npm run newsletter -- preview <slug>       write the email to out-email/<slug>.html to look at
//   npm run newsletter -- send <slug>          create it in Resend as a draft broadcast, to review and send there
//   npm run newsletter -- send <slug> --now    send it straight away
// Reads RESEND_API_KEY, RESEND_SEGMENT_ID and NEWSLETTER_FROM from the
// environment or apps/web/.env.local (git-ignored).
import fs from "node:fs";
import path from "node:path";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkRehype from "remark-rehype";
import rehypeStringify from "rehype-stringify";
import { visit } from "unist-util-visit";
import type { Root, Element } from "hast";

const root = path.resolve(import.meta.dirname, "..");
const site = (process.env.SITE_URL || "https://hvnt33.com").replace(/\/$/, "");
const [command, slug] = process.argv.slice(2);
const now = process.argv.includes("--now");

function fail(message: string): never { console.error(`newsletter: ${message}`); process.exit(1); }
if (!["preview", "send"].includes(command ?? "") || !slug) fail("usage: npm run newsletter -- preview|send <slug> [--now]");

const file = path.join(root, "content/investigations", `${slug}.md`);
if (!fs.existsSync(file)) fail(`no post at content/investigations/${slug}.md`);
const raw = fs.readFileSync(file, "utf8");
const m = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
if (!m) fail(`${slug}.md has no front matter`);
const meta = Object.fromEntries(m[1].split("\n").map(l => l.match(/^(\w+):\s*(.*)$/)).filter(Boolean).map(kv => [kv![1], kv![2].trim().replace(/^["']|["']$/g, "")]));
if (command === "send" && meta.draft === "true") fail(`${slug} is a draft. Remove "draft: true", publish the site, then send.`);
const url = `${site}/investigations/${slug}`;

// Email clients ignore most stylesheets, so every element carries its own style.
const styles: Record<string, string> = {
  p: "margin:0 0 18px;font-size:17px;line-height:1.65",
  h2: "margin:34px 0 12px;font-weight:normal;font-size:22px;letter-spacing:1px;text-transform:uppercase",
  h3: "margin:26px 0 10px;font-family:Helvetica,Arial,sans-serif;font-size:16px",
  a: "color:#a3261a",
  blockquote: "margin:0 0 18px;padding-left:16px;border-left:2px solid #a3261a;color:#5a5245;font-style:italic",
  ul: "margin:0 0 18px;padding-left:22px", ol: "margin:0 0 18px;padding-left:22px",
  li: "margin:0 0 6px;font-size:17px;line-height:1.6",
  pre: "margin:0 0 18px;padding:14px;background:#1d1a16;color:#efe6d3;font-size:13px;line-height:1.5;overflow-x:auto;white-space:pre-wrap",
  code: "font-family:Menlo,Consolas,monospace;font-size:0.9em",
  img: "max-width:100%;height:auto",
  table: "border-collapse:collapse;margin:0 0 18px;font-size:15px", th: "border:1px solid #c9bea8;padding:6px 8px;text-align:left", td: "border:1px solid #c9bea8;padding:6px 8px",
  hr: "border:0;border-top:1px solid #c9bea8;margin:28px 0",
};
const inline = () => (tree: Root) => visit(tree, "element", (el: Element) => {
  if (styles[el.tagName]) el.properties.style = styles[el.tagName];
  // Relative links point at the site.
  if (el.tagName === "a" && typeof el.properties.href === "string" && el.properties.href.startsWith("/")) el.properties.href = site + el.properties.href;
});
const body = String(await unified().use(remarkParse).use(remarkGfm).use(remarkRehype).use(inline).use(rehypeStringify).process(m[2]));
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(meta.title)}</title></head>
<body style="margin:0;padding:32px 16px;background:#ebe5d8;color:#1d1a16;font-family:Georgia,'Times New Roman',serif">
<div style="display:none;max-height:0;overflow:hidden">${esc(meta.summary)}</div>
<div style="max-width:600px;margin:0 auto">
<p style="margin:0 0 28px;font-size:13px;letter-spacing:4px"><a href="${site}/investigations" style="color:#1d1a16;text-decoration:none">HVNT33 INVESTIGATIONS</a></p>
<h1 style="margin:0 0 14px;font-weight:normal;font-size:30px;line-height:1.15;letter-spacing:1px;text-transform:uppercase">${esc(meta.title)}</h1>
<p style="margin:0 0 28px;font-size:19px;line-height:1.5;color:#5a5245">${esc(meta.summary)}</p>
${body}
<p style="margin:32px 0 0;padding-top:18px;border-top:1px solid #c9bea8;font-family:Helvetica,Arial,sans-serif;font-size:13px;line-height:1.6;color:#5a5245">
<a href="${url}" style="color:#a3261a">Read it on the web</a> · You get this because you subscribed at hvnt33.com. <a href="{{{RESEND_UNSUBSCRIBE_URL}}}" style="color:#5a5245">Unsubscribe</a>
</p>
</div></body></html>`;

if (command === "preview") {
  const out = path.join(root, "out-email");
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, `${slug}.html`), html);
  console.log(`newsletter: wrote out-email/${slug}.html`);
  process.exit(0);
}

const { RESEND_API_KEY: key, RESEND_SEGMENT_ID: segment, NEWSLETTER_FROM: from } = process.env;
if (!key || !segment || !from) fail("set RESEND_API_KEY, RESEND_SEGMENT_ID and NEWSLETTER_FROM (in apps/web/.env.local)");
const api = (process.env.RESEND_API_URL || "https://api.resend.com").replace(/\/$/, "");
const res = await fetch(`${api}/broadcasts`, {
  method: "POST",
  headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
  body: JSON.stringify({ segment_id: segment, from, subject: meta.title, name: `Investigation: ${slug}`, html, send: now }),
});
const result = await res.json().catch(() => ({}));
if (!res.ok) fail(`Resend refused the broadcast (${res.status}): ${JSON.stringify(result)}`);
console.log(now
  ? `newsletter: sent "${meta.title}" (broadcast ${result.id})`
  : `newsletter: created a draft broadcast for "${meta.title}" (${result.id}). Review and send it at https://resend.com/broadcasts`);
