// End-to-end check of the app against live search engines.
// Usage: npm run e2e [-- --token] [-- --real-tor] [-- --screenshots DIR]
//
// 1. Builds the app and launches it with HVNT33_E2E=1 and its own settings
//    folder (its browser sessions are throwaway too).
// 2. The app starts its server as it does for a researcher, on a spare port
//    with a built-in database of its own in a temporary data directory (never
//    the researcher's data, and no Docker), so snapshots use the app's browser.
// 3. The app runs packages/ui/src/e2e.ts and writes a JSON report, then exits.
// 4. Prints the report, verifies the evidence package the app saved, and
//    deletes what the run created.
import { spawn, execFileSync } from "node:child_process";
import electron from "electron";
import fs from "node:fs/promises";
import http from "node:http";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(here, "..");
const root = path.resolve(appDir, "../..");
process.loadEnvFile?.(path.join(root, ".env"));
// The run's own built-in database (HVNT33_E2E_ARCADEDB_URL: use that ArcadeDB instead).
process.env.ARCADEDB_URL = process.env.HVNT33_E2E_ARCADEDB_URL || "";
// The session runs against its own database, never the researcher's.
process.env.ARCADEDB_DATABASE = process.env.HVNT33_E2E_DATABASE || `${process.env.ARCADEDB_DATABASE || "newsroom"}_e2e`;
const port = Number(process.env.HVNT33_E2E_PORT || 4391);
const base = `http://127.0.0.1:${port}`;
const report = path.join(os.tmpdir(), `hvnt33-e2e-${Date.now()}.json`);
const sh = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, stdio: "inherit" });
// --token: run the server in hosted shape (bearer tokens, its own workspace) and
// drive the whole session through an API token.
const tokenMode = process.argv.includes("--token");
// --real-tor: only the built-in Tor scenario, on the real Tor network.
const realTor = process.argv.includes("--real-tor");
if (realTor) process.env.HVNT33_E2E_ONLY = "real-tor";
// --layout: only the window layout (the agent terminal's placement and sizes), with screenshots.
if (process.argv.includes("--layout")) process.env.HVNT33_E2E_ONLY = "layout";
let workspaceId = "";
// --screenshots DIR: the app saves a picture of the window at a few UI states.
const shotsArg = process.argv.indexOf("--screenshots");
const shots = shotsArg > 0 ? path.resolve(process.argv[shotsArg + 1] || "e2e-screenshots") : null;

// A page that changes on every request, for the watch check.
let revision = 0;
const changing = http.createServer((req, res) => {
  // A stand-in for the exit-check service, reached through the case's route.
  if (req.url === "/exit") { res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify({ ip: "192.0.2.1", country: "Testland", city: "Proxytown", organization: "E2E Proxy Network", mullvad_exit_ip: false })); return; }
  revision++;
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(`<!doctype html><title>Harbor notice board</title><h1>Harbor notice board</h1><p>Revision ${revision}</p><p>Posted ${new Date().toISOString()}</p><p>Standing item: the board meets monthly.</p>`);
});
await new Promise(r => changing.listen(0, "127.0.0.1", r));
const changingUrl = `http://127.0.0.1:${changing.address().port}/notice`;

const exitCheck = `http://127.0.0.1:${changing.address().port}/exit`;
// A SOCKS5 proxy that logs every destination, for the case-route checks.
const { startSocks } = await import(path.join(root, "apps/server/tests/socks.ts"));
const socks = await startSocks();
// A proxy that needs a login (like a VPN provider's), and a Tor stand-in that
// accepts any login, as Tor does, and keeps a circuit per login.
const socksAuth = await startSocks("127.0.0.1", { credentials: { username: "e2e-user", password: "e2e-pass" } });
const torish = await startSocks("127.0.0.1", { credentials: "any" });

const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "hvnt33-e2e-data-"));
// The app's settings and browser sessions for this run (both launches share them).
const userData = await fs.mkdtemp(path.join(os.tmpdir(), "hvnt33-e2e-app-"));
/** The run's database, the one its server uses (attached to, not started twice). */
async function graphOf() {
  const { loadConfig } = await import(path.join(root, "apps/server/src/config.ts"));
  const { arcadeGraph } = await import(path.join(root, "apps/server/src/seams/graph.ts"));
  const { connectDatabase } = await import(path.join(root, "apps/server/src/seams/database.ts"));
  const config = loadConfig({ ...process.env, HVNT33_DATA_DIR: dataDir });
  // Attaches to the app's database while it runs; otherwise starts it (stopped at the end).
  const db = await connectDatabase(config);
  if (db?.owner) ownDatabases.push(db);
  return arcadeGraph(config.arcade);
}
const ownDatabases = [];
// The server's settings: the app passes its environment on to the server it starts.
// Private URLs are allowed so the local changing page can be watched in token mode too.
const serverEnv = { PORT: String(port), HVNT33_REPLAY_PORT: String(port + 1), HVNT33_DATA_DIR: dataDir, HVNT33_ALLOW_PRIVATE_URLS: "1", ...(realTor ? {} : { HVNT33_EXIT_CHECK_URL: exitCheck }), HVNT33_TOR_PORTS: String(torish.port), HVNT33_TOR_BUILTIN: realTor ? "" : "0", ...(tokenMode ? { HVNT33_AUTH: "token" } : {}) };
let appLog = "";

async function cleanup(caseId) {
  if (!caseId) return;
  const graph = await graphOf();
  for (const type of ["SearchRun", "Intake", "Connection", "PageVisit", "SavedSearch", "Job", "Record", "Snapshot", "Watch", "PageChange"]) await graph.sql(`DELETE FROM ${type} WHERE investigationId=:id`, { id: caseId });
  await graph.sql("DELETE FROM Investigation WHERE id=:id", { id: caseId });
}

/** Check the evidence package the app saved: checksums and timestamp tokens, as VERIFY.txt describes. */
async function verifyEvidence(zip) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "hvnt33-e2e-evidence-"));
  try {
    execFileSync("unzip", ["-q", zip, "-d", dir]);
    const sums = execFileSync("shasum", ["-a", "256", "-c", "SHA256SUMS"], { cwd: dir }).toString().trim().split("\n");
    const tokens = await fs.readdir(path.join(dir, "timestamps")).catch(() => []);
    const fixtures = path.join(root, "apps/server/tests/fixtures");
    const verified = tokens.map(t => {
      const trust = t.includes("freetsa") ? ["-CAfile", path.join(fixtures, "freetsa-cacert.pem"), "-untrusted", path.join(fixtures, "freetsa-tsa.crt")] : ["-CAfile", "/etc/ssl/cert.pem"];
      const out = execFileSync("openssl", ["ts", "-verify", "-data", "manifest.json", "-in", path.join("timestamps", t), ...trust], { cwd: dir, stdio: ["ignore", "pipe", "pipe"] }).toString();
      if (!/Verification: OK/.test(out)) throw new Error(`${t}: ${out}`);
      return t;
    });
    if (!verified.length) throw new Error("no timestamp tokens in the package");
    return { files: sums.length, timestamps: verified };
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
    await fs.unlink(zip).catch(() => {});
  }
}

async function issueTestToken() {
  const { createWorkspace, issueToken } = await import(path.join(root, "apps/server/src/seams/auth.ts"));
  const { prepareDatabase } = await import(path.join(root, "apps/server/src/app.ts"));
  const graph = await graphOf();
  // Before the app's first start, the database is new: give it the schema first.
  await prepareDatabase(graph, () => {});
  const ws = await createWorkspace(graph, `E2E workspace ${new Date().toISOString()}`);
  workspaceId = ws.id;
  return (await issueToken(graph, ws.id, "e2e@test.invalid", "e2e")).token;
}

async function removeWorkspace() {
  if (!workspaceId) return;
  const graph = await graphOf();
  for (const type of ["Connection", "Record", "Intake", "SearchRun", "PageVisit", "SavedSearch", "Job", "Snapshot", "Watch", "PageChange", "Investigation", "Usage", "ApiToken"]) await graph.sql(`DELETE FROM ${type} WHERE workspaceId=:ws`, { ws: workspaceId });
  await graph.sql("DELETE FROM Workspace WHERE id=:ws", { ws: workspaceId });
}

let result;
try {
  const token = tokenMode ? await issueTestToken() : "";
  if (tokenMode) console.log(`▸ Token mode: workspace ${workspaceId}`);
  console.log(`▸ The app's server will run on ${base}`);
  console.log("▸ Building app…");
  sh(process.execPath, ["scripts/build.ts"], appDir);
  console.log("▸ Running the session (a hvnt33 window will open)…");
  // Both launches share one run id: the relaunch sees the first session's
  // browser profiles and app storage (all throwaway, never the researcher's).
  const run = crypto.randomBytes(4).toString("hex");
  const launch = async (reportPath, extra) => {
    const app = spawn(electron, [appDir], {
      env: { ...process.env, ...serverEnv, HVNT33_E2E: "1", HVNT33_USER_DATA: userData, ...(shots && extra.HVNT33_E2E_ONLY !== "relaunch" ? { HVNT33_E2E_SHOTS: shots } : {}), HVNT33_E2E_REPORT: reportPath, HVNT33_URL: base, HVNT33_E2E_CHANGING: changingUrl, HVNT33_E2E_RUN: run, HVNT33_E2E_SOCKS: socks.url, HVNT33_E2E_SOCKS_AUTH: socksAuth.url, ...(realTor ? {} : { HVNT33_EXIT_CHECK_URL: exitCheck }), ...(token ? { HVNT33_TOKEN: token } : {}), ...extra },
      stdio: ["ignore", "pipe", "pipe"],
    });
    // The app reports each check as it starts: a hang names its step.
    let current = "";
    app.stderr.on("data", d => { appLog = (appLog + d).slice(-4000); if (process.env.HVNT33_DEBUG_LAYOUT) process.stderr.write(d); });
    app.stdout.on("data", d => { for (const line of String(d).split("\n")) if (line.startsWith("[e2e] ")) { current = line.slice(6); if (process.env.HVNT33_E2E_VERBOSE) console.log(`  … ${current}`); } });
    const code = await new Promise(resolve => {
      const timer = setTimeout(() => { app.kill(); resolve("timeout"); }, 480_000);
      app.on("exit", c => { clearTimeout(timer); resolve(c); });
    });
    const r = JSON.parse(await fs.readFile(reportPath, "utf8").catch(() => "null"));
    if (!r) throw new Error(`App exited (${code}) without a report${current ? `, during "${current}"` : ""}${appLog ? `\n${appLog.slice(-800)}` : ""}`);
    return r;
  };
  result = await launch(report, { ...(shots ? { HVNT33_E2E_TOUR: "1" } : {}), ...(process.env.HVNT33_E2E_ONLY ? { HVNT33_E2E_ONLY: process.env.HVNT33_E2E_ONLY } : {}) });
  // Relaunch: the case's tabs and sign-ins must come back.
  if (!realTor && result.checks.some(c => c.name.startsWith("each case keeps its tabs") && c.ok)) {
    console.log("▸ Relaunching the app…");
    const again = await launch(`${report}.relaunch`, { HVNT33_E2E_ONLY: "relaunch", HVNT33_E2E_CASE: result.caseId });
    await fs.unlink(`${report}.relaunch`).catch(() => {});
    result.checks.push(...again.checks);
    result.ok = result.ok && again.ok;
    result.seconds += again.seconds;
  }
  // The app saved an evidence package to ~/Downloads: verify it independently, then remove it.
  const saved = result.checks.find(c => c.name.startsWith("evidence package") && c.ok);
  if (saved) {
    const t = Date.now();
    try { result.checks.push({ name: "evidence package verifies (shasum, openssl ts)", ok: true, detail: await verifyEvidence(saved.detail.path), ms: Date.now() - t }); }
    catch (e) { result.checks.push({ name: "evidence package verifies (shasum, openssl ts)", ok: false, detail: String(e.message ?? e), ms: Date.now() - t }); result.ok = false; }
  }
  // Through the route, the proxy saw hostnames (the page and the crawler), so DNS did not leak.
  const routedCheck = result.checks.find(c => c.name.startsWith("a case route") && c.ok && typeof c.detail === "object");
  if (routedCheck) {
    const seen = socks.log.filter(l => l.host === "example.com");
    const ok = seen.length >= 2 && seen.every(l => l.addressType === "domain");
    result.checks.push({ name: "the proxy carried the case's traffic, with hostnames resolved by the proxy", ok, detail: { toExampleCom: seen.length, addressTypes: [...new Set(seen.map(l => l.addressType))], allDestinations: [...new Set(socks.log.map(l => l.host))] }, ms: 0 });
    if (!ok) result.ok = false;
    // The login proxy only ever saw the case's login; tabs reached it through the relay.
    const logins = socksAuth.log;
    const loginOk = logins.some(l => l.host === "example.com") && logins.every(l => l.username === "e2e-user");
    result.checks.push({ name: "a proxy login is added by the local relay, for tabs and checks", ok: loginOk, detail: { connections: logins.length, usernames: [...new Set(logins.map(l => l.username))] }, ms: 0 });
    // Tor: the case had its own circuit name, and a new exit changed it.
    const routedCase = routedCheck.detail.routedCase;
    const names = [...new Set(torish.log.filter(l => l.host === "example.com").map(l => l.username))];
    const torOk = names.includes(`hvnt33-${routedCase}-0`) && names.includes(`hvnt33-${routedCase}-1`) && names.every(n => n.startsWith(`hvnt33-${routedCase}-`));
    result.checks.push({ name: "Tor: the case's own circuit, and a new one after New exit", ok: torOk, detail: { circuits: names }, ms: 0 });
    if (!loginOk || !torOk) result.ok = false;
  }
  // The presentation export: a real ZIP with the dossier, map and tables. Checked, then removed.
  const exported = result.checks.find(c => c.name.startsWith("Case view: map") && c.ok);
  if (exported) {
    const t = Date.now();
    try {
      const listing = execFileSync("unzip", ["-Z1", exported.detail.path]).toString().split("\n");
      const missing = ["index.html", "connection-map.svg", "records.csv", "connections.csv", "investigation.json"].filter(f => !listing.some(l => l.endsWith(f)));
      if (missing.length) throw new Error(`missing ${missing.join(", ")}`);
      result.checks.push({ name: "presentation export contains the dossier, map and tables", ok: true, detail: `${listing.filter(Boolean).length} files`, ms: Date.now() - t });
    } catch (e) {
      result.checks.push({ name: "presentation export contains the dossier, map and tables", ok: false, detail: String(e.message ?? e), ms: Date.now() - t });
      result.ok = false;
    } finally {
      await fs.unlink(exported.detail.path).catch(() => {});
    }
  }
  for (const c of result.checks) {
    const detail = typeof c.detail === "string" ? c.detail : JSON.stringify(c.detail);
    console.log(`${c.ok ? "  ✓" : "  ✗"} ${c.name}${c.ms ? ` (${(c.ms / 1000).toFixed(1)}s)` : ""}${detail ? `\n      ${detail.slice(0, process.env.HVNT33_E2E_VERBOSE ? 4000 : 300)}` : ""}`);
  }
  const failed = result.checks.filter(c => !c.ok).length;
  console.log(`\n${failed ? `✗ ${failed} of ${result.checks.length} checks failed` : `✓ all ${result.checks.length} checks passed`} in ${result.seconds}s`);
  process.exitCode = result.ok ? 0 : 1;
} catch (e) {
  console.error(`✗ ${e.message}`);
  process.exitCode = 1;
} finally {
  if (!process.env.HVNT33_E2E_KEEP) {
    for (const id of [result?.caseId, ...(result?.extraCases ?? [])]) await cleanup(id).catch(e => console.error(`cleanup failed: ${e.message}`));
    await removeWorkspace().catch(e => console.error(`workspace cleanup failed: ${e.message}`));
  }
  await fs.unlink(report).catch(() => {});
  changing.close();
  await socks.close();
  await socksAuth.close();
  await torish.close();
  // A database started here for the token or cleanup stops before the run's files go.
  for (const db of ownDatabases) await db.stop().catch(() => {});
  await fs.rm(userData, { recursive: true, force: true });
  if (!process.env.HVNT33_E2E_KEEP) await fs.rm(dataDir, { recursive: true, force: true });
  else console.log(`▸ Kept test data in ${dataDir}`);
}
