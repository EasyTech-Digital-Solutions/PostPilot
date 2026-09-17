-- Reconciles environments where an abandoned "post_variants" refactor
-- (never committed to this migration history, but previously applied to
-- some long-lived dev databases) moved captions off `posts` and expanded
-- the `Platform` enum. Brings the schema back in line with the current
-- `posts.fbCaption`/`igCaption` columns without losing existing data.

-- Add the columns back, nullable for now so we can backfill.
ALTER TABLE "posts"
  ADD COLUMN IF NOT EXISTS "fbCaption" TEXT,
  ADD COLUMN IF NOT EXISTS "fbHashtags" TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS "igCaption" TEXT,
  ADD COLUMN IF NOT EXISTS "igHashtags" TEXT[] NOT NULL DEFAULT '{}';

-- Backfill from post_variants where it exists; posts with no variant for a
-- platform fall back to an empty caption rather than losing the row.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'post_variants') THEN
    UPDATE "posts" p
    SET "fbCaption" = COALESCE(v.caption, ''),
        "fbHashtags" = COALESCE(v.hashtags, '{}')
    FROM (SELECT "postId", caption, hashtags FROM "post_variants" WHERE platform = 'FACEBOOK') v
    WHERE v."postId" = p.id;

    UPDATE "posts" p
    SET "igCaption" = COALESCE(v.caption, ''),
        "igHashtags" = COALESCE(v.hashtags, '{}')
    FROM (SELECT "postId", caption, hashtags FROM "post_variants" WHERE platform = 'INSTAGRAM') v
    WHERE v."postId" = p.id;
  END IF;
END $$;

-- Any remaining NULLs (posts that never had a variant row for a platform).
UPDATE "posts" SET "fbCaption" = '' WHERE "fbCaption" IS NULL;
UPDATE "posts" SET "igCaption" = '' WHERE "igCaption" IS NULL;

ALTER TABLE "posts"
  ALTER COLUMN "fbCaption" SET NOT NULL,
  ALTER COLUMN "igCaption" SET NOT NULL;

DROP TABLE IF EXISTS "post_variants";

-- Shrink the Platform enum back to what the current schema declares. Safe
-- only because no rows anywhere reference the extra values; guarded so it
-- still no-ops cleanly if the enum was never widened in a given environment.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'Platform' AND e.enumlabel NOT IN ('FACEBOOK', 'INSTAGRAM')
  ) THEN
    IF EXISTS (SELECT 1 FROM "social_accounts" WHERE platform::text NOT IN ('FACEBOOK', 'INSTAGRAM'))
      OR EXISTS (SELECT 1 FROM "publish_history" WHERE platform::text NOT IN ('FACEBOOK', 'INSTAGRAM')) THEN
      RAISE EXCEPTION 'Refusing to shrink Platform enum: rows reference a platform outside FACEBOOK/INSTAGRAM';
    END IF;

    ALTER TYPE "Platform" RENAME TO "Platform_old";
    CREATE TYPE "Platform" AS ENUM ('FACEBOOK', 'INSTAGRAM');
    ALTER TABLE "social_accounts" ALTER COLUMN platform TYPE "Platform" USING platform::text::"Platform";
    ALTER TABLE "publish_history" ALTER COLUMN platform TYPE "Platform" USING platform::text::"Platform";
    DROP TYPE "Platform_old";
  END IF;
END $$;
