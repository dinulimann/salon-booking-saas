import { defineConfig, devices } from "@playwright/test";

const PORT = 3100;
export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  workers: 1,
  reporter: [["list"]],
  use: { baseURL: `http://localhost:${PORT}`, locale: "id-ID", timezoneId: "Asia/Jakarta", trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  // The app talks to tools/fake-midtrans.mjs (see .github/workflows/ci.yml for the env).
  webServer: [
    { command: "node tools/fake-midtrans.mjs", port: 4010, reuseExistingServer: true },
    { command: `npx next start -p ${PORT}`, port: PORT, reuseExistingServer: true, timeout: 120_000 },
  ],
});
