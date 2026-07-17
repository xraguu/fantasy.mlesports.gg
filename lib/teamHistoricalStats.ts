import { prisma } from "./prisma";
import { calcFpts, getActiveScoringRules, ScoringRules } from "./scoringService";

export type HistoricalLens = "2s" | "3s" | "combined";

export interface TeamHistoricalStatsRow {
  teamId: string;
  season: string;
  goals: number;
  goalsAgainst: number;
  shots: number;
  shotsAgainst: number;
  saves: number;
  assists: number;
  demosInflicted: number;
  demosTaken: number;
  gamesPlayed: number;
  sprocketRating: number;
  seriesWins: number;
  seriesLosses: number;
  seriesRecord: string; // "W-L", e.g. "7-3" — one matches.csv row per series
  gameWins: number;
  gameLosses: number;
  gameRecord: string; // "W-L", e.g. "24-11" — individual games within those series
  fpts: number;
  avg: number; // fpts per series (seriesWins + seriesLosses) — fantasy points are scored per series, not per individual game
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
        goalsAgainst: acc.goalsAgainst + r.goalsAgainst,
        shots: acc.shots + r.shots,
        shotsAgainst: acc.shotsAgainst + r.shotsAgainst,
        saves: acc.saves + r.saves,
        assists: acc.assists + r.assists,
        demosInflicted: acc.demosInflicted + r.demosInflicted,
        demosTaken: acc.demosTaken + r.demosTaken,
        gamesPlayed: acc.gamesPlayed + r.gamesPlayed,
        sprocketRatingWeighted: acc.sprocketRatingWeighted + r.sprocketRating * r.gamesPlayed,
        seriesWins: acc.seriesWins + r.seriesWins,
        seriesLosses: acc.seriesLosses + r.seriesLosses,
        gameWins: acc.gameWins + r.gameWins,
        gameLosses: acc.gameLosses + r.gameLosses,
      }),
      {
        goals: 0, goalsAgainst: 0, shots: 0, shotsAgainst: 0, saves: 0, assists: 0,
        demosInflicted: 0, demosTaken: 0, gamesPlayed: 0, sprocketRatingWeighted: 0,
        seriesWins: 0, seriesLosses: 0, gameWins: 0, gameLosses: 0,
      }
    );

    const sprocketRating = totals.gamesPlayed > 0 ? totals.sprocketRatingWeighted / totals.gamesPlayed : 0;
    // The gameWin scoring bonus is per individual game (same as the live
    // weekly pipeline, where TeamWeeklyStats.wins is that week's game
    // score, not "1 win per series") — feed it game wins, not series wins.
    const fpts = calcFpts(
      {
        goals: totals.goals,
        shots: totals.shots,
        saves: totals.saves,
        assists: totals.assists,
        demosInflicted: totals.demosInflicted,
        demosTaken: totals.demosTaken,
        sprocketRating,
        wins: totals.gameWins,
      },
      activeRules
    );

    // Fantasy points are scored per series (best-of-5), not per individual
    // game — a season is ~10 series per mode, not ~50 games — so "average"
    // divides by series played, not raw games_played.
    const seriesPlayed = totals.seriesWins + totals.seriesLosses;
    const avg = seriesPlayed > 0 ? fpts / seriesPlayed : 0;

    result.set(teamId, {
      teamId,
      season,
      goals: totals.goals,
      goalsAgainst: totals.goalsAgainst,
      shots: totals.shots,
      shotsAgainst: totals.shotsAgainst,
      saves: totals.saves,
      assists: totals.assists,
      demosInflicted: totals.demosInflicted,
      demosTaken: totals.demosTaken,
      gamesPlayed: totals.gamesPlayed,
      sprocketRating: Math.round(sprocketRating * 100) / 100,
      seriesWins: totals.seriesWins,
      seriesLosses: totals.seriesLosses,
      seriesRecord: `${totals.seriesWins}-${totals.seriesLosses}`,
      gameWins: totals.gameWins,
      gameLosses: totals.gameLosses,
      gameRecord: `${totals.gameWins}-${totals.gameLosses}`,
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

/**
 * The season whose stats show as "last season" in the draft room — the
 * admin's configured SeasonSettings.draftStatsSeason, or the most recent
 * available (already Playoffs-excluded) season if nothing's configured yet.
 * Shared by every place that needs this "what season" answer, so it can't
 * drift between the draft state endpoint and a single team's stats lookup.
 */
export async function resolveDraftStatsSeason(): Promise<string | null> {
  const settings = await prisma.seasonSettings.findFirst({ orderBy: { season: "desc" } });
  if (settings?.draftStatsSeason) return settings.draftStatsSeason;
  const seasons = await getAvailableHistoricalSeasons();
  return seasons[0] ?? null;
}
