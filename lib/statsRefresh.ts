import { importSprocketStatsForWeek, ImportResult } from "@/lib/sprocketStats";
import { calculateScoresForWeek, ScoreCalculationResult } from "@/lib/scoringService";
import { getCurrentSeasonWeek } from "@/lib/currentWeek";
import { haveMatchesStarted } from "@/lib/autoLock";

export interface StatsRefreshResult {
  season: number;
  week: number;
  import: ImportResult;
  calculate: ScoreCalculationResult;
}

const EMPTY_IMPORT: ImportResult = { imported: 0, skipped: 0, manualOverrides: 0, matchesFound: 0, errors: [], teams: [] };
const EMPTY_CALCULATE: ScoreCalculationResult = { slotsScored: 0, matchupsUpdated: 0, teamsWithNoStats: [] };

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

  // Nothing to refresh ahead of the current week's real matches actually
  // starting — importing real stats (let alone scoring them) before then
  // would surface results for games that, fantasy-wise, haven't happened
  // yet. calculateScoresForWeek enforces this too (and admins hitting the
  // manual recalculate tools directly still get a clear rejection message
  // for it there), but checking it here first means the routine automatic
  // cron pass — which hits this every single cycle until matchStart finally
  // arrives — skips quietly instead of logging a "refresh failed" error
  // every 2 hours for something that isn't actually a failure.
  if (!(await haveMatchesStarted(current.season, current.week))) {
    return {
      season: current.season,
      week: current.week,
      import: EMPTY_IMPORT,
      calculate: EMPTY_CALCULATE,
    };
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
