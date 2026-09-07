import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "tests/browser",
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:5188",
    headless: true,
    screenshot: "only-on-failure",
  },
  webServer: [
    {
      command: "bun run dev",
      url: "http://127.0.0.1:5188",
      reuseExistingServer: !process.env.CI,
    },
    {
      command: "bun run bridge",
      url: "http://127.0.0.1:5189/bridge/status",
      reuseExistingServer: !process.env.CI,
    },
  ],
  timeout: 30000,
});
