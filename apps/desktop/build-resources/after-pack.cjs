// electron-builder leaves folders named node_modules out of extra resources.
// Copy the server's npm dependencies in after packing (before signing).
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { flipFuses, FuseVersion, FuseV1Options } = require("@electron/fuses");

function developerIdIdentity() {
  const requested = process.env.CSC_NAME;
  if (/^[0-9a-f]{40}$/i.test(requested || "")) return requested;

  const args = ["find-identity", "-v", "-p", "codesigning"];
  if (process.env.CSC_KEYCHAIN) args.push(process.env.CSC_KEYCHAIN);
  let output;
  try {
    output = execFileSync("/usr/bin/security", args, { encoding: "utf8" });
  } catch {
    return null;
  }
  const identities = [...output.matchAll(/\b([0-9A-F]{40})\b\s+"Developer ID Application:/g)].map(match => match[1]);
  if (identities.length === 0) return null;
  if (identities.length > 1) {
    throw new Error("More than one Developer ID Application identity is available; set CSC_NAME to its SHA-1 fingerprint");
  }
  return identities[0];
}

function signNativeLibrariesInJars(resources, identity) {
  const runtimeRoot = path.join(resources, "hvnt33", "apps", "server", "vendor", "runtime");
  const javaRoot = path.join(runtimeRoot, "java");
  const runtimeNames = fs.readdirSync(javaRoot);
  if (runtimeNames.length !== 1) throw new Error(`Expected one bundled Java runtime, found ${runtimeNames.length}`);
  const libraryRoot = path.join(runtimeRoot, "arcadedb", "lib");
  const jars = fs.readdirSync(libraryRoot).filter(name => name.endsWith(".jar"));

  for (const jarName of jars) {
    const jarPath = path.join(libraryRoot, jarName);
    const entries = execFileSync("/usr/bin/unzip", ["-Z1", jarPath], { encoding: "utf8" })
      .split(/\r?\n/)
      .filter(entry => /\.(dylib|jnilib)$/i.test(entry) && !entry.startsWith("/") && !entry.split("/").includes(".."));
    if (entries.length === 0) continue;

    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "hvnt33-native-"));
    try {
      execFileSync("/usr/bin/unzip", ["-qq", jarPath, ...entries, "-d", temporary], { stdio: "inherit" });
      for (const entry of entries) {
        const args = ["--sign", identity, "--force", "--timestamp", "--options", "runtime"];
        if (process.env.CSC_KEYCHAIN) args.push("--keychain", process.env.CSC_KEYCHAIN);
        args.push(path.join(temporary, entry));
        execFileSync("/usr/bin/codesign", args, { stdio: "inherit" });
      }
      execFileSync("/usr/bin/zip", ["-q", jarPath, ...entries], { cwd: temporary, stdio: "inherit" });
    } finally {
      fs.rmSync(temporary, { recursive: true, force: true });
    }
  }
}

exports.default = async function afterPack(context) {
  const resources = context.electronPlatformName === "darwin"
    ? path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, "Contents", "Resources")
    : path.join(context.appOutDir, "resources");
  const from = path.join(__dirname, "..", "build", "hvnt33", "node_modules");
  const to = path.join(resources, "hvnt33", "node_modules");
  if (!fs.existsSync(from)) throw new Error("The server's dependencies were not staged (run scripts/package.ts)");
  // Preserve npm's relative .bin links. Node's dereference mode rewrites them
  // as absolute paths into the build workspace, which macOS rejects as links
  // escaping the signed application bundle.
  fs.cpSync(from, to, { recursive: true, dereference: false, verbatimSymlinks: true });

  // Apple notarization scans native libraries inside archives as well as the
  // outer app. ArcadeDB's compression JARs contain five macOS libraries, so
  // give those the same Developer ID signature before electron-builder signs
  // the containing application.
  if (context.electronPlatformName === "darwin") {
    const identity = developerIdIdentity();
    if (identity) signNativeLibrariesInJars(resources, identity);
  }

  // Remove Electron runtime capabilities hvnt33 does not use. This happens
  // before signing, so the operating system protects the resulting fuse wire.
  const product = context.packager.appInfo.productFilename;
  const executable = context.electronPlatformName === "darwin"
    ? path.join(context.appOutDir, `${product}.app`, "Contents", "MacOS", product)
    : path.join(
        context.appOutDir,
        context.electronPlatformName === "win32" ? `${product}.exe` : context.packager.executableName,
      );
  await flipFuses(executable, {
    version: FuseVersion.V1,
    strictlyRequireAllFuses: true,
    // electron-builder's Arch.arm64 enum value is 3.
    resetAdHocDarwinSignature: context.electronPlatformName === "darwin" && context.arch === 3,
    [FuseV1Options.RunAsNode]: false,
    [FuseV1Options.EnableCookieEncryption]: true,
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
    [FuseV1Options.EnableNodeCliInspectArguments]: false,
    [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
    [FuseV1Options.OnlyLoadAppFromAsar]: true,
    [FuseV1Options.LoadBrowserProcessSpecificV8Snapshot]: false,
    [FuseV1Options.GrantFileProtocolExtraPrivileges]: false,
    // Chromium and ReplayWeb.page use WebAssembly; retain its hardened trap handler.
    [FuseV1Options.WasmTrapHandlers]: true,
  });
};
