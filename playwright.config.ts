import { defineConfig, devices } from "@playwright/test";
import process from "node:process";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  expect: {
    timeout: 5_000,
  },
  fullyParallel: true,
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:5178",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "npx vite --host 127.0.0.1 --port 5178 --strictPort",
    url: "http://127.0.0.1:5178",
    reuseExistingServer: !process.env.CI,
    timeout: 45_000,
    env: {
      STREAMLINER_GRAPH: "public/example-project.json",
      STREAMLINER_SESSION_REGISTRY_ROOT: ".playwright/session-registry",
      STREAMLINER_COPILOT_SESSION_STATE_ROOT: ".playwright/copilot-session-state",
      STREAMLINER_SESSION_SIGNAL_SPOOL_ROOT: ".playwright/session-signals",
    },
  },
});
