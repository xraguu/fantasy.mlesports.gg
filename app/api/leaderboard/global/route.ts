import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { getFantasyStandings } from "@/lib/standings";
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
        homeMatchups: {
          select: { week: true, homeScore: true, awayScore: true },
        },
        awayMatchups: {
          select: { week: true, homeScore: true, awayScore: true },
        },
      },
    });

    // Win/loss/points per team, computed per-league so double-win bonuses
    // (which are league-scoped) are honored correctly for each league.
    const leagueIds = [...new Set(fantasyTeams.map((t) => t.fantasyLeagueId))];
    const standingsByLeague = await Promise.all(
      leagueIds.map((id) => getFantasyStandings(id))
    );
    const standingByTeamId = new Map(
      standingsByLeague.flat().map((s) => [s.teamId, s])
    );

    // Calculate stats for each team
    const teamsWithStats = fantasyTeams.map((team) => {
      const base = standingByTeamId.get(team.id);
      const wins = base?.wins ?? 0;
      const losses = base?.losses ?? 0;
      const totalPoints = base?.pointsFor ?? 0;

      const gamesPlayed = [...team.homeMatchups, ...team.awayMatchups].filter(
        (m) => m.homeScore !== null && m.awayScore !== null
      ).length;

      const avgPoints = gamesPlayed > 0 ? totalPoints / gamesPlayed : 0;
      const winRate = gamesPlayed > 0 ? (wins / gamesPlayed) * 100 : 0;

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
        avgPoints,
        gamesPlayed,
        isYou: session?.user?.id === team.ownerUserId,
      };
    });

    // Filter out teams with no games and sort by wins, then by total points
    const topManagers = teamsWithStats
      .filter((team) => team.gamesPlayed > 0)
      .sort((a, b) => {
        if (a.wins !== b.wins) return b.wins - a.wins;
        return b.totalPoints - a.totalPoints;
      })
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
