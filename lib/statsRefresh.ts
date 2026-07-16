import { importSprocketStatsForWeek, ImportResult } from "@/lib/sprocketStats";
import { calculateScoresForWeek, ScoreCalculationResult } from "@/lib/scoringService";
import { getCurrentSeasonWeek } from "@/lib/currentWeek";

export interface StatsRefreshResult {
  season: number;
  week: number;
  import: ImportResult;
  calculate: ScoreCalculationResult;
}

/**
 * The single "refresh everything" action: re-imports Sprocket stats for the
 * current week, then recalculates fantasy scores from the result. Shared by
 * the scheduled cron job (every 120 minutes) and the admin's manual
 * "Re-import" button on the Manual Stats page — both do exactly the same
 * thing, one on a timer and one on demand.
 */
export async function runStatsRefresh(triggeredByUserId?: string): Promise<StatsRefreshResult> {
  const current = await getCurrentSeasonWeek();
  if (!current) {
    throw new Error(
      "Could not determine the current season/week — configure week dates in Settings first."
    );
  }

  const importResult = await importSprocketStatsForWeek(current.week, current.season);
  const calculateResult = await calculateScoresForWeek(current.week, undefined, triggeredByUserId);

  return {
    season: current.season,
    week: current.week,
    import: importResult,
    calculate: calculateResult,
  };
}
