-- Store the video brief (worked example, literal values, key terms, beat sheet,
-- scope note) alongside the storyboard so a scene retried later can reuse it.
--
-- Additive and nullable: existing rows are unaffected and no backfill is needed.
-- Storyboards created before this migration simply have NULL, and the code
-- treats that exactly as it treated "no brief" before.
ALTER TABLE "Storyboard" ADD COLUMN "brief" TEXT;
