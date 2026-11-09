import { defineConfig, devices } from "@playwright/test";

const PORT = 3100;
export const E2E_DB = process.env.E2E_DATABASE_URL || "postgres://nursery:nursery@localhost:5432/nursery_e2e";

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 10_000 },
  reporter: [["list"]],
  globalSetup: "./tests/e2e/global-setup.ts",
  use: { baseURL: `http://localhost:${PORT}`, trace: "off", screenshot: "only-on-failure" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1366, height: 860 } } },
  ],
  webServer: {
    // Production build against the dedicated e2e database
    command: `npm run db:migrate && npm run build && npm run start`,
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 540_000,
    env: {
      PORT: String(PORT),
      DATABASE_URL: E2E_DB,
      APP_URL: `http://localhost:${PORT}`,
      BETTER_AUTH_SECRET: "e2e-secret-e2e-secret-e2e-secret-123456",
      SETUP_TOKEN: "e2e-setup-token",
      UPLOAD_DIR: "./test-results/uploads",
      NEXT_DIST_DIR: ".next-e2e",
      AUTH_RATE_LIMIT: "off",
    },
  },
});
