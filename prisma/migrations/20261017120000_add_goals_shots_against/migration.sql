-- Goals and shots against, so weekly fantasy scoring (lib/scoringService.ts
-- calcFpts) can use every scoring option in Admin Settings, and admins can
-- enter them in a manual stats override. Both default to 0, so existing rows
-- keep working; the stats refresh fills in the current season's values.

-- AlterTable
ALTER TABLE "TeamWeeklyStats" ADD COLUMN "goalsAgainst" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "shotsAgainst" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "ManualStatsOverride" ADD COLUMN "goalsAgainst" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "shotsAgainst" INTEGER NOT NULL DEFAULT 0;
