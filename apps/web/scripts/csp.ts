// After `next build`: give every exported page a Content-Security-Policy that
// allows only its own inline scripts, by hash. vercel.json sends the rest of
// the policy as a header; browsers enforce both, so inline scripts run only
// when their hash is listed here.
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const out = path.resolve(import.meta.dirname, "../out");
const pages: string[] = [];
const walk = (dir: string) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith(".html")) pages.push(p);
  }
};
walk(out);

let scripts = 0;
for (const file of pages) {
  let html = fs.readFileSync(file, "utf8");
  if (html.includes('http-equiv="Content-Security-Policy"')) throw new Error(`${file} already has a CSP meta tag`);
  const hashes = new Set<string>();
  for (const [, attrs, body] of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)) {
    if (/\bsrc=/.test(attrs)) continue;
    if (/type="application\/(ld\+)?json"/.test(attrs)) continue;
    hashes.add(`'sha256-${createHash("sha256").update(body, "utf8").digest("base64")}'`);
  }
  scripts += hashes.size;
  const policy = `script-src 'self' ${[...hashes].join(" ")}; object-src 'none'; base-uri 'none'`;
  const meta = `<meta http-equiv="Content-Security-Policy" content="${policy}"/>`;
  if (!/<head>/.test(html)) throw new Error(`${file}: no <head>`);
  html = html.replace("<head>", `<head>${meta}`);
  fs.writeFileSync(file, html);
}
console.log(`csp: ${pages.length} pages, ${scripts} inline scripts hashed`);
