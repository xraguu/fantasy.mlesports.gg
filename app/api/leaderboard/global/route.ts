import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { getFantasyStandings, getDoubleWinResultsByTeam, DoubleWinWeekResult, compareStandings } from "@/lib/standings";
import { computeStreak } from "@/lib/streak";

/**
 * GET /api/leaderboard/global
 * Get top performing fantasy managers across all leagues
 */
export async function GET() {
  try {
    const session = await auth();

    // Get all fantasy teams (with matchup counts, to know who's actually played)
    const fantasyTeams = await prisma.fantasyTeam.findMany({
      include: {
        owner: {
          select: {
            id: true,
            displayName: true,
          },
        },
        league: {
          select: {
            id: true,
            name: true,
          },
        },
        // Playoff matchups never count toward standings — excluded here so
        // gamesPlayed/avgPoints/streak stay regular-season only, consistent
        // with getFantasyStandings' wins/losses/points.
        homeMatchups: {
          where: { isPlayoff: false },
          select: { week: true, homeScore: true, awayScore: true },
        },
        awayMatchups: {
          where: { isPlayoff: false },
          select: { week: true, homeScore: true, awayScore: true },
        },
      },
    });

    // Win/loss/points per team, computed per-league so double-win bonuses
    // (which are league-scoped) are honored correctly for each league.
    const leagueIds = [...new Set(fantasyTeams.map((t) => t.fantasyLeagueId))];
    const [standingsByLeague, doubleWinByLeague] = await Promise.all([
      Promise.all(leagueIds.map((id) => getFantasyStandings(id))),
      Promise.all(leagueIds.map((id) => getDoubleWinResultsByTeam(id))),
    ]);
    const standingByTeamId = new Map(
      standingsByLeague.flat().map((s) => [s.teamId, s])
    );
    const doubleWinResultsByTeamId = new Map<string, DoubleWinWeekResult[]>();
    for (const leagueMap of doubleWinByLeague) {
      for (const [teamId, weekResults] of leagueMap) {
        doubleWinResultsByTeamId.set(teamId, weekResults);
      }
    }

    // Calculate stats for each team
    const teamsWithStats = fantasyTeams.map((team) => {
      const base = standingByTeamId.get(team.id);
      const wins = base?.wins ?? 0;
      const losses = base?.losses ?? 0;
      const totalPoints = base?.pointsFor ?? 0;
      const pointsAgainst = base?.pointsAgainst ?? 0;

      const gamesPlayed = [...team.homeMatchups, ...team.awayMatchups].filter(
        (m) => m.homeScore !== null && m.awayScore !== null
      ).length;

      const avgPoints = gamesPlayed > 0 ? totalPoints / gamesPlayed : 0;
      // Win rate's denominator has to be total decisions (wins + losses),
      // not raw games played — a double-win league hands out a second
      // win/loss off the same game (best half of the league by points that
      // week), so a manager who wins their matchup and also finishes top
      // half can rack up 2 wins from 1 game played. Dividing by gamesPlayed
      // there would read as a 200% win rate.
      const totalDecisions = wins + losses;
      const winRate = totalDecisions > 0 ? (wins / totalDecisions) * 100 : 0;

      // Double-win results are appended after the matchup results (not
      // merged/sorted together) so that for any week with both, the matchup
      // result stays first and the double-win result — the chronologically
      // second result that week — is what a stable sort by week leaves as
      // the more recent of the two, matching the real order those two
      // results actually happen in.
      const streak = computeStreak([
        ...team.homeMatchups.map((m) => ({
          week: m.week,
          result:
            m.homeScore === null || m.awayScore === null
              ? null
              : m.homeScore > m.awayScore
              ? ("W" as const)
              : m.homeScore < m.awayScore
              ? ("L" as const)
              : null,
        })),
        ...team.awayMatchups.map((m) => ({
          week: m.week,
          result:
            m.homeScore === null || m.awayScore === null
              ? null
              : m.awayScore > m.homeScore
              ? ("W" as const)
              : m.awayScore < m.homeScore
              ? ("L" as const)
              : null,
        })),
        ...(doubleWinResultsByTeamId.get(team.id) ?? []),
      ]);

      return {
        fantasyTeamId: team.id,
        leagueId: team.fantasyLeagueId,
        manager: team.owner.displayName,
        team: team.displayName,
        league: team.league.name,
        wins,
        losses,
        winRate,
        streak,
        totalPoints,
        pointsAgainst,
        avgPoints,
        gamesPlayed,
        isYou: session?.user?.id === team.ownerUserId,
      };
    });

    // Filter out teams with no games and sort by win rate, then total
    // points, then points against — see lib/standings.ts's compareStandings.
    const topManagers = teamsWithStats
      .filter((team) => team.gamesPlayed > 0)
      .sort((a, b) =>
        compareStandings(
          { wins: a.wins, losses: a.losses, pointsFor: a.totalPoints, pointsAgainst: a.pointsAgainst },
          { wins: b.wins, losses: b.losses, pointsFor: b.totalPoints, pointsAgainst: b.pointsAgainst }
        )
      )
      .slice(0, 10)
      .map((team, index) => ({
        rank: index + 1,
        ...team,
      }));

    return NextResponse.json({ leaderboard: topManagers });
  } catch (error) {
    console.error("Error fetching global leaderboard:", error);
    return NextResponse.json(
      { error: "Failed to fetch global leaderboard" },
      { status: 500 }
    );
  }
}
