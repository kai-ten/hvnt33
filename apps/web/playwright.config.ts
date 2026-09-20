import { defineConfig } from "@playwright/test";

// Tests run against the exported site (npm run build first), served with the
// same clean URLs and headers Vercel will use.
export default defineConfig({
  testDir: "tests",
  fullyParallel: true,
  reporter: [["list"]],
  use: { baseURL: "http://127.0.0.1:4420", browserName: "chromium" },
  webServer: [
    { command: "node tests/fake-resend.ts --port 4421", url: "http://127.0.0.1:4421/_calls", reuseExistingServer: false },
    {
      command: "node scripts/serve.ts --port 4420", url: "http://127.0.0.1:4420", reuseExistingServer: false,
      env: { RESEND_API_KEY: "re_test", RESEND_SEGMENT_ID: "seg_test", NEWSLETTER_FROM: "HVNT33 <test@hvnt33.com>", NEWSLETTER_SECRET: "test-secret", SITE_URL: "http://127.0.0.1:4420", RESEND_API_URL: "http://127.0.0.1:4421", GITHUB_RELEASES_API_URL: "http://127.0.0.1:4421/github-releases" },
    },
  ],
});
