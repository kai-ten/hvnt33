// Turn what a page returned into a hvnt33 intake, and tell the agent about
// it by reference. Page content never travels through the terminal.
import { domainOf, parseSerpUrl } from "@hvnt33/core/engines";
import type { CaptureRequest, PageCapture } from "./native";

export type CaptureKind = "selection" | "image" | "page";

export function captureKind(c: PageCapture): CaptureKind {
  if (c.mode === "page") return "page";
  return c.selection ? "selection" : "image";
}

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s);

export function sourceLabel(c: PageCapture): string {
  const site = c.meta.siteName || domainOf(c.url) || "Web page";
  const byline = [c.meta.author, c.meta.published?.slice(0, 10)].filter(Boolean).join(", ");
  return clip([site, c.title, byline && `(${byline})`].filter(Boolean).join(" — "), 300);
}

export function buildCapture(c: PageCapture, opts: { investigationId: string; note: string; searchContext?: { engine: string; query: string } | null }): CaptureRequest {
  const kind = captureKind(c);
  const image = kind === "image" ? c.images[0] : null;
  const text =
    kind === "page" ? c.pageText
    : kind === "selection" ? c.selection
    : [image?.alt && `Alt text: ${image.alt}`, image?.caption && `Caption: ${image.caption}`].filter(Boolean).join("\n");
  const firstLine = (kind === "selection" ? c.selection : "").split("\n")[0];
  const title = clip(
    kind === "page" ? c.title || domainOf(c.url)
    : kind === "image" ? `Image: ${image?.caption || image?.alt || c.title || domainOf(c.url)}`
    : firstLine.length > 20 ? firstLine : `${firstLine} — ${c.title}`,
    200,
  );
  const meta: Record<string, string> = { mode: kind, pageTitle: c.title };
  for (const [k, v] of Object.entries({ author: c.meta.author, published: c.meta.published, siteName: c.meta.siteName, canonical: c.meta.canonical, lang: c.meta.lang, context: c.context })) if (v) meta[k] = v;
  if (image) meta.imageUrl = image.src;
  if (opts.searchContext) { meta.engine = opts.searchContext.engine; meta.query = opts.searchContext.query; }
  return {
    investigationId: opts.investigationId,
    title: title || "Browser capture",
    text,
    sourceUrl: c.url,
    sourceLabel: sourceLabel(c),
    contentOrigin: "source-text",
    researcherNote: opts.note.trim(),
    captureMeta: meta,
    imageUrl: image?.src ?? null,
  };
}

/** The search that led to a page, when the tab arrived from a results page. */
export function searchContextFrom(previousUrl: string | undefined): { engine: string; query: string } | null {
  return previousUrl ? parseSerpUrl(previousUrl) : null;
}

// C0/C1 control characters plus shell/quote metacharacters.
const UNSAFE = new RegExp("[\\u0000-\\u001f\\u007f-\\u009f`\"'$\\\\]", "g");

/** Single-line, quote-free text safe to embed in a terminal instruction. */
export function terminalSafe(s: string, max = 80): string {
  return clip(s.replace(UNSAFE, " ").replace(/\s+/g, " ").trim(), max);
}

const ID = /^[A-Za-z0-9-]{1,64}$/;

/**
 * The message typed into the agent terminal after a capture. It carries IDs and
 * the case title only; the agent reads the saved capture from hvnt33.
 */
export function agentInstruction(items: { intakeId: string; kind: CaptureKind }[], investigation: { id: string; title: string }): string {
  if (!items.length || !items.every(i => ID.test(i.intakeId)) || !ID.test(investigation.id)) throw new Error("Invalid capture reference");
  const refs = items.map(i => i.intakeId).join(" ");
  const what = items.length === 1 ? `a browser ${items[0].kind} capture` : `${items.length} browser captures`;
  return `File ${what} into case "${terminalSafe(investigation.title)}" (${investigation.id}). Read each with: npm run research -- show --intake <id> (captureMeta has page context; researcherNote is my instruction). Intake IDs: ${refs}`;
}

/**
 * What a capture puts into the agent's message box: a reference only (the
 * capture's ID, kind and site), never page content. The researcher adds a
 * note and sends it; the agent reads the capture from hvnt33.
 */
export function captureReference(intakeId: string, kind: CaptureKind, sourceUrl: string): string {
  if (!ID.test(intakeId)) throw new Error("Invalid capture reference");
  let host = "";
  try { host = new URL(sourceUrl).hostname.replace(/^www\./, ""); } catch { /* no address */ }
  return `[hvnt33 capture ${intakeId}: ${kind}${host ? ` from ${terminalSafe(host, 60)}` : ""}] `;
}

/** A dropped file's path as a terminal takes it: spaces and shell characters escaped (quoted on Windows). */
export function terminalPath(path: string, windows: boolean): string {
  const clean = path.replace(/[\u0000-\u001f\u007f]/g, "");
  return windows ? `"${clean.replace(/"/g, "")}"` : clean.replace(/([ \t'"()&;$`\\[\]{}*?!<>|#~])/g, "\\$1");
}
