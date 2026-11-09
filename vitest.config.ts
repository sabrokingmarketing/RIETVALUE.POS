import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      "server-only": path.resolve(import.meta.dirname, "tests/support/empty.ts"),
    },
  },
  test: {
    include: ["tests/integration/**/*.test.ts"],
    environment: "node",
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 60000,
    env: {
      DATABASE_URL: process.env.TEST_DATABASE_URL || "postgres://nursery:nursery@localhost:5432/nursery_test",
      BETTER_AUTH_SECRET: "test-secret-test-secret-test-secret-1234",
      APP_URL: "http://localhost:3100",
      SETUP_TOKEN: "test-setup-token",
      NODE_ENV: "test",
    },
  },
});
