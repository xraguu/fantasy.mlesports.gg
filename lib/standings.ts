import { prisma } from "@/lib/prisma";
import { etDateTime } from "@/lib/timezone";
import type { WeekDateConfig } from "@/lib/weekMatchRange";

export interface TeamStanding {
  teamId: string;
  wins: number;
  losses: number;
  pointsFor: number;
  pointsAgainst: number;
  // Scored regular-season matchups counted above — the denominator for
  // average points (a double-win bonus isn't a separate game)
  gamesPlayed: number;
  rank: number;
}

/**
 * The last week that's over — 11:59pm ET on its weekEnd date has passed —
 * and so the last week that counts toward records. A week still being played
 * has live, changing scores, so it doesn't add to anyone's wins, losses or
 * points until it ends (normally the moment the next week starts). A league
 * with no week dates configured falls back to the week before its current one.
 */
export async function getLastFinishedWeek(leagueId: string): Promise<number> {
  const league = await prisma.fantasyLeague.findUnique({
    where: { id: leagueId },
    select: { season: true, currentWeek: true },
  });
  if (!league) return 0;

  const settings = await prisma.seasonSettings.findFirst({
    where: { season: league.season },
    select: { weekDates: true },
  });
  const weekDates = (settings?.weekDates as WeekDateConfig[] | undefined) ?? [];
  if (weekDates.length === 0) return league.currentWeek - 1;

  const now = new Date();
  return weekDates
    .filter((w) => w.weekEnd && etDateTime(w.weekEnd, 23, 59) <= now)
    .reduce((last, w) => Math.max(last, w.week), 0);
}

export interface DoubleWinWeekResult {
  week: number;
  result: "W" | "L";
}

/**
 * Per-team, per-completed-regular-season-week double-win bonus results
 * (empty for every team if the league doesn't have double-win enabled) —
 * shared by getFantasyStandings below (for the win/loss totals) and every
 * streak calculation, which needs to fold each week's bonus in as a second,
 * chronologically-later result alongside that week's matchup result.
 *
 * A week only counts once it's been substantially scored — ranking (and
 * awarding bonus wins/losses) off an all-zero, not-yet-scored week would be
 * meaningless. But requiring literally every slot to be non-null is too
 * strict in practice: real historical stats data has scattered permanent
 * per-team gaps (one MLE team missing a stat for one specific week), and
 * with a 12-team league's 60+ non-bench slots, some week almost always has
 * at least one straggler — which, under an all-or-nothing rule, voided
 * double-win for every team for that entire week. So a week is considered
 * ready once at least half its slots are scored (comfortably distinguishes
 * "hasn't been scored at all yet" from "done except for a data gap"), and
 * any slot still null at that point just counts as 0 toward its team's
 * weekly sum, same as everywhere else a possibly-missing stat is treated.
 * Never applies to playoff weeks.
 */
export async function getDoubleWinResultsByTeam(
  leagueId: string,
  throughWeek?: number
): Promise<Map<string, DoubleWinWeekResult[]>> {
  const result = new Map<string, DoubleWinWeekResult[]>();

  const league = await prisma.fantasyLeague.findUnique({
    where: { id: leagueId },
    select: { maxTeams: true, doubleWinEnabled: true },
  });
  if (!league?.doubleWinEnabled) return result;

  // A week still being played gets no bonus win/loss until it's over
  const regularSeasonWeeks = league.maxTeams === 12 ? 7 : 8;
  const maxRegularWeek = Math.min(
    throughWeek ?? regularSeasonWeeks,
    regularSeasonWeeks,
    await getLastFinishedWeek(leagueId)
  );
  if (maxRegularWeek <= 0) return result;

  const slots = await prisma.rosterSlot.findMany({
    where: {
      fantasyTeam: { fantasyLeagueId: leagueId },
      week: { lte: maxRegularWeek },
      position: { not: "be" },
    },
    select: { fantasyTeamId: true, week: true, fantasyPoints: true },
  });

  const scoresByWeek = new Map<number, Map<string, number>>();
  const totalByWeek = new Map<number, number>();
  const scoredByWeek = new Map<number, number>();
  for (const slot of slots) {
    totalByWeek.set(slot.week, (totalByWeek.get(slot.week) || 0) + 1);
    if (slot.fantasyPoints === null) continue;
    scoredByWeek.set(slot.week, (scoredByWeek.get(slot.week) || 0) + 1);
    if (!scoresByWeek.has(slot.week)) scoresByWeek.set(slot.week, new Map());
    const weekMap = scoresByWeek.get(slot.week)!;
    weekMap.set(
      slot.fantasyTeamId,
      (weekMap.get(slot.fantasyTeamId) || 0) + slot.fantasyPoints
    );
  }
  for (const week of totalByWeek.keys()) {
    const scored = scoredByWeek.get(week) || 0;
    const total = totalByWeek.get(week)!;
    if (scored < total / 2) {
      scoresByWeek.delete(week);
    }
  }

  for (const [week, weekScores] of [...scoresByWeek.entries()].sort((a, b) => a[0] - b[0])) {
    // Score desc, then teamId asc as a deterministic tiebreaker — without
    // it, two teams landing on the exact same weekly total would have
    // their W/L assignment decided by whatever row order Postgres happened
    // to return from the query above (no ORDER BY there), which isn't
    // guaranteed stable across requests.
    const ranked = [...weekScores.entries()].sort((a, b) => {
      const scoreDiff = b[1] - a[1];
      if (scoreDiff !== 0) return scoreDiff;
      return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0;
    });
    const half = Math.floor(ranked.length / 2);
    ranked.forEach(([teamId], idx) => {
      if (!result.has(teamId)) result.set(teamId, []);
      result.get(teamId)!.push({ week, result: idx < half ? "W" : "L" });
    });
  }

  return result;
}

/**
 * Standings tiebreaker order, shared by every place that ranks fantasy
 * teams (getFantasyStandings below, the standings page's own re-sort, and
 * the global leaderboard's): win rate first (not raw win count — a double-
 * win league hands out twice as many decisions per week, and a team that's
 * played fewer weeks shouldn't be penalized against one that's played
 * more), then total points for, then points against (fewer is better).
 */
export function compareStandings(
  a: { wins: number; losses: number; pointsFor: number; pointsAgainst: number },
  b: { wins: number; losses: number; pointsFor: number; pointsAgainst: number }
): number {
  const aDecisions = a.wins + a.losses;
  const bDecisions = b.wins + b.losses;
  const aRate = aDecisions > 0 ? a.wins / aDecisions : 0;
  const bRate = bDecisions > 0 ? b.wins / bDecisions : 0;
  if (aRate !== bRate) return bRate - aRate;
  if (a.pointsFor !== b.pointsFor) return b.pointsFor - a.pointsFor;
  return a.pointsAgainst - b.pointsAgainst;
}

/**
 * Single source of truth for fantasy-league win/loss/points standings.
 * Honors FantasyLeague.doubleWinEnabled via getDoubleWinResultsByTeam above.
 * Pass `precomputedDoubleWinResults` if the caller already fetched it for
 * this exact (leagueId, throughWeek) — e.g. for a shared streak calculation
 * — to skip the redundant re-fetch.
 */
export async function getFantasyStandings(
  leagueId: string,
  throughWeek?: number,
  precomputedDoubleWinResults?: Map<string, DoubleWinWeekResult[]>
): Promise<TeamStanding[]> {
  const league = await prisma.fantasyLeague.findUnique({
    where: { id: leagueId },
    select: { id: true },
  });
  if (!league) return [];

  // Playoff matchups never count toward standings — wins/losses/points
  // for/against are regular-season only, no matter what week it currently
  // is. Excluded unconditionally here (not just when throughWeek happens to
  // cap at the regular season) since callers routinely fetch standings with
  // no throughWeek at all once playoffs are underway. A week still being
  // played doesn't count either, until it's over (getLastFinishedWeek).
  const lastFinishedWeek = await getLastFinishedWeek(leagueId);
  const matchupWhere = {
    fantasyLeagueId: leagueId,
    isPlayoff: false,
    week: { lte: throughWeek === undefined ? lastFinishedWeek : Math.min(throughWeek, lastFinishedWeek) },
  };

  const [matchups, teams] = await Promise.all([
    prisma.matchup.findMany({ where: matchupWhere }),
    prisma.fantasyTeam.findMany({
      where: { fantasyLeagueId: leagueId },
      select: { id: true },
    }),
  ]);

  const base = new Map<
    string,
    { wins: number; losses: number; pointsFor: number; pointsAgainst: number; gamesPlayed: number }
  >();
  for (const t of teams) {
    base.set(t.id, { wins: 0, losses: 0, pointsFor: 0, pointsAgainst: 0, gamesPlayed: 0 });
  }

  for (const m of matchups) {
    if (m.homeScore == null || m.awayScore == null) continue;
    const home = base.get(m.homeTeamId);
    const away = base.get(m.awayTeamId);
    if (!home || !away) continue;

    home.gamesPlayed++;
    away.gamesPlayed++;
    home.pointsFor += m.homeScore;
    home.pointsAgainst += m.awayScore;
    away.pointsFor += m.awayScore;
    away.pointsAgainst += m.homeScore;

    if (m.homeScore > m.awayScore) {
      home.wins++;
      away.losses++;
    } else if (m.awayScore > m.homeScore) {
      away.wins++;
      home.losses++;
    }
  }

  const doubleWinResults =
    precomputedDoubleWinResults ?? (await getDoubleWinResultsByTeam(leagueId, throughWeek));
  for (const [teamId, weekResults] of doubleWinResults) {
    const entry = base.get(teamId);
    if (!entry) continue;
    for (const wr of weekResults) {
      if (wr.result === "W") entry.wins += 1;
      else entry.losses += 1;
    }
  }

  const standings: Omit<TeamStanding, "rank">[] = [...base.entries()].map(
    ([teamId, s]) => ({ teamId, ...s })
  );

  standings.sort(compareStandings);

  return standings.map((s, idx) => ({ ...s, rank: idx + 1 }));
}

export function formatPlacement(rank: number): string {
  const suffix = rank === 1 ? "st" : rank === 2 ? "nd" : rank === 3 ? "rd" : "th";
  return `${rank}${suffix}`;
}
