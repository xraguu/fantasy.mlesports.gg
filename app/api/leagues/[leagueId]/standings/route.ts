import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getFantasyStandings, getDoubleWinResultsByTeam, compareStandings, getLastFinishedWeek } from "@/lib/standings";
import { computeStreak } from "@/lib/streak";
import { getTeamSeasonStats } from "@/lib/teamSeasonStats";

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
        season: true,
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

    // Get the league's finished regular-season matchups (used for streak
    // calc below) — playoff matchups never count toward standings, and a
    // week still being played doesn't count until it's over.
    const matchups = await prisma.matchup.findMany({
      where: { fantasyLeagueId: leagueId, isPlayoff: false, week: { lte: await getLastFinishedWeek(leagueId) } },
    });

    // Shared win/loss/points source (honors double-win if enabled on this
    // league) — computed once and handed to getFantasyStandings too, which
    // needs the exact same (leagueId, no throughWeek) result internally;
    // without passing it through, that was a second, identical query.
    const doubleWinResultsByTeamId = await getDoubleWinResultsByTeam(leagueId);
    const fantasyStandings = await getFantasyStandings(leagueId, undefined, doubleWinResultsByTeamId);
    const standingByTeamId = new Map(fantasyStandings.map((s) => [s.teamId, s]));

    // Every manager's current roster, and each of those MLE teams' season
    // fantasy points in 2s and in 3s separately (for "top performing team")
    const rosterSlots = await prisma.rosterSlot.findMany({
      where: { fantasyTeam: { fantasyLeagueId: leagueId }, week: league.currentWeek },
      include: { mleTeam: true },
    });
    const rosterTeamIds = [...new Set(rosterSlots.map((s) => s.mleTeamId))];
    const [stats2s, stats3s] = await Promise.all(
      (["2s", "3s"] as const).map((lens) =>
        getTeamSeasonStats({ teamIds: rosterTeamIds, season: league.season, throughWeek: league.currentWeek, lens })
      )
    );

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
        const actualGamesPlayed = base?.gamesPlayed ?? 0;
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

        // Top performing team: the single best MLE team-and-mode on this
        // manager's current roster — a team's 2s and 3s points are never
        // added together
        let top: { mleTeam: (typeof rosterSlots)[number]["mleTeam"]; mode: "2s" | "3s"; fpts: number } | null = null;
        for (const slot of rosterSlots.filter((s) => s.fantasyTeamId === team.id)) {
          for (const [mode, stats] of [["2s", stats2s], ["3s", stats3s]] as const) {
            const row = stats.get(slot.mleTeamId);
            if (row && row.weeksPlayed > 0 && (!top || row.fpts > top.fpts)) {
              top = { mleTeam: slot.mleTeam, mode, fpts: row.fpts };
            }
          }
        }
        const topTeam = top
          ? {
              id: top.mleTeam.id,
              name: top.mleTeam.name,
              leagueId: top.mleTeam.leagueId,
              slug: top.mleTeam.slug,
              logoPath: top.mleTeam.logoPath,
              primaryColor: top.mleTeam.primaryColor,
              secondaryColor: top.mleTeam.secondaryColor,
            }
          : null;
        const topTeamFpts = top?.fpts ?? 0;
        const topTeamMode = top?.mode ?? null;

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
          topTeamMode,
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
