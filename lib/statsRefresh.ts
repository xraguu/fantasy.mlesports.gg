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

function mergeImportResults(a: ImportResult, b: ImportResult): ImportResult {
  return {
    imported: a.imported + b.imported,
    skipped: a.skipped + b.skipped,
    manualOverrides: a.manualOverrides + b.manualOverrides,
    matchesFound: a.matchesFound + b.matchesFound,
    errors: [...a.errors, ...b.errors],
    teams: [...a.teams, ...b.teams],
  };
}

function mergeCalculateResults(a: ScoreCalculationResult, b: ScoreCalculationResult): ScoreCalculationResult {
  return {
    slotsScored: a.slotsScored + b.slotsScored,
    matchupsUpdated: a.matchupsUpdated + b.matchupsUpdated,
    teamsWithNoStats: [...new Set([...a.teamsWithNoStats, ...b.teamsWithNoStats])],
  };
}

/**
 * The single "refresh everything" action: re-imports Sprocket stats and
 * recalculates fantasy scores for every week from 1 through the current
 * calendar week, then returns the combined totals. Shared by the scheduled
 * cron job (every 120 minutes) and the admin's manual "Re-import" button on
 * the Manual Stats page — both do exactly the same thing, one on a timer and
 * one on demand.
 *
 * Walks every week (not just "current") because this sweep isn't guaranteed
 * to actually run during every single week's window — the server could be
 * down, mid-deploy, or the timer could simply not have fired yet when a
 * week's matches started. Since `current` only ever moves forward, jumping
 * straight to it would silently and permanently strand any week it missed:
 * confirmed live, weeks 5 through 9 sat completely unscored (and playoffs
 * never auto-generated, since that only fires as a side effect of scoring
 * the regular season's final week) once the calendar had already moved on
 * to week 10. Each individual week is still gated on its own matchStart via
 * calculateScoresForWeek/haveMatchesStarted below, and re-scoring an
 * already-correct week is a harmless no-op, so it's safe to re-walk the
 * whole range on every pass rather than tracking a separate "last scored
 * week" cursor.
 */
export async function runStatsRefresh(triggeredByUserId?: string): Promise<StatsRefreshResult> {
  const current = await getCurrentSeasonWeek();
  if (!current) {
    throw new Error(
      "Could not determine the current season/week — configure week dates in Settings first."
    );
  }

  let importResult = EMPTY_IMPORT;
  let calculateResult = EMPTY_CALCULATE;

  for (let week = 1; week <= current.week; week++) {
    // Nothing to refresh ahead of that week's real matches actually
    // starting — importing real stats (let alone scoring them) before then
    // would surface results for games that, fantasy-wise, haven't happened
    // yet. calculateScoresForWeek enforces this too (and admins hitting the
    // manual recalculate tools directly still get a clear rejection message
    // for it there), but checking it here first means this loop quietly
    // stops at the first not-yet-started week instead of logging a
    // "refresh failed" error every cycle for something that isn't actually
    // a failure.
    if (!(await haveMatchesStarted(current.season, week))) break;

    const weekImport = await importSprocketStatsForWeek(week, current.season);
    const weekCalculate = await calculateScoresForWeek(week, undefined, triggeredByUserId);
    importResult = mergeImportResults(importResult, weekImport);
    calculateResult = mergeCalculateResults(calculateResult, weekCalculate);
  }

  return {
    season: current.season,
    week: current.week,
    import: importResult,
    calculate: calculateResult,
  };
}
