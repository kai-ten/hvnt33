// The rules the native side enforces (src/main/policy.ts).
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  allowedNavigation, decodeScriptResult, downloadDestination, hasRequiredFeatures, imageExtension, imageFilename, isAgentSessionMarker,
  isE2EPartition, isLoopback, isTabLabel, normalizeServerUrl, parseEnv, parseRoute, parseWebUrl, partitionFor, portFromEnvFile,
  safeFileName, unusedPath, validApiPath,
} from "../src/main/policy";
import { isNewerVersion, newestPublicRelease } from "../src/main/update-policy";

const A = "2c58bca3-e533-443b-b29c-efe6e375eeb5";
const B = "e5eb201c-369c-4857-ba5e-075df4b517e7";

describe("browsed tabs", () => {
  it("only web pages are navigable", () => {
    for (const ok of ["https://example.org/x", "http://127.0.0.1:8080/", "about:blank", "blob:https://example.org/1-2"]) expect(allowedNavigation(ok), ok).toBe(true);
    for (const bad of ["file:///etc/passwd", "app://hvnt33/index.html", "javascript:alert(1)", "data:text/html,<script>1</script>", "about:config", "chrome://settings", "devtools://devtools/x", "x-apple-systempreferences:com.apple", "not a url"]) expect(allowedNavigation(bad), bad).toBe(false);
    expect(() => parseWebUrl("not a url")).toThrow();
    expect(() => parseWebUrl("file:///etc/hosts")).toThrow(/http/);
  });

  it("tab labels cannot name the app view", () => {
    expect(isTabLabel("tab-3f2a9c")).toBe(true);
    for (const bad of ["app", "main", "tab-", "tab-../x", "tab-a b", "TAB-1", 7, null]) expect(isTabLabel(bad), String(bad)).toBe(false);
  });

  it("routes are plain proxy addresses", () => {
    expect(parseRoute("socks5://127.0.0.1:9050")).toBe("socks5://127.0.0.1:9050");
    expect(parseRoute(" socks5h://10.64.0.1:1080 ")).toBe("socks5://10.64.0.1:1080");
    expect(parseRoute("http://proxy.example:8080/")).toBe("http://proxy.example:8080");
    for (const bad of ["https://proxy.example:443", "socks5://127.0.0.1", "socks5://u:p@host:1080", "file:///etc/hosts", "nonsense", ""]) expect(() => parseRoute(bad), bad).toThrow();
  });
});

describe("release notifications", () => {
  it("compares stable and prerelease versions", () => {
    expect(isNewerVersion("0.1.0", "0.1.1")).toBe(true);
    expect(isNewerVersion("0.2.0", "0.1.9")).toBe(false);
    expect(isNewerVersion("1.0.0-beta.1", "1.0.0")).toBe(true);
    expect(isNewerVersion("1.0.0", "1.1.0-beta.1")).toBe(true);
    expect(isNewerVersion("not-a-version", "2.0.0")).toBe(false);
  });

  it("accepts only published releases from the HVNT33 repository", () => {
    const release = newestPublicRelease([
      { draft: true, tag_name: "v9.0.0", html_url: "https://github.com/kai-ten/hvnt33/releases/tag/v9.0.0", published_at: "2026-09-20T00:00:00Z" },
      { draft: false, tag_name: "v0.2.0", name: "HVNT33 v0.2.0", html_url: "https://github.com/kai-ten/hvnt33/releases/tag/v0.2.0", published_at: "2026-09-20T00:00:00Z", prerelease: false },
    ]);
    expect(release).toMatchObject({ version: "0.2.0", prerelease: false });
    expect(newestPublicRelease([{ draft: false, tag_name: "v8.0.0", html_url: "https://evil.example/release", published_at: "2026-09-20T00:00:00Z" }])).toBe(null);
  });
});

describe("profiles", () => {
  it("map to distinct, stable sessions", () => {
    expect(partitionFor(A)).toBe(partitionFor(A));
    expect(partitionFor(A)).not.toBe(partitionFor(B));
    expect(partitionFor(A)).not.toBe(partitionFor("shared"));
    expect(partitionFor("shared")).toBe("persist:shared");
    expect(() => partitionFor("../etc")).toThrow();
    expect(() => partitionFor("")).toThrow();
  });

  it("each route has its own session within a case", () => {
    const tor = partitionFor(A, "tor");
    const vpn = partitionFor(A, "socks5://10.64.0.1:1080");
    expect(partitionFor(A, "")).toBe(partitionFor(A));
    expect(tor).not.toBe(partitionFor(A));
    expect(tor).not.toBe(vpn);
    expect(tor).toBe(partitionFor(A, "tor"));
    expect(tor).not.toBe(partitionFor(B, "tor"));
  });

  it("end-to-end runs never share the researcher's sessions", () => {
    for (const p of [partitionFor(A), partitionFor("shared"), partitionFor(A, "tor")]) expect(isE2EPartition(p)).toBe(false);
    const test = partitionFor(A, "tor", "0badf00d");
    expect(isE2EPartition(test)).toBe(true);
    expect(test).not.toBe(partitionFor(A, "tor"));
    expect(partitionFor(A, "", "0badf00d")).not.toBe(partitionFor(A, "", "12345678"));
  });
});

describe("server bridge", () => {
  it("API paths are confined to the API", () => {
    expect(validApiPath("/api/investigations")).toBe(true);
    expect(validApiPath("/api/investigations/3f2a-11/searches?limit=500")).toBe(true);
    for (const bad of ["/files/x", "http://evil/api/x", "/api/../vault", "/api//x", "/api/x y", "/api/x#y", "api/x", "/api/x\n", 3]) expect(validApiPath(bad), String(bad)).toBe(false);
  });

  it("detects servers that predate the app's routes", () => {
    expect(hasRequiredFeatures({ ok: true, features: ["search-runs", "browser-capture", "page-visits", "saved-searches", "archive", "snapshots", "watches", "later"] })).toBe(true);
    expect(hasRequiredFeatures({ ok: true, database: "ArcadeDB" })).toBe(false);
    expect(hasRequiredFeatures({ features: ["search-runs", "browser-capture", "page-visits", "saved-searches", "archive"] })).toBe(false);
  });

  it("server addresses are origins and remote ones need https", () => {
    expect(normalizeServerUrl("https://hvnt33.example.org/some/path?x=1")).toBe("https://hvnt33.example.org");
    expect(normalizeServerUrl("http://127.0.0.1:4310/")).toBe("http://127.0.0.1:4310");
    expect(normalizeServerUrl("http://localhost:4310")).toBe("http://localhost:4310");
    expect(() => normalizeServerUrl("http://hvnt33.example.org")).toThrow(/https/);
    for (const bad of ["ftp://example.org", "not a url", "file:///etc/passwd"]) expect(() => normalizeServerUrl(bad), bad).toThrow();
    expect(isLoopback("http://127.0.0.1:4310")).toBe(true);
    expect(isLoopback("https://127.0.0.1.example.org")).toBe(false);
  });

  it("reads PORT from .env", () => {
    expect(portFromEnvFile("ARCADEDB_URL=x\nPORT=4312\n")).toBe(4312);
    expect(portFromEnvFile('PORT="4400"')).toBe(4400);
    expect(portFromEnvFile("#PORT=1\nOTHER_PORT=2")).toBe(null);
    expect(portFromEnvFile("PORT=abc")).toBe(null);
  });
});

describe("files", () => {
  it("downloads get safe names and never overwrite", () => {
    expect(safeFileName("../../etc/passwd")).toBe("-..-etc-passwd");
    expect(safeFileName(".hidden")).toBe("hidden");
    expect(safeFileName("hvnt33 evidence example.com 2026-09-18.zip")).toBe("hvnt33 evidence example.com 2026-09-18.zip");
    expect(safeFileName("a/b\\c\n.zip")).toBe("a-b-c-.zip");
    expect(safeFileName("")).toBe("download");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hvnt33-dl-"));
    try {
      expect(unusedPath(dir, "e.zip")).toBe(path.join(dir, "e.zip"));
      fs.writeFileSync(path.join(dir, "e.zip"), "x");
      fs.writeFileSync(path.join(dir, "e (2).zip"), "x");
      expect(unusedPath(dir, "e.zip")).toBe(path.join(dir, "e (3).zip"));
      fs.writeFileSync(path.join(dir, "README"), "x");
      expect(unusedPath(dir, "README")).toBe(path.join(dir, "README (2)"));
      const first = downloadDestination(dir, "https://example.org/files/report.pdf?x=1");
      expect(first).toBe(path.join(dir, "report.pdf"));
      fs.writeFileSync(first, "x");
      expect(downloadDestination(dir, "https://example.org/files/report.pdf")).toBe(path.join(dir, "report (1).pdf"));
      expect(downloadDestination(dir, "https://example.org/")).toBe(path.join(dir, "download"));
      expect(path.dirname(downloadDestination(dir, "https://example.org/..%2F..%2Fetc%2Fpasswd"))).toBe(dir);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("only images are archived, with safe names", () => {
    expect(imageExtension("image/jpeg; charset=binary")).toBe("jpg");
    expect(imageExtension("text/html")).toBe(null);
    expect(imageExtension("")).toBe(null);
    expect(imageFilename("https://cdn.example/a/Award%20Photo.final.JPG?w=800", "jpg")).toBe("Award20Photofinal.jpg");
    expect(imageFilename("https://cdn.example/../../etc/passwd", "png")).toBe("passwd.png");
    expect(imageFilename("https://cdn.example/", "png")).toBe("captured-image.png");
  });
});

describe("page scripts and terminal", () => {
  it("script results decode from either JSON layer", () => {
    expect(decodeScriptResult('{"a":1}').a).toBe(1);
    expect(decodeScriptResult({ a: 1 }).a).toBe(1);
    expect(decodeScriptResult(JSON.stringify(JSON.stringify({ a: 1 }))).a).toBe(1);
    for (const bad of ["null", '"just text"', "garbage", null, [1]]) expect(() => decodeScriptResult(bad)).toThrow();
  });

  it("session markers are stripped but configuration travels", () => {
    for (const k of ["CLAUDECODE", "CLAUDE_CODE_SESSION_ID", "CLAUDE_CODE_MESSAGING_TOKEN", "AI_AGENT"]) expect(isAgentSessionMarker(k), k).toBe(true);
    for (const k of ["PATH", "HOME", "ANTHROPIC_API_KEY", "CLAUDE_CONFIG_DIR", "CLAUDE_CODE_USE_BEDROCK"]) expect(isAgentSessionMarker(k), k).toBe(false);
  });

  it("login shell environment is read after the marker only", () => {
    const M = "__HVNT33_ENV_7f3a__";
    const env = parseEnv(`Welcome banner PATH=/evil\n${M}\nPATH=/usr/bin:/opt/homebrew/bin\nHOME=/Users/me\n  continuation\nBAD KEY=x\n`, M);
    expect(env).toEqual({ PATH: "/usr/bin:/opt/homebrew/bin", HOME: "/Users/me" });
    expect(parseEnv("PATH=/x\n", M)).toEqual({});
  });
});

describe("routes in Chromium", () => {
  it("send everything through the route, loopback included; direct uses no proxy", async () => {
    const { proxyConfig } = await import("../src/main/policy");
    expect(proxyConfig("socks5://127.0.0.1:9050")).toEqual({ proxyRules: "socks5://127.0.0.1:9050", proxyBypassRules: "<-loopback>" });
    expect(proxyConfig("")).toEqual({ mode: "direct" });
  });
});
