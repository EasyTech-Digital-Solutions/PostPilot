import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    env: {
      DATABASE_URL: "postgresql://postpilot:postpilot@localhost:5432/postpilot_test?schema=public",
      JWT_SECRET: "test-jwt-secret",
      ADMIN_PASSWORD: "test-admin-password",
      WEB_BASE_URL: "http://localhost:3000",
      META_APP_ID: "test-app-id",
      META_APP_SECRET: "test-app-secret",
    },
    setupFiles: ["./src/testSetup.ts"],
    // These integration tests share one real Postgres database (truncated
    // between tests) rather than mocking Prisma, so run test files
    // sequentially to avoid cross-file interference.
    fileParallelism: false,
  },
});
