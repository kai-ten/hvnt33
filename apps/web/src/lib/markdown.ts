// The manual is the repository's own Markdown, rendered at build time.
// Nothing here runs in the browser.
import fs from "node:fs";
import path from "node:path";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkRehype from "remark-rehype";
import rehypeSlug from "rehype-slug";
import rehypeStringify from "rehype-stringify";
import rehypeShiki from "@shikijs/rehype";
import { createCssVariablesTheme } from "shiki";
import { SKIP, visit } from "unist-util-visit";
import { toString as mdText } from "mdast-util-to-string";
import { toString as hastText } from "hast-util-to-string";
import type { Root as Mdast, RootContent, Heading, Code } from "mdast";
import type { Root as Hast, Element } from "hast";
import { blob, github, site } from "./site";

export const repoRoot = path.resolve(process.cwd(), "../..");

export interface DocPage { slug: string; file: string; title: string; summary: string }

// The published manual, in reading order. docs/notes and docs/website stay private.
export const docPages: DocPage[] = [
  { slug: "using-hvnt33", file: "docs/using-hvnt33.md", title: "Using HVNT33", summary: "Investigations, verification statuses and exports." },
  { slug: "desktop", file: "apps/desktop/README.md", title: "The desktop app", summary: "Searching, capture, archives, the case view, connections, the Search Lab and every shortcut." },
  { slug: "agent-workflow", file: "docs/agent-workflow.md", title: "Agent workflow", summary: "How the agent files captures, the research CLI and the skills." },
  { slug: "operations", file: "docs/operations.md", title: "Operations", summary: "Storage, backup and restore, server modes, security and tests." },
  { slug: "architecture", file: "docs/ARCHITECTURE.md", title: "Architecture", summary: "How the pieces fit, trust boundaries and the cloud-ready design." },
];

// Repository files that have a page on the site. Everything else links to GitHub.
const routes: Record<string, string> = {
  "README.md": "/download",
  "SECURITY.md": "/security",
  "CHANGELOG.md": "/changelog",
  ...Object.fromEntries(docPages.map(d => [d.file, `/docs/${d.slug}`])),
};

export const readRepoFile = (file: string) =>
  fs.readFileSync(path.join(repoRoot, file), "utf8").replaceAll("{{GITHUB_REPO}}", site.repo);

export const parse = (markdown: string) => unified().use(remarkParse).use(remarkGfm).parse(markdown) as Mdast;

/** The nodes under a heading, up to the next heading of the same or higher level. */
export function section(tree: Mdast, title: string): RootContent[] {
  const start = tree.children.findIndex(n => n.type === "heading" && mdText(n) === title);
  if (start < 0) throw new Error(`no section "${title}"`);
  const depth = (tree.children[start] as Heading).depth;
  const end = tree.children.findIndex((n, i) => i > start && n.type === "heading" && n.depth <= depth);
  return tree.children.slice(start + 1, end < 0 ? undefined : end);
}

export const codeBlocks = (nodes: RootContent[]) => nodes.filter((n): n is Code => n.type === "code");

// Relative links between repository files become site routes or GitHub links.
function rewriteLinks(from: string) {
  return (tree: Mdast) => {
    visit(tree, ["link", "definition"], node => {
      const n = node as { url: string };
      if (/^[a-z]+:|^#/i.test(n.url)) return;
      const [target, hash = ""] = n.url.split("#");
      const file = path.posix.normalize(path.posix.join(path.posix.dirname(from), target)).replace(/^\.\//, "");
      if (file.startsWith("..")) throw new Error(`${from}: link leaves the repository: ${n.url}`);
      const route = routes[file];
      n.url = route ? route + (hash ? `#${hash}` : "") : file.endsWith("/") || !path.extname(file) ? `${github}/tree/main/${file}` : blob(file) + (hash ? `#${hash}` : "");
    });
  };
}

// The name is HVNT33 in running text. Code, inline code and link targets keep
// their real spelling (they are commands, paths and URLs).
function capitalName() {
  return (tree: Mdast) => {
    visit(tree, "text", node => {
      (node as { value: string }).value = (node as { value: string }).value.replace(/(?<![\w/@.-])hvnt33(?![\w-]|\.\w)/g, "HVNT33");
    });
  };
}

function dropTitle() {
  return (tree: Mdast) => {
    const i = tree.children.findIndex(n => n.type === "heading" && n.depth === 1);
    if (i >= 0) tree.children.splice(i, 1);
  };
}

// § after each h2 and h3, like a printed manual's section marks.
function sectionMarks() {
  return (tree: Hast) => {
    visit(tree, "element", (node: Element) => {
      if ((node.tagName === "h2" || node.tagName === "h3") && node.properties.id) {
        node.children.push({
          type: "element", tagName: "a",
          properties: { href: `#${node.properties.id}`, className: ["mark"], ariaLabel: `Link to ${hastText(node)}` },
          children: [{ type: "text", value: "§" }],
        });
      }
      if (node.tagName === "a" && typeof node.properties.href === "string" && /^https?:/.test(node.properties.href)) {
        node.properties.rel = ["noopener", "noreferrer"];
      }
      if (node.tagName === "table") {
        // Wide tables scroll inside their own frame on phones.
        const table = { ...node };
        node.tagName = "div";
        node.properties = { className: ["table-frame"], tabIndex: 0, role: "region", ariaLabel: "Table" };
        node.children = [table];
        return SKIP;
      }
    });
  };
}

export interface TocEntry { id: string; text: string; depth: 2 | 3 }
export interface Rendered { html: string; toc: TocEntry[]; sections: { id: string; title: string; text: string }[] }

const codeTheme = createCssVariablesTheme({ name: "hvnt33", variablePrefix: "--code-", fontStyle: true });

export async function render(markdown: string | RootContent[], from: string): Promise<Rendered> {
  const tree: Mdast = typeof markdown === "string" ? parse(markdown) : { type: "root", children: markdown };
  const toc: TocEntry[] = [];
  const sections: Rendered["sections"] = [];
  const processor = unified()
    .use(dropTitle)
    .use(capitalName)
    .use(rewriteLinks, from)
    .use(remarkRehype)
    .use(rehypeSlug)
    .use(() => (hast: Hast) => {
      let current = { id: "", title: "", text: "" };
      sections.push(current);
      for (const node of hast.children) {
        if (node.type !== "element") continue;
        const text = hastText(node);
        if (node.tagName === "h2" || node.tagName === "h3") {
          const id = String(node.properties.id);
          toc.push({ id, text, depth: node.tagName === "h2" ? 2 : 3 });
          if (node.tagName === "h2") { current = { id, title: text, text: "" }; sections.push(current); continue; }
        }
        current.text += ` ${text}`;
      }
    })
    .use(rehypeShiki, { theme: codeTheme, defaultLanguage: "text", fallbackLanguage: "text" })
    .use(sectionMarks)
    .use(rehypeStringify);
  const hast = await processor.run(tree);
  const html = processor.stringify(hast as Hast);
  return { html, toc, sections: sections.filter(s => s.text.trim()) };
}

export const renderFile = (file: string) => render(readRepoFile(file), file);
