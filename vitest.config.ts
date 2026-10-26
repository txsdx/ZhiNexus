/** Limit unit-test discovery to source tests; Playwright owns browser integration specs. */
import { defineConfig } from "vitest/config";
export default defineConfig({
  test: { include: ["src/**/*.test.ts"], environment: "node" },
});
