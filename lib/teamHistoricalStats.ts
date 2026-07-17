import { prisma } from "./prisma";
import { calcFpts, getActiveScoringRules, ScoringRules } from "./scoringService";

export type HistoricalLens = "2s" | "3s" | "combined";

export interface TeamHistoricalStatsRow {
  teamId: string;
  season: string;
  goals: number;
  shots: number;
  saves: number;
  assists: number;
  demosInflicted: number;
  demosTaken: number;
  gamesPlayed: number;
  sprocketRating: number;
  wins: number;
  losses: number;
  record: string; // "W-L", e.g. "7-3"
  fpts: number;
  avg: number; // fpts per series (wins + losses) — fantasy points are scored per series, not per individual game
}

/**
 * Team-level "last season" stats for a chosen gamemode lens, sourced from
 * TeamHistoricalStats (imported from historicalAggregatedPlayerStats.csv for
 * raw stats, cross-referenced with matches.csv/match_groups.csv for real
 * series win/loss records — see scripts/import-csv-data.ts's
 * importTeamHistoricalStats/computeSeriesRecords). Unlike
 * lib/teamSeasonStats.ts (live in-progress season, week by week), this reads
 * a single pre-aggregated row per team/season/gamemode, since old seasons'
 * weekly data doesn't stick around in TeamWeeklyStats.
 */
export async function getTeamHistoricalStats(
  season: string,
  lens: HistoricalLens,
  rules?: ScoringRules
): Promise<Map<string, TeamHistoricalStatsRow>> {
  const activeRules = rules ?? (await getActiveScoringRules());

  const rows = await prisma.teamHistoricalStats.findMany({
    where: { season, gamemode: lens === "combined" ? { in: ["2s", "3s"] } : lens },
  });

  const byTeam = new Map<string, { "2s"?: (typeof rows)[number]; "3s"?: (typeof rows)[number] }>();
  for (const r of rows) {
    if (!byTeam.has(r.teamId)) byTeam.set(r.teamId, {});
    byTeam.get(r.teamId)![r.gamemode as "2s" | "3s"] = r;
  }

  const result = new Map<string, TeamHistoricalStatsRow>();
  for (const [teamId, modes] of byTeam) {
    const rowsToSum = lens === "combined"
      ? [modes["2s"], modes["3s"]].filter((r): r is NonNullable<typeof r> => !!r)
      : [modes[lens]].filter((r): r is NonNullable<typeof r> => !!r);

    if (rowsToSum.length === 0) continue;

    const totals = rowsToSum.reduce(
      (acc, r) => ({
        goals: acc.goals + r.goals,
        shots: acc.shots + r.shots,
        saves: acc.saves + r.saves,
        assists: acc.assists + r.assists,
        demosInflicted: acc.demosInflicted + r.demosInflicted,
        demosTaken: acc.demosTaken + r.demosTaken,
        gamesPlayed: acc.gamesPlayed + r.gamesPlayed,
        sprocketRatingWeighted: acc.sprocketRatingWeighted + r.sprocketRating * r.gamesPlayed,
        wins: acc.wins + r.wins,
        losses: acc.losses + r.losses,
      }),
      { goals: 0, shots: 0, saves: 0, assists: 0, demosInflicted: 0, demosTaken: 0, gamesPlayed: 0, sprocketRatingWeighted: 0, wins: 0, losses: 0 }
    );

    const sprocketRating = totals.gamesPlayed > 0 ? totals.sprocketRatingWeighted / totals.gamesPlayed : 0;
    const fpts = calcFpts(
      {
        goals: totals.goals,
        shots: totals.shots,
        saves: totals.saves,
        assists: totals.assists,
        demosInflicted: totals.demosInflicted,
        demosTaken: totals.demosTaken,
        sprocketRating,
        wins: totals.wins,
      },
      activeRules
    );

    // Fantasy points are scored per series (best-of-5), not per individual
    // game — a season is ~10 series per mode, not ~50 games — so "average"
    // divides by series played (wins + losses), not raw games_played.
    const seriesPlayed = totals.wins + totals.losses;
    const avg = seriesPlayed > 0 ? fpts / seriesPlayed : 0;

    result.set(teamId, {
      teamId,
      season,
      goals: totals.goals,
      shots: totals.shots,
      saves: totals.saves,
      assists: totals.assists,
      demosInflicted: totals.demosInflicted,
      demosTaken: totals.demosTaken,
      gamesPlayed: totals.gamesPlayed,
      sprocketRating: Math.round(sprocketRating * 100) / 100,
      wins: totals.wins,
      losses: totals.losses,
      record: `${totals.wins}-${totals.losses}`,
      fpts: Math.round(fpts * 10) / 10,
      avg: Math.round(avg * 10) / 10,
    });
  }

  return result;
}

/**
 * Distinct REGULAR SEASON labels available in TeamHistoricalStats, newest
 * first (string sort desc — safe here since every label is "Season N" with
 * N in the same digit-count range). "Season N Playoffs" rows are excluded
 * entirely: they're a much smaller, narrower sample (a handful of playoff
 * series) than a full season, never what "last season's stats" should mean
 * for draft prep — and a Playoffs label would otherwise sort ahead of its
 * own season (e.g. "Season 19 Playoffs" > "Season 19" lexicographically),
 * silently becoming the default "current season" for the draft room.
 */
export async function getAvailableHistoricalSeasons(): Promise<string[]> {
  const rows = await prisma.teamHistoricalStats.findMany({
    where: { NOT: { season: { contains: "Playoffs" } } },
    distinct: ["season"],
    select: { season: true },
  });
  return rows.map((r) => r.season).sort().reverse();
}
