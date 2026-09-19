// A stand-in for the Resend API in tests. It records every call and answers
// like Resend: contact creation fails for addresses it already knows.
//   GET /_calls        what it has received
//   POST /_reset       forget everything
import http from "node:http";

const port = Number(process.argv[process.argv.indexOf("--port") + 1] || 4421);
const calls: { method: string; path: string; body: unknown; auth: string | undefined }[] = [];
const contacts = new Set<string>();

http.createServer(async (req, res) => {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const text = Buffer.concat(chunks).toString();
  const body = text ? JSON.parse(text) : undefined;
  const send = (status: number, data: unknown) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(data)); };
  if (req.url === "/_calls") return send(200, calls);
  if (req.url === "/_reset") { calls.length = 0; contacts.clear(); return send(200, {}); }
  calls.push({ method: req.method!, path: req.url!, body, auth: req.headers.authorization });
  if (req.headers.authorization !== "Bearer re_test") return send(401, { message: "API key is invalid" });
  if (req.method === "POST" && req.url === "/emails") return send(200, { id: "email_1" });
  if (req.method === "POST" && req.url === "/contacts") {
    const email = (body as { email: string }).email;
    if (contacts.has(email)) return send(409, { message: "Contact already exists" });
    contacts.add(email);
    return send(200, { id: `contact_${contacts.size}` });
  }
  if (req.method === "PATCH" && req.url?.startsWith("/contacts/")) return send(200, { id: "contact_x" });
  if (req.method === "POST" && /^\/contacts\/[^/]+\/segments\//.test(req.url ?? "")) return send(200, { id: "seg_test" });
  if (req.method === "POST" && req.url === "/broadcasts") return send(200, { id: "broadcast_1", object: "broadcast" });
  send(404, { message: "Not found" });
}).listen(port, "127.0.0.1", () => console.log(`fake Resend on ${port}`));
