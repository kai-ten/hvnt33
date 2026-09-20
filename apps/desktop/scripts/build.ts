// Build the app: the main process and preloads (esbuild) and the interface (Vite).
//   node scripts/build.ts
import { build, type Plugin } from "esbuild";
import { build as vite } from "vite";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.resolve(import.meta.dirname, "..");
const out = path.join(here, "dist");

/** `import x from "file?raw"`: the file's text (page scripts run inside browsed pages). */
const raw: Plugin = {
  name: "raw",
  setup(b) {
    b.onResolve({ filter: /\?raw$/ }, async args => {
      const r = await b.resolve(args.path.slice(0, -4), { kind: args.kind, resolveDir: args.resolveDir, importer: args.importer });
      return { path: r.path, namespace: "raw" };
    });
    b.onLoad({ filter: /.*/, namespace: "raw" }, a => ({ contents: fs.readFileSync(a.path, "utf8"), loader: "text" }));
  },
};

// node-pty's published macOS and Linux helper lacks its execute bit; without it no terminal can start.
const pty = path.dirname(fileURLToPath(import.meta.resolve("node-pty/package.json")));
for (const dir of ["prebuilds", "build/Release"]) {
  const base = path.join(pty, dir);
  if (!fs.existsSync(base)) continue;
  for (const f of fs.readdirSync(base, { recursive: true }) as string[]) if (path.basename(f) === "spawn-helper") fs.chmodSync(path.join(base, f), 0o755);
}

fs.rmSync(path.join(out, "main"), { recursive: true, force: true });
fs.rmSync(path.join(out, "preload"), { recursive: true, force: true });
const common = { bundle: true, platform: "node" as const, target: "node24", plugins: [raw], logLevel: "warning" as const, legalComments: "none" as const };
await Promise.all([
  // The main process runs as an ES module; node-pty is a native module, loaded from node_modules.
  build({ ...common, entryPoints: [path.join(here, "src/main/main.ts")], outfile: path.join(out, "main/main.js"), format: "esm", external: ["electron", "electron-updater", "node-pty"],
    banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" } }),
  // Sandboxed preloads are CommonJS with only `electron` available.
  ...["app", "tab"].map(name => build({ ...common, entryPoints: [path.join(here, `src/preload/${name}.ts`)], outfile: path.join(out, `preload/${name}.cjs`), format: "cjs", external: ["electron"] })),
]);
await vite({ configFile: path.join(here, "vite.config.ts"), logLevel: "warn" });
console.log("Built apps/desktop/dist");
