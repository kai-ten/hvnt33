// The Investigations newsletter's one server endpoint (a Vercel Function).
//   POST /api/newsletter        subscribe: sends a confirmation email
//   GET  /api/newsletter?t=...  confirm: adds the address to the Resend segment
// Double opt-in without a database: the confirmation link carries the address
// and the time, signed with NEWSLETTER_SECRET, and expires after 7 days.
// Nothing is stored until the reader confirms. Self-contained on purpose:
// Vercel deploys this file alone, and scripts/serve.ts runs it locally.
import { createHmac, createHash, timingSafeEqual } from "node:crypto";

const WEEK = 7 * 24 * 60 * 60 * 1000;

interface Env { key: string; segment: string; from: string; secret: string; site: string; api: string }

function env(): Env | null {
  const e = process.env;
  if (!e.RESEND_API_KEY || !e.RESEND_SEGMENT_ID || !e.NEWSLETTER_FROM || !e.NEWSLETTER_SECRET) return null;
  return {
    key: e.RESEND_API_KEY, segment: e.RESEND_SEGMENT_ID, from: e.NEWSLETTER_FROM, secret: e.NEWSLETTER_SECRET,
    site: (e.SITE_URL || "https://hvnt33.com").replace(/\/$/, ""), api: (e.RESEND_API_URL || "https://api.resend.com").replace(/\/$/, ""),
  };
}

const b64 = (s: string) => Buffer.from(s).toString("base64url");
const sign = (secret: string, payload: string) => createHmac("sha256", secret).update(payload).digest("base64url");

export function token(secret: string, email: string, at = Date.now()) {
  const payload = b64(JSON.stringify({ e: email, t: at }));
  return `${payload}.${sign(secret, payload)}`;
}

export function verify(secret: string, value: string, now = Date.now()): string | null {
  const [payload, mac] = value.split(".");
  if (!payload || !mac) return null;
  const expected = Buffer.from(sign(secret, payload)), given = Buffer.from(mac);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const { e, t } = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (typeof e !== "string" || typeof t !== "number" || now - t > WEEK || t > now + 60_000) return null;
    return e;
  } catch {
    return null;
  }
}

const valid = (email: string) => email.length <= 254 && /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[a-z]{2,}$/i.test(email);

async function resend(cfg: Env, method: string, route: string, body?: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(cfg.api + route, {
    method,
    headers: { Authorization: `Bearer ${cfg.key}`, "Content-Type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  return res;
}

function confirmationEmail(link: string) {
  const text = `Confirm your subscription to HVNT33 Investigations:\n\n${link}\n\nIf you didn't ask for this, ignore this email and nothing happens. The link expires in 7 days.`;
  const html = `<!doctype html><html><body style="margin:0;padding:32px 16px;background:#ebe5d8;color:#1d1a16;font-family:Georgia,'Times New Roman',serif">
<div style="max-width:520px;margin:0 auto">
<p style="font-size:14px;letter-spacing:4px;margin:0 0 28px">HVNT33</p>
<h1 style="font-weight:normal;font-size:26px;letter-spacing:1px;text-transform:uppercase;margin:0 0 16px">Confirm your subscription</h1>
<p style="font-size:17px;line-height:1.55;margin:0 0 24px">You asked to get HVNT33 Investigations by email. Confirm it's you:</p>
<p style="margin:0 0 28px"><a href="${link}" style="display:inline-block;background:#a3261a;color:#f4efe4;text-decoration:none;padding:12px 20px;font-family:Helvetica,Arial,sans-serif;font-size:16px">Confirm my subscription</a></p>
<p style="font-size:14px;line-height:1.5;color:#5a5245;margin:0">If you didn't ask for this, ignore this email and nothing happens. The link expires in 7 days.</p>
</div></body></html>`;
  return { html, text };
}

const redirect = (to: string) => new Response(null, { status: 303, headers: { Location: to, "Cache-Control": "no-store" } });
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

async function subscribe(request: Request, cfg: Env) {
  // Only this site's own forms may subscribe someone. Browsers say where a
  // request came from in Sec-Fetch-Site; the site's no-referrer policy makes
  // them send "Origin: null" on plain form posts, so Origin alone won't do.
  const site = request.headers.get("sec-fetch-site");
  const origin = request.headers.get("origin");
  const foreign = site ? site !== "same-origin" && site !== "none" : origin !== null && origin !== "null" && origin !== new URL(cfg.site).origin;
  if (foreign) return json(403, { error: "Forbidden" });

  const wantsJson = (request.headers.get("accept") ?? "").includes("application/json");
  const type = request.headers.get("content-type") ?? "";
  let fields: Record<string, string> = {};
  try {
    if (type.includes("application/json")) fields = await request.json();
    else fields = Object.fromEntries(new URLSearchParams(await request.text()));
  } catch {
    return json(400, { error: "That didn't come through. Try again." });
  }
  const email = String(fields.email ?? "").trim().toLowerCase();
  const done = () => (wantsJson ? json(200, { ok: true }) : redirect(`${cfg.site}/investigations/check-your-email`));

  // A field people can't see: only bots fill it in. Answer as if it worked.
  if (fields.website) return done();
  if (!valid(email)) return wantsJson ? json(400, { error: "That doesn't look like an email address." }) : redirect(`${cfg.site}/investigations`);

  const link = `${cfg.site}/api/newsletter?t=${token(cfg.secret, email)}`;
  const { html, text } = confirmationEmail(link);
  // One confirmation per address per day, however often the form is sent.
  const day = new Date().toISOString().slice(0, 10);
  const idempotency = createHash("sha256").update(`${email}:${day}`).digest("hex");
  const res = await resend(cfg, "POST", "/emails", { from: cfg.from, to: [email], subject: "Confirm your subscription to HVNT33 Investigations", html, text }, { "Idempotency-Key": idempotency });
  if (!res.ok && res.status !== 409) {
    console.error("newsletter: confirmation email failed", res.status, await res.text().catch(() => ""));
    return wantsJson ? json(502, { error: "We couldn't send the confirmation email. Try again in a minute." }) : redirect(`${cfg.site}/investigations`);
  }
  return done();
}

async function confirm(request: Request, cfg: Env) {
  const email = verify(cfg.secret, new URL(request.url).searchParams.get("t") ?? "");
  if (!email) return redirect(`${cfg.site}/investigations/link-expired`);
  const enc = encodeURIComponent(email);
  const created = await resend(cfg, "POST", "/contacts", { email, unsubscribed: false, segments: [cfg.segment] });
  if (!created.ok) {
    // Already a contact (perhaps one who unsubscribed and came back): subscribe
    // them again and make sure they are in the segment.
    const updated = await resend(cfg, "PATCH", `/contacts/${enc}`, { unsubscribed: false });
    const added = await resend(cfg, "POST", `/contacts/${enc}/segments/${encodeURIComponent(cfg.segment)}`);
    if (!updated.ok && !added.ok) {
      console.error("newsletter: could not add contact", created.status, updated.status, added.status);
      return redirect(`${cfg.site}/investigations/link-expired`);
    }
  }
  return redirect(`${cfg.site}/investigations/subscribed`);
}

const handler = {
  async fetch(request: Request): Promise<Response> {
    const cfg = env();
    if (!cfg) return json(503, { error: "The newsletter isn't set up yet." });
    if (request.method === "POST") return subscribe(request, cfg);
    if (request.method === "GET") return confirm(request, cfg);
    return new Response(null, { status: 405, headers: { Allow: "GET, POST" } });
  },
};

export default handler;
