// Package hvnt33 as one installable app for this computer's platform:
// the app, the server, the built-in database (Java runtime and ArcadeDB) and
// Tor, with nothing else to install.
//   node scripts/package.ts            installers for this platform (dmg / nsis / AppImage+deb)
//   node scripts/package.ts --dir      an unpacked app only (quick check)
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { runtimePlatform } from "../../server/src/seams/database.ts";

const here = path.resolve(import.meta.dirname, "..");
const root = path.resolve(here, "../..");
const stage = path.join(here, "build", "hvnt33");
const platform = runtimePlatform();
if (!platform) throw new Error(`hvnt33 is not packaged for ${process.platform}-${process.arch}`);

const run = (cmd: string, args: string[], cwd = here) => execFileSync(cmd, args, { cwd, stdio: "inherit", shell: process.platform === "win32" });
const copy = (from: string, to: string) => fs.cpSync(from, to, { recursive: true, dereference: true, filter: f => !/(^|[\\/])(node_modules|\.DS_Store)$/.test(f) });

// 1. The app itself.
run(process.execPath, ["scripts/build.ts"]);

// 2. The server as it runs in the repository (its sources are run directly), with its npm dependencies.
fs.rmSync(stage, { recursive: true, force: true });
const server = path.join(root, "apps/server");
const into = path.join(stage, "apps/server");
for (const part of ["src", "public", "scripts/research.ts", "vendor/replaywebpage", "vendor/runtime.json", "vendor/tor.json", "package.json"]) copy(path.join(server, part), path.join(into, part));
// The agent's instructions and skills, for the installed app's own workspace (src/main/workspace.ts).
for (const part of ["AGENTS.md", "CLAUDE.md", ".agents", ".claude"]) copy(path.join(root, part), path.join(stage, "agent", part));
const pkg = JSON.parse(fs.readFileSync(path.join(server, "package.json"), "utf8"));
fs.writeFileSync(path.join(stage, "package.json"), JSON.stringify({ name: "hvnt33-server-bundle", private: true, type: "module", dependencies: pkg.dependencies }, null, 2));
run("npm", ["install", "--omit=dev", "--no-audit", "--no-fund", "--ignore-scripts", "--no-package-lock"], stage);

// 3. The built-in database and Tor for this platform (checksum-verified downloads).
run(process.execPath, ["scripts/runtime.ts", "fetch", platform], root);
const runtime = path.join(server, "vendor/runtime");
copy(path.join(runtime, "arcadedb"), path.join(into, "vendor/runtime/arcadedb"));
copy(path.join(runtime, "java", platform), path.join(into, "vendor/runtime/java", platform));
const tor = path.join(server, "vendor/tor", platform);
if (fs.existsSync(tor)) copy(tor, path.join(into, "vendor/tor", platform));
else console.log(`(Tor is not available for ${platform} yet; the app will offer proxies only.)`);

// 4. Installers.
const dirOnly = process.argv.includes("--dir");
run(path.join(root, "node_modules/.bin", process.platform === "win32" ? "electron-builder.cmd" : "electron-builder"), ["--config", "electron-builder.yml", "--publish", "never", ...(dirOnly ? ["--dir"] : [])]);
// Update metadata otherwise has the same name for both Mac architectures.
if (!dirOnly) {
  const metadata = process.platform === "darwin" ? "latest-mac.yml" : process.platform === "win32" ? "latest.yml" : "latest-linux.yml";
  const channel = process.platform === "darwin" ? `latest-${process.arch}-mac.yml` : process.platform === "win32" ? `latest-${process.arch}.yml` : `latest-${process.arch}-linux.yml`;
  const source = path.join(here, "release", metadata);
  const destination = path.join(here, "release", channel);
  if (!fs.existsSync(source)) throw new Error(`electron-builder did not create ${metadata}`);
  fs.rmSync(destination, { force: true });
  fs.renameSync(source, destination);
}
console.log(`Packaged hvnt33 for ${platform} in apps/desktop/release`);
