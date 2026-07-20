import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getFantasyStandings, getDoubleWinResultsByTeam, compareStandings } from "@/lib/standings";
import { computeStreak } from "@/lib/streak";

/**
 * GET /api/leagues/[leagueId]/standings
 * Get league standings with fantasy team stats
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ leagueId: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { leagueId } = await params;

    // Get the league
    const league = await prisma.fantasyLeague.findUnique({
      where: { id: leagueId },
      select: {
        id: true,
        name: true,
        currentWeek: true,
        maxTeams: true,
      },
    });

    if (!league) {
      return NextResponse.json({ error: "League not found" }, { status: 404 });
    }

    // Get all fantasy teams in the league
    const fantasyTeams = await prisma.fantasyTeam.findMany({
      where: { fantasyLeagueId: leagueId },
      include: {
        owner: {
          select: {
            id: true,
            displayName: true,
          },
        },
      },
    });

    // Get all regular-season matchups for the league (used for streak calc
    // below) — playoff matchups never count toward standings.
    const matchups = await prisma.matchup.findMany({
      where: { fantasyLeagueId: leagueId, isPlayoff: false },
    });

    // Shared win/loss/points source (honors double-win if enabled on this
    // league) — computed once and handed to getFantasyStandings too, which
    // needs the exact same (leagueId, no throughWeek) result internally;
    // without passing it through, that was a second, identical query.
    const doubleWinResultsByTeamId = await getDoubleWinResultsByTeam(leagueId);
    const fantasyStandings = await getFantasyStandings(leagueId, undefined, doubleWinResultsByTeamId);
    const standingByTeamId = new Map(fantasyStandings.map((s) => [s.teamId, s]));

    // Calculate standings for each team
    const standings = await Promise.all(
      fantasyTeams.map(async (team) => {
        const base = standingByTeamId.get(team.id);
        const wins = base?.wins ?? 0;
        const losses = base?.losses ?? 0;
        const totalPoints = base?.pointsFor ?? 0;
        const pointsAgainst = base?.pointsAgainst ?? 0;

        // gamesPlayed/avgPoints are based on actual matchup results only —
        // a double-win bonus isn't a separate "game" played.
        const teamMatchups = matchups.filter(
          (m) => m.homeTeamId === team.id || m.awayTeamId === team.id
        );
        const actualGamesPlayed = teamMatchups.filter(
          (m) => m.homeScore !== null && m.awayScore !== null
        ).length;
        const avgPoints = actualGamesPlayed > 0 ? totalPoints / actualGamesPlayed : 0;

        // Double-win results are appended after the matchup results (not
        // merged/sorted together) so that for any week with both, the
        // matchup result stays first and the double-win result — the
        // chronologically second result that week — is what a stable sort
        // by week leaves as the more recent of the two.
        const streakString = computeStreak([
          ...teamMatchups.map((matchup) => {
            const isHome = matchup.homeTeamId === team.id;
            const myScore = isHome ? matchup.homeScore : matchup.awayScore;
            const oppScore = isHome ? matchup.awayScore : matchup.homeScore;
            const result =
              myScore === null || oppScore === null
                ? null
                : myScore > oppScore
                ? ("W" as const)
                : myScore < oppScore
                ? ("L" as const)
                : null;
            return { week: matchup.week, result };
          }),
          ...(doubleWinResultsByTeamId.get(team.id) ?? []),
        ]);

        // Get roster slots to find top performing team
        const rosterSlots = await prisma.rosterSlot.findMany({
          where: {
            fantasyTeamId: team.id,
          },
          include: {
            mleTeam: {
              include: {
                weeklyStats: true,
              },
            },
          },
          distinct: ["mleTeamId"],
        });

        // Calculate fantasy points for each MLE team
        const calculateFantasyPoints = (stats: any) => {
          return (
            stats.goals * 2 +
            stats.shots * 0.1 +
            stats.saves * 1 +
            stats.assists * 1.5 +
            stats.demosInflicted * 0.5
          );
        };

        interface TopTeamInfo {
          id: string;
          name: string;
          leagueId: string;
          slug: string;
          logoPath: string;
          primaryColor: string;
          secondaryColor: string;
        }
        let topTeam: TopTeamInfo | null = null;
        let topTeamFpts = 0;

        rosterSlots.forEach((slot) => {
          if (!slot.mleTeam) return;

          const weeklyStats = slot.mleTeam.weeklyStats;
          const totalFantasyPoints = weeklyStats.reduce(
            (sum, stats) => sum + calculateFantasyPoints(stats),
            0
          );

          if (totalFantasyPoints > topTeamFpts) {
            topTeamFpts = totalFantasyPoints;
            topTeam = {
              id: slot.mleTeam.id,
              name: slot.mleTeam.name,
              leagueId: slot.mleTeam.leagueId,
              slug: slot.mleTeam.slug,
              logoPath: slot.mleTeam.logoPath,
              primaryColor: slot.mleTeam.primaryColor,
              secondaryColor: slot.mleTeam.secondaryColor,
            };
          }
        });

        return {
          fantasyTeamId: team.id,
          manager: team.owner.displayName,
          team: team.displayName,
          wins,
          losses,
          points: totalPoints,
          avgPoints,
          topTeam: topTeam,
          topTeamFpts,
          pointsFor: totalPoints,
          pointsAgainst,
          streak: streakString,
          isYou: team.ownerUserId === session.user.id,
        };
      })
    );

    // Win rate, then points for, then points against — see lib/standings.ts's compareStandings.
    standings.sort((a, b) =>
      compareStandings(
        { wins: a.wins, losses: a.losses, pointsFor: a.points, pointsAgainst: a.pointsAgainst },
        { wins: b.wins, losses: b.losses, pointsFor: b.points, pointsAgainst: b.pointsAgainst }
      )
    );

    // Add rank
    const standingsWithRank = standings.map((team, index) => ({
      rank: index + 1,
      ...team,
    }));

    return NextResponse.json({
      standings: standingsWithRank,
      league: {
        id: league.id,
        name: league.name,
        currentWeek: league.currentWeek,
        maxTeams: league.maxTeams,
      },
    });
  } catch (error) {
    console.error("Error fetching standings:", error);
    return NextResponse.json(
      { error: "Failed to fetch standings" },
      { status: 500 }
    );
  }
}
