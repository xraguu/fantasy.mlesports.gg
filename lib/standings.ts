import { prisma } from "@/lib/prisma";

export interface TeamStanding {
  teamId: string;
  wins: number;
  losses: number;
  pointsFor: number;
  pointsAgainst: number;
  rank: number;
}

/**
 * Single source of truth for fantasy-league win/loss/points standings.
 * Honors FantasyLeague.doubleWinEnabled: on top of normal matchup wins/losses,
 * every regular-season week each team's starting-lineup score is ranked
 * league-wide — top half get a bonus win, bottom half get a bonus loss.
 * Never applies to playoff weeks.
 */
export async function getFantasyStandings(
  leagueId: string,
  throughWeek?: number
): Promise<TeamStanding[]> {
  const league = await prisma.fantasyLeague.findUnique({
    where: { id: leagueId },
    select: { id: true, maxTeams: true, doubleWinEnabled: true },
  });
  if (!league) return [];

  const regularSeasonWeeks = league.maxTeams === 12 ? 7 : 8;

  const matchupWhere: { fantasyLeagueId: string; week?: { lte: number } } = {
    fantasyLeagueId: leagueId,
  };
  if (throughWeek !== undefined) matchupWhere.week = { lte: throughWeek };

  const [matchups, teams] = await Promise.all([
    prisma.matchup.findMany({ where: matchupWhere }),
    prisma.fantasyTeam.findMany({
      where: { fantasyLeagueId: leagueId },
      select: { id: true },
    }),
  ]);

  const base = new Map<
    string,
    { wins: number; losses: number; pointsFor: number; pointsAgainst: number }
  >();
  for (const t of teams) {
    base.set(t.id, { wins: 0, losses: 0, pointsFor: 0, pointsAgainst: 0 });
  }

  for (const m of matchups) {
    if (m.homeScore == null || m.awayScore == null) continue;
    const home = base.get(m.homeTeamId);
    const away = base.get(m.awayTeamId);
    if (!home || !away) continue;

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

  if (league.doubleWinEnabled) {
    const maxRegularWeek =
      throughWeek !== undefined
        ? Math.min(throughWeek, regularSeasonWeeks)
        : regularSeasonWeeks;

    if (maxRegularWeek > 0) {
      const slots = await prisma.rosterSlot.findMany({
        where: {
          fantasyTeam: { fantasyLeagueId: leagueId },
          week: { lte: maxRegularWeek },
          position: { not: "be" },
        },
        select: { fantasyTeamId: true, week: true, fantasyPoints: true },
      });

      const scoresByWeek = new Map<number, Map<string, number>>();
      for (const slot of slots) {
        if (!scoresByWeek.has(slot.week)) scoresByWeek.set(slot.week, new Map());
        const weekMap = scoresByWeek.get(slot.week)!;
        weekMap.set(
          slot.fantasyTeamId,
          (weekMap.get(slot.fantasyTeamId) || 0) + (slot.fantasyPoints ?? 0)
        );
      }

      for (const weekScores of scoresByWeek.values()) {
        const ranked = [...weekScores.entries()].sort((a, b) => b[1] - a[1]);
        const half = Math.floor(ranked.length / 2);
        ranked.forEach(([teamId], idx) => {
          const entry = base.get(teamId);
          if (!entry) return;
          if (idx < half) entry.wins += 1;
          else entry.losses += 1;
        });
      }
    }
  }

  const standings: Omit<TeamStanding, "rank">[] = [...base.entries()].map(
    ([teamId, s]) => ({ teamId, ...s })
  );

  standings.sort((a, b) => {
    if (a.wins !== b.wins) return b.wins - a.wins;
    return b.pointsFor - a.pointsFor;
  });

  return standings.map((s, idx) => ({ ...s, rank: idx + 1 }));
}

export function formatPlacement(rank: number): string {
  const suffix = rank === 1 ? "st" : rank === 2 ? "nd" : rank === 3 ? "rd" : "th";
  return `${rank}${suffix}`;
}
