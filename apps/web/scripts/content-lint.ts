// The brand guide's writing rules, checked mechanically over what visitors
// actually read: the text and text attributes of every exported page, with
// code, commands and scripts left out. See docs/website/brand-guide.md, section 5.
//   npm run lint:content   (after npm run build)
import fs from "node:fs";
import path from "node:path";
import { fromHtml } from "hast-util-from-html";
import type { Element, Nodes } from "hast";

const out = path.resolve(import.meta.dirname, "../out");

// Unambiguous words only; context-dependent ones (navigate, landscape, journey)
// are left to review.
const banned = [
  "unlock", "unleash", "supercharge", "supercharged", "elevate", "empower", "empowers", "seamless", "seamlessly",
  "effortless", "effortlessly", "revolutionize", "revolutionary", "game-changer", "game-changing", "cutting-edge",
  "next-generation", "state-of-the-art", "robust", "leverage", "leverages", "streamline", "streamlined", "delve",
  "deep dive", "dive in", "embark", "tapestry", "realm", "ever-evolving", "testament", "pivotal", "crucial", "vital",
  "paramount", "holistic", "synergy", "best-in-class", "world-class", "all-in-one", "one-stop", "superpower", "10x",
  "ai-powered", "in today's",
];
const allowedSymbols = new Set([..."⌘⇧↵¶§†☞←→↑↓©™↗"]);
const skip = new Set(["script", "style", "pre", "code", "kbd", "samp", "svg", "noscript", "template"]);
const textAttrs = ["alt", "title", "ariaLabel", "placeholder"];

interface Problem { page: string; rule: string; context: string }
const problems: Problem[] = [];

function check(page: string, text: string) {
  const report = (rule: string, index: number) =>
    problems.push({ page, rule, context: text.slice(Math.max(0, index - 40), index + 40).replace(/\s+/g, " ").trim() });
  for (const m of text.matchAll(/[–—]/g)) report(m[0] === "—" ? "em dash" : "en dash", m.index);
  for (const m of text.matchAll(/\S - \S/g)) report("spaced hyphen used as a dash", m.index);
  for (const m of text.matchAll(/\p{Extended_Pictographic}/gu)) if (!allowedSymbols.has(m[0])) report(`emoji ${m[0]}`, m.index);
  for (const m of text.matchAll(/[\p{L}\d)]!(?=\s|$)/gu)) report("exclamation mark", m.index);
  for (const m of text.matchAll(/\{\{/g)) report("template placeholder", m.index);
  for (const m of text.matchAll(/(?<![\w/@.-])(?:hvnt33|Hvnt33)(?![\w-]|\.\w)/g)) report("the name is HVNT33 in running text", m.index);
  const lower = text.toLowerCase();
  for (const word of banned) {
    const re = new RegExp(`(?<![\\p{L}-])${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}-])`, "gu");
    for (const m of lower.matchAll(re)) report(`banned word "${word}"`, m.index);
  }
}

function walk(page: string, node: Nodes) {
  if (node.type === "element") {
    const el = node as Element;
    for (const a of textAttrs) if (typeof el.properties[a] === "string") check(page, el.properties[a] as string);
    if (el.tagName === "meta" && typeof el.properties.content === "string" && /description|title/.test(String(el.properties.name ?? el.properties.property ?? ""))) check(page, el.properties.content);
    if (el.tagName === "title") { check(page, el.children.map(c => (c.type === "text" ? c.value : "")).join("")); return; }
    if (skip.has(el.tagName) || (Array.isArray(el.properties.className) && el.properties.className.includes("term"))) return;
  }
  if ("children" in node) {
    // Join adjacent text so a sentence split across inline elements is read whole.
    let run = "";
    for (const child of node.children) {
      if (child.type === "text") run += child.value;
      else if (child.type === "element" && ["a", "b", "strong", "em", "i", "span", "abbr"].includes(child.tagName) && !skip.has(child.tagName)) {
        run += textOf(child);
        walk(page, { ...child, children: [] } as Element);
      } else {
        if (run) check(page, run);
        run = "";
        walk(page, child as Nodes);
      }
    }
    if (run) check(page, run);
  }
}

function textOf(node: Nodes): string {
  if (node.type === "text") return node.value;
  if (node.type === "element" && skip.has(node.tagName)) return " ";
  return "children" in node ? node.children.map(c => textOf(c as Nodes)).join("") : "";
}

const pages: string[] = [];
const collect = (dir: string) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory() && e.name !== "_next") collect(p);
    else if (e.name.endsWith(".html")) pages.push(p);
  }
};
if (!fs.existsSync(out)) { console.error("content-lint: build the site first (npm run build)"); process.exit(1); }
collect(out);
for (const file of pages) walk(path.relative(out, file), fromHtml(fs.readFileSync(file, "utf8")));

if (problems.length) {
  for (const p of problems) console.error(`${p.page}: ${p.rule}\n    …${p.context}…`);
  console.error(`\ncontent-lint: ${problems.length} problem${problems.length === 1 ? "" : "s"} in ${new Set(problems.map(p => p.page)).size} page(s)`);
  process.exit(1);
}
console.log(`content-lint: ${pages.length} pages clean`);
