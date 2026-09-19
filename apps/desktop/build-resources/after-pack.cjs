// electron-builder leaves folders named node_modules out of extra resources.
// Copy the server's npm dependencies in after packing (before signing).
const fs = require("node:fs");
const path = require("node:path");
const { flipFuses, FuseVersion, FuseV1Options } = require("@electron/fuses");

exports.default = async function afterPack(context) {
  const resources = context.electronPlatformName === "darwin"
    ? path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, "Contents", "Resources")
    : path.join(context.appOutDir, "resources");
  const from = path.join(__dirname, "..", "build", "hvnt33", "node_modules");
  const to = path.join(resources, "hvnt33", "node_modules");
  if (!fs.existsSync(from)) throw new Error("The server's dependencies were not staged (run scripts/package.ts)");
  fs.cpSync(from, to, { recursive: true, dereference: true });

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
