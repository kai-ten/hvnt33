// Serve the exported site the way Vercel will: clean URLs and the headers
// from vercel.json. Used by the tests and for local review.
//   npm run serve [-- --port 4400]
import fs from "node:fs";
import http from "node:http";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const out = path.join(root, "out");
const vercel = JSON.parse(fs.readFileSync(path.join(root, "vercel.json"), "utf8"));
const portArg = process.argv.indexOf("--port");
const port = Number(portArg > 0 ? process.argv[portArg + 1] : process.env.PORT || 4400);

const types: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".avif": "image/avif", ".webp": "image/webp",
  ".woff2": "font/woff2", ".txt": "text/plain; charset=utf-8", ".xml": "application/xml", ".webmanifest": "application/manifest+json", ".ico": "image/x-icon",
};

const pattern = (source: string) => new RegExp(`^${source.replace(/\(\.\*\)/g, ".*")}$`);

// Vercel Functions in api/ run here the way Vercel runs them: a web Request in,
// a web Response out.
const functions = new Map<string, { fetch(request: Request): Promise<Response> }>();
async function runFunction(name: string, req: http.IncomingMessage, res: http.ServerResponse, url: URL) {
  if (!functions.has(name)) functions.set(name, (await import(path.join(root, "api", `${name}.ts`))).default);
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) if (typeof v === "string") headers.set(k, v);
  const request = new Request(`http://${req.headers.host}${url.pathname}${url.search}`, {
    method: req.method, headers, body: req.method === "GET" || req.method === "HEAD" ? undefined : Buffer.concat(chunks),
  });
  const response = await functions.get(name)!.fetch(request);
  for (const rule of vercel.headers) if (pattern(rule.source).test(url.pathname)) for (const h of rule.headers) res.setHeader(h.key, h.value);
  response.headers.forEach((v, k) => res.setHeader(k, v));
  res.writeHead(response.status);
  res.end(Buffer.from(await response.arrayBuffer()));
}

http.createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  const rel = decodeURIComponent(url.pathname);
  // Vercel serves these in production. Empty local stubs let the exported-site
  // tests verify our pages without treating absent platform scripts as app 404s.
  if (rel === "/_vercel/insights/script.js" || rel === "/_vercel/speed-insights/script.js") {
    res.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "no-store" });
    res.end();
    return;
  }
  const fn = rel.match(/^\/api\/([a-z-]+)$/);
  if (fn && fs.existsSync(path.join(root, "api", `${fn[1]}.ts`))) {
    runFunction(fn[1], req, res, url).catch(err => { console.error(err); res.writeHead(500); res.end(); });
    return;
  }
  if (rel.endsWith(".html") && vercel.cleanUrls) { res.writeHead(308, { Location: rel.slice(0, -5) || "/" }); res.end(); return; }
  const candidates = rel === "/" ? ["/index.html"] : [rel, `${rel}.html`, `${rel}/index.html`];
  const found = candidates.map(c => path.join(out, c)).find(p => p.startsWith(out) && fs.existsSync(p) && fs.statSync(p).isFile());
  const file = found ?? path.join(out, "404.html");
  for (const rule of vercel.headers) if (pattern(rule.source).test(rel)) for (const h of rule.headers) res.setHeader(h.key, h.value);
  res.writeHead(found ? 200 : 404, { "Content-Type": types[path.extname(file)] ?? "application/octet-stream", "Content-Length": fs.statSync(file).size });
  if (req.method === "HEAD") res.end();
  else fs.createReadStream(file).pipe(res);
}).listen(port, "127.0.0.1", () => console.log(`serving out/ at http://127.0.0.1:${port}`));
