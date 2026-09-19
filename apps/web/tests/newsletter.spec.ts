import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { expect, test, type APIRequestContext } from "@playwright/test";

// Against tests/fake-resend.ts, which records what the endpoint asks Resend to do.
const fake = "http://127.0.0.1:4421";
test.describe.configure({ mode: "serial" });

const calls = async (request: APIRequestContext) => (await (await request.get(`${fake}/_calls`)).json()) as { method: string; path: string; body: Record<string, unknown> }[];
const confirmLink = (html: string) => html.match(/href="([^"]*\/api\/newsletter\?t=[^"]+)"/)![1];

test.beforeEach(async ({ request }) => { await request.post(`${fake}/_reset`); });

test("subscribing sends a confirmation email and stores nothing until it is clicked", async ({ page, request }) => {
  await page.goto("/investigations");
  await page.getByLabel("Email address").fill("reader@example.org");
  await page.getByRole("button", { name: "Subscribe" }).click();
  await expect(page.getByRole("status")).toContainText("Check your inbox");
  const sent = await calls(request);
  const email = sent.find(c => c.path === "/emails")!;
  expect(email.body.to).toEqual(["reader@example.org"]);
  expect(email.body.from).toBe("HVNT33 <test@hvnt33.com>");
  expect(sent.some(c => c.path.startsWith("/contacts"))).toBe(false);

  await page.goto(confirmLink(email.body.html as string));
  await expect(page).toHaveURL(/\/investigations\/subscribed$/);
  const contact = (await calls(request)).find(c => c.method === "POST" && c.path === "/contacts")!;
  expect(contact.body).toEqual({ email: "reader@example.org", unsubscribed: false, segments: ["seg_test"] });
});

test("a returning reader is subscribed again and put back in the segment", async ({ page, request }) => {
  const subscribe = async () => {
    await request.post("/api/newsletter", { headers: { Accept: "application/json" }, data: { email: "back@example.org" } });
    const email = (await calls(request)).filter(c => c.path === "/emails").at(-1)!;
    await page.goto(confirmLink(email.body.html as string));
  };
  await subscribe();
  await subscribe();
  await expect(page).toHaveURL(/\/investigations\/subscribed$/);
  const paths = (await calls(request)).map(c => `${c.method} ${c.path}`);
  expect(paths).toContain("PATCH /contacts/back%40example.org");
  expect(paths).toContain("POST /contacts/back%40example.org/segments/seg_test");
});

test("a tampered or made-up confirmation link subscribes nobody", async ({ page, request }) => {
  await request.post("/api/newsletter", { headers: { Accept: "application/json" }, data: { email: "real@example.org" } });
  const link = confirmLink((await calls(request)).find(c => c.path === "/emails")!.body.html as string);
  const [payload, mac] = new URL(link).searchParams.get("t")!.split(".");
  const forged = Buffer.from(JSON.stringify({ e: "victim@example.org", t: Date.now() })).toString("base64url");
  for (const t of [`${forged}.${mac}`, `${payload}.${mac.slice(0, -2)}xx`, "nonsense"]) {
    await page.goto(`/api/newsletter?t=${t}`);
    await expect(page).toHaveURL(/\/investigations\/link-expired$/);
  }
  expect((await calls(request)).some(c => c.path.startsWith("/contacts"))).toBe(false);
});

test("bots that fill the hidden field get a friendly answer and no email", async ({ request }) => {
  const res = await request.post("/api/newsletter", { headers: { Accept: "application/json" }, data: { email: "bot@example.org", website: "http://spam.example" } });
  expect(res.status()).toBe(200);
  expect(await calls(request)).toEqual([]);
});

test("bad addresses and other sites' forms are refused", async ({ request }) => {
  const bad = await request.post("/api/newsletter", { headers: { Accept: "application/json" }, data: { email: "not an email" } });
  expect(bad.status()).toBe(400);
  const foreign = await request.post("/api/newsletter", { headers: { Accept: "application/json", Origin: "https://evil.example" }, data: { email: "x@example.org" } });
  expect(foreign.status()).toBe(403);
  const crossSite = await request.post("/api/newsletter", { headers: { Accept: "application/json", "Sec-Fetch-Site": "cross-site", Origin: "null" }, data: { email: "x@example.org" } });
  expect(crossSite.status()).toBe(403);
  expect(await calls(request)).toEqual([]);
});

test("the form works without JavaScript", async ({ browser, request }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto("/investigations");
  await page.getByLabel("Email address").fill("nojs@example.org");
  await page.getByRole("button", { name: "Subscribe" }).click();
  await expect(page).toHaveURL(/\/investigations\/check-your-email$/);
  expect((await calls(request)).find(c => c.path === "/emails")!.body.to).toEqual(["nojs@example.org"]);
  await context.close();
});

test("the send script makes a draft broadcast with an unsubscribe link, and refuses drafts", async ({ request }) => {
  const dir = path.resolve("content/investigations");
  const file = path.join(dir, "zz-test-post.md");
  const env = { ...process.env, RESEND_API_KEY: "re_test", RESEND_SEGMENT_ID: "seg_test", NEWSLETTER_FROM: "HVNT33 <test@hvnt33.com>", RESEND_API_URL: fake };
  try {
    fs.writeFileSync(file, "---\ntitle: A test post\ndate: 2026-09-19\nsummary: For the test only.\n---\n\nSee [the docs](/docs).\n");
    execFileSync(process.execPath, ["scripts/newsletter.ts", "send", "zz-test-post"], { env });
    const b = (await calls(request)).find(c => c.path === "/broadcasts")!.body;
    expect(b).toMatchObject({ segment_id: "seg_test", from: "HVNT33 <test@hvnt33.com>", subject: "A test post", send: false });
    expect(b.html).toContain("{{{RESEND_UNSUBSCRIBE_URL}}}");
    expect(b.html).toContain('href="https://hvnt33.com/docs"');
    fs.writeFileSync(file, "---\ntitle: A draft\ndate: 2026-09-19\nsummary: Not yet.\ndraft: true\n---\n\nBody.\n");
    expect(() => execFileSync(process.execPath, ["scripts/newsletter.ts", "send", "zz-test-post"], { env, stdio: "pipe" })).toThrow();
  } finally {
    fs.rmSync(file, { force: true });
  }
});
