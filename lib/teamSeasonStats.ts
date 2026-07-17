import { prisma } from "./prisma";
import { calcFpts, getActiveScoringRules, ScoringRules } from "./scoringService";

export type GamemodeLens = "2s" | "3s" | "combined" | "bestball";

/** Maps a RosterSlot's position to the gamemode lens that should score it. */
export function lensForPosition(position: string): GamemodeLens {
  if (position === "2s") return "2s";
  if (position === "3s") return "3s";
  return "bestball"; // flx / be
}

export interface TeamSeasonStatsRow {
  teamId: string;
  goals: number;
  shots: number;
  saves: number;
  assists: number;
  demosInflicted: number;
  demosTaken: number;
  wins: number;
  losses: number;
  record: string;
  fpts: number; // cumulative, weeks 1..throughWeek
  avg: number; // fpts / weeksPlayed
  score: number; // throughWeek's own fpts
  last: number; // (throughWeek - 1)'s fpts
  bestWeek: number; // highest single-week fpts, weeks 1..throughWeek
  weeksPlayed: number;
}

type StatsRow = {
  goals: number;
  shots: number;
  saves: number;
  assists: number;
  demosInflicted: number;
  demosTaken: number;
  sprocketRating: number;
  wins: number;
  losses: number;
};

const EMPTY_STATS: StatsRow = {
  goals: 0,
  shots: 0,
  saves: 0,
  assists: 0,
  demosInflicted: 0,
  demosTaken: 0,
  sprocketRating: 0,
  wins: 0,
  losses: 0,
};

function addStats(a: StatsRow, b: StatsRow): StatsRow {
  return {
    goals: a.goals + b.goals,
    shots: a.shots + b.shots,
    saves: a.saves + b.saves,
    assists: a.assists + b.assists,
    demosInflicted: a.demosInflicted + b.demosInflicted,
    demosTaken: a.demosTaken + b.demosTaken,
    sprocketRating: a.sprocketRating + b.sprocketRating,
    wins: a.wins + b.wins,
    losses: a.losses + b.losses,
  };
}

/**
 * Resolves one team's per-week contribution under a given lens.
 * Returns null if the team has no stats at all for that week under this lens.
 */
function resolveWeek(
  modes: { "2s"?: StatsRow; "3s"?: StatsRow },
  lens: GamemodeLens,
  rules: ScoringRules
): { stats: StatsRow; fpts: number } | null {
  if (lens === "2s") {
    return modes["2s"] ? { stats: modes["2s"], fpts: calcFpts(modes["2s"], rules) } : null;
  }
  if (lens === "3s") {
    return modes["3s"] ? { stats: modes["3s"], fpts: calcFpts(modes["3s"], rules) } : null;
  }
  if (lens === "combined") {
    if (!modes["2s"] && !modes["3s"]) return null;
    const twoS = modes["2s"] ?? EMPTY_STATS;
    const threeS = modes["3s"] ?? EMPTY_STATS;
    const fpts =
      (modes["2s"] ? calcFpts(modes["2s"], rules) : 0) +
      (modes["3s"] ? calcFpts(modes["3s"], rules) : 0);
    return { stats: addStats(twoS, threeS), fpts };
  }
  // bestball: whichever mode scored higher that week; raw stats come from that
  // same winning mode (keeps a displayed stat line internally consistent).
  const twoSFpts = modes["2s"] ? calcFpts(modes["2s"], rules) : null;
  const threeSFpts = modes["3s"] ? calcFpts(modes["3s"], rules) : null;
  if (twoSFpts === null && threeSFpts === null) return null;
  if (threeSFpts === null || (twoSFpts !== null && twoSFpts >= threeSFpts)) {
    return { stats: modes["2s"]!, fpts: twoSFpts! };
  }
  return { stats: modes["3s"]!, fpts: threeSFpts };
}

/**
 * Computes cumulative season stats (through a given week) for a set of MLE
 * teams, under a chosen gamemode lens. Cumulative fpts is always the sum of
 * each week's already-computed fpts — never recomputed from aggregated raw
 * totals, since sprocketRating is a per-week average, not additive.
 */
export async function getTeamSeasonStats(input: {
  teamIds: string[];
  throughWeek: number;
  lens: GamemodeLens;
  rules?: ScoringRules;
}): Promise<Map<string, TeamSeasonStatsRow>> {
  const { teamIds, throughWeek, lens } = input;
  const rules = input.rules ?? (await getActiveScoringRules());

  const rows = await prisma.teamWeeklyStats.findMany({
    where: { teamId: { in: teamIds }, week: { lte: throughWeek, gte: 1 } },
  });

  // teamId -> week -> { "2s"?: row, "3s"?: row }
  const byTeamWeek = new Map<string, Map<number, { "2s"?: StatsRow; "3s"?: StatsRow }>>();
  for (const r of rows) {
    if (!byTeamWeek.has(r.teamId)) byTeamWeek.set(r.teamId, new Map());
    const weekMap = byTeamWeek.get(r.teamId)!;
    if (!weekMap.has(r.week)) weekMap.set(r.week, {});
    weekMap.get(r.week)![r.gamemode as "2s" | "3s"] = r;
  }

  const result = new Map<string, TeamSeasonStatsRow>();

  for (const teamId of teamIds) {
    const weekMap = byTeamWeek.get(teamId);
    let totals: StatsRow = { ...EMPTY_STATS };
    let fptsTotal = 0;
    let weeksPlayed = 0;
    const fptsByWeek = new Map<number, number>();

    for (let week = 1; week <= throughWeek; week++) {
      const modes = weekMap?.get(week) ?? {};
      const resolved = resolveWeek(modes, lens, rules);
      if (!resolved) continue;

      totals = addStats(totals, resolved.stats);
      fptsTotal += resolved.fpts;
      weeksPlayed++;
      fptsByWeek.set(week, resolved.fpts);
    }

    result.set(teamId, {
      teamId,
      goals: Math.round(totals.goals),
      shots: Math.round(totals.shots),
      saves: Math.round(totals.saves),
      assists: Math.round(totals.assists),
      demosInflicted: Math.round(totals.demosInflicted),
      demosTaken: Math.round(totals.demosTaken),
      wins: totals.wins,
      losses: totals.losses,
      record: `${totals.wins}-${totals.losses}`,
      fpts: Math.round(fptsTotal * 10) / 10,
      avg: weeksPlayed > 0 ? Math.round((fptsTotal / weeksPlayed) * 10) / 10 : 0,
      score: Math.round((fptsByWeek.get(throughWeek) ?? 0) * 10) / 10,
      last: Math.round((fptsByWeek.get(throughWeek - 1) ?? 0) * 10) / 10,
      bestWeek: fptsByWeek.size > 0 ? Math.round(Math.max(...fptsByWeek.values()) * 10) / 10 : 0,
      weeksPlayed,
    });
  }

  return result;
}

/**
 * Fantasy-rank ordering: total fpts first. Average is deliberately not a
 * tiebreaker — two teams tied on total fpts have almost always played the
 * same number of weeks, so their averages tie too and settle nothing. Ties
 * instead go to the higher single-week best score, then total goals — the
 * one comparator every "fantasy rank" in the app should use, so ranking
 * can't drift or silently lose its tiebreak in a duplicated sort.
 */
export function compareByFpts(a: TeamSeasonStatsRow, b: TeamSeasonStatsRow): number {
  return b.fpts - a.fpts || b.bestWeek - a.bestWeek || b.goals - a.goals;
}

/** Ranks teams by `compareByFpts`, returning a teamId -> rank (1-indexed) map. */
export function rankTeamsByFpts(
  stats: Map<string, TeamSeasonStatsRow> | TeamSeasonStatsRow[]
): Map<string, number> {
  const entries = Array.isArray(stats) ? stats.map((s) => [s.teamId, s] as const) : [...stats.entries()];
  const sorted = entries.sort((a, b) => compareByFpts(a[1], b[1]));

  const ranking = new Map<string, number>();
  sorted.forEach(([teamId], index) => ranking.set(teamId, index + 1));
  return ranking;
}

/**
 * Ranks a set of MLE teams by cumulative fpts through a given week, under a
 * gamemode lens. Compute once per (week, lens) per page render and reuse —
 * do not call this per-row.
 */
export async function getLeagueWideRanking(
  throughWeek: number,
  lens: GamemodeLens,
  allMleTeamIds: string[]
): Promise<Map<string, number>> {
  const stats = await getTeamSeasonStats({ teamIds: allMleTeamIds, throughWeek, lens });
  return rankTeamsByFpts(stats);
}

export interface WithinLeagueStanding {
  rank: number;
  totalTeams: number;
}

/**
 * MLE "standings" — rank of every MLE team WITHIN its own league/tier (AL/CL/ML
 * have 32 teams, FL/PL have 16), as opposed to getLeagueWideRanking's global
 * rank across all ~160 teams. Computed once for every MLE league, not per row.
 */
export async function getWithinLeagueStandings(
  throughWeek: number,
  lens: GamemodeLens
): Promise<Map<string, WithinLeagueStanding>> {
  const allTeams = await prisma.mLETeam.findMany({ select: { id: true, leagueId: true } });
  const byLeague = new Map<string, string[]>();
  for (const t of allTeams) {
    if (!byLeague.has(t.leagueId)) byLeague.set(t.leagueId, []);
    byLeague.get(t.leagueId)!.push(t.id);
  }

  const result = new Map<string, WithinLeagueStanding>();
  for (const teamIds of byLeague.values()) {
    const ranking = await getLeagueWideRanking(throughWeek, lens, teamIds);
    for (const [id, rank] of ranking) {
      result.set(id, { rank, totalTeams: teamIds.length });
    }
  }
  return result;
}

/**
 * Color tier for a standings position: best third = green, middle third =
 * gray, worst third = red — scaled proportionally so it works the same for
 * 32-team leagues (AL/CL/ML) and 16-team leagues (FL/PL).
 */
export function getStandingsColor(rank: number, totalTeams: number): string {
  const percentile = rank / totalTeams;
  if (percentile <= 1 / 3) return "#22c55e"; // green — good standing
  if (percentile <= 2 / 3) return "#9ca3af"; // gray — middle
  return "#ef4444"; // red — bad standing
}
