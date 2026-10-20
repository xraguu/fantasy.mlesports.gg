-- Live current-season per-player stats (the player-level counterpart to
-- TeamWeeklyStats), so the Team modal's roster table can show real
-- current-season numbers once the season starts, instead of only ever
-- showing last season's PlayerHistoricalStats.

-- CreateTable
CREATE TABLE "PlayerWeeklyStats" (
    "id" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "season" INTEGER NOT NULL,
    "week" INTEGER NOT NULL,
    "gamemode" TEXT NOT NULL,
    "goals" INTEGER NOT NULL,
    "shots" INTEGER NOT NULL,
    "saves" INTEGER NOT NULL,
    "assists" INTEGER NOT NULL,
    "demosInflicted" INTEGER NOT NULL,
    "demosTaken" INTEGER NOT NULL,
    "sprocketRating" DOUBLE PRECISION NOT NULL,
    "wins" INTEGER NOT NULL,
    "losses" INTEGER NOT NULL,

    CONSTRAINT "PlayerWeeklyStats_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PlayerWeeklyStats_playerId_season_week_gamemode_key" ON "PlayerWeeklyStats"("playerId", "season", "week", "gamemode");

-- CreateIndex
CREATE INDEX "PlayerWeeklyStats_season_week_gamemode_idx" ON "PlayerWeeklyStats"("season", "week", "gamemode");

-- AddForeignKey
ALTER TABLE "PlayerWeeklyStats" ADD CONSTRAINT "PlayerWeeklyStats_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "MLEPlayer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
