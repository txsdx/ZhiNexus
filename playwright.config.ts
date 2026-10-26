/** Isolated browser integration server avoids sharing hot-reloaded application state with manual development. */
import { defineConfig } from "@playwright/test";
const port = process.env.TEST_PORT ?? "1421";
export default defineConfig({
  testDir: "tests",
  timeout: 60000,
  workers: 1,
  expect: { timeout: 15000 },
  use: {
    baseURL: `http://localhost:${port}`,
    locale: "zh-CN",
    viewport: { width: 1440, height: 1000 },
    launchOptions: {
      executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
      args: ["--no-sandbox"],
    },
  },
  webServer: {
    command: `npm run dev -- --port ${port}`,
    url: `http://localhost:${port}`,
    reuseExistingServer: false,
  },
  reporter: "list",
});
