import type { NextConfig } from "next";

// Static export: the site is plain files, and scripts/csp.ts adds a
// hash-based Content-Security-Policy to each page after the build.
const config: NextConfig = {
  output: "export",
  reactCompiler: true,
  poweredByHeader: false,
  images: { unoptimized: true },
  // docs/ lives outside this app; the pages read it at build time.
  outputFileTracingRoot: new URL("../..", import.meta.url).pathname,
};

export default config;
