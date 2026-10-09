-- Weekly team stats (and the manual overrides applied on top of them) were
-- keyed by week number alone, so a new season's Week 1 import overwrote the
-- previous season's Week 1, and archived leagues read the new season's
-- numbers. Every existing row is from Season 19, the only season imported so
-- far, so each is backfilled with that before the column becomes required.

-- TeamWeeklyStats
ALTER TABLE "TeamWeeklyStats" ADD COLUMN "season" INTEGER;
UPDATE "TeamWeeklyStats" SET "season" = 19;
ALTER TABLE "TeamWeeklyStats" ALTER COLUMN "season" SET NOT NULL;

DROP INDEX "TeamWeeklyStats_teamId_week_gamemode_key";
DROP INDEX "TeamWeeklyStats_week_gamemode_idx";
CREATE UNIQUE INDEX "TeamWeeklyStats_teamId_season_week_gamemode_key" ON "TeamWeeklyStats"("teamId", "season", "week", "gamemode");
CREATE INDEX "TeamWeeklyStats_season_week_gamemode_idx" ON "TeamWeeklyStats"("season", "week", "gamemode");

-- ManualStatsOverride
ALTER TABLE "ManualStatsOverride" ADD COLUMN "season" INTEGER;
UPDATE "ManualStatsOverride" SET "season" = 19;
ALTER TABLE "ManualStatsOverride" ALTER COLUMN "season" SET NOT NULL;

DROP INDEX "ManualStatsOverride_teamId_week_gamemode_key";
DROP INDEX "ManualStatsOverride_week_idx";
CREATE UNIQUE INDEX "ManualStatsOverride_teamId_season_week_gamemode_key" ON "ManualStatsOverride"("teamId", "season", "week", "gamemode");
CREATE INDEX "ManualStatsOverride_season_week_idx" ON "ManualStatsOverride"("season", "week");
