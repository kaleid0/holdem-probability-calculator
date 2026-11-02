import { defineConfig } from "@playwright/test";

const backendPort = process.env.POKER_E2E_BACKEND_PORT || "8000";
const frontendPort = process.env.POKER_E2E_FRONTEND_PORT || "5173";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 30000,
  expect: { timeout: 10000 },
  use: {
    baseURL: `http://127.0.0.1:${frontendPort}`,
    channel: process.env.PLAYWRIGHT_CHANNEL || undefined,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: [
    {
      command: `uv run --project backend python -m uvicorn poker_calculator.api.main:app --host 127.0.0.1 --port ${backendPort}`,
      cwd: "..",
      url: `http://127.0.0.1:${backendPort}/health`,
      reuseExistingServer: !process.env.CI,
    },
    {
      command: `pnpm dev --host 127.0.0.1 --port ${frontendPort} --strictPort`,
      env: { POKER_API_URL: `http://127.0.0.1:${backendPort}` },
      url: `http://127.0.0.1:${frontendPort}`,
      reuseExistingServer: !process.env.CI,
    },
  ],
});
