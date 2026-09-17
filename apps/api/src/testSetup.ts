import { beforeEach } from "vitest";
import { prisma } from "@postpilot/db";

// Integration tests hit a real Postgres (see vitest.config.mts for the
// dedicated postpilot_test database and required env vars). Truncate
// everything before each test so tests don't leak state into each other,
// without needing to re-run migrations per test.
beforeEach(async () => {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      "publish_history",
      "schedule_targets",
      "schedules",
      "posts",
      "media",
      "social_accounts"
    RESTART IDENTITY CASCADE
  `);
});
