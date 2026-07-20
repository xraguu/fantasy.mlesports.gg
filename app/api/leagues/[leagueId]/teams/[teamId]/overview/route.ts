import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getFantasyStandings, getDoubleWinResultsByTeam } from "@/lib/standings";
import { computeStreak } from "@/lib/streak";

/**
 * GET /api/leagues/[leagueId]/teams/[teamId]/overview
 * Everything the homepage leaderboards' "manager card" modal needs in one
 * call: manager/team name, record + standing + streak (all from the same
 * shared getFantasyStandings() every other page uses), fantasy points, and
 * the real MLE teams currently on their roster (deduplicated, current week
 * — just enough to list with logos, no per-slot detail).
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ leagueId: string; teamId: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { leagueId, teamId } = await params;

    const team = await prisma.fantasyTeam.findUnique({
      where: { id: teamId },
      select: {
        id: true,
        displayName: true,
        fantasyLeagueId: true,
        owner: { select: { displayName: true } },
        league: { select: { id: true, name: true, currentWeek: true } },
      },
    });

    if (!team || team.fantasyLeagueId !== leagueId) {
      return NextResponse.json({ error: "Team not found in this league" }, { status: 404 });
    }

    // doubleWinResultsByTeamId is fetched once and handed to
    // getFantasyStandings, which needs the exact same (leagueId, no
    // throughWeek) result internally — without passing it through, that was
    // a second, identical query alongside this one.
    const [doubleWinResultsByTeamId, matchups, rosterSlots] = await Promise.all([
      getDoubleWinResultsByTeam(leagueId),
      // Playoff matchups never count toward standings — excluded so streak
      // and avgPoints stay regular-season only, consistent with
      // getFantasyStandings' wins/losses/points.
      prisma.matchup.findMany({
        where: {
          fantasyLeagueId: leagueId,
          isPlayoff: false,
          OR: [{ homeTeamId: teamId }, { awayTeamId: teamId }],
        },
        select: { week: true, homeTeamId: true, awayTeamId: true, homeScore: true, awayScore: true },
      }),
      prisma.rosterSlot.findMany({
        where: { fantasyTeamId: teamId, week: team.league.currentWeek },
        include: { mleTeam: true },
        orderBy: [{ position: "asc" }, { slotIndex: "asc" }],
      }),
    ]);

    const standings = await getFantasyStandings(leagueId, undefined, doubleWinResultsByTeamId);
    const standing = standings.find((s) => s.teamId === teamId);

    // Double-win results are appended after the matchup results (not
    // merged/sorted together) so that for any week with both, the matchup
    // result stays first and the double-win result — the chronologically
    // second result that week — is what a stable sort by week leaves as
    // the more recent of the two.
    const streak = computeStreak([
      ...matchups.map((m) => {
        const isHome = m.homeTeamId === teamId;
        const myScore = isHome ? m.homeScore : m.awayScore;
        const oppScore = isHome ? m.awayScore : m.homeScore;
        const result =
          myScore === null || oppScore === null
            ? null
            : myScore > oppScore
            ? ("W" as const)
            : myScore < oppScore
            ? ("L" as const)
            : null;
        return { week: m.week, result };
      }),
      ...(doubleWinResultsByTeamId.get(teamId) ?? []),
    ]);

    // Roster teams, deduplicated (a team shouldn't appear in more than one
    // slot, but defend against it anyway) and excluding empty slots.
    const seenMleTeamIds = new Set<string>();
    const roster = rosterSlots
      .filter((slot) => slot.mleTeam && !seenMleTeamIds.has(slot.mleTeam.id) && seenMleTeamIds.add(slot.mleTeam.id))
      .map((slot) => ({
        id: slot.mleTeam!.id,
        name: slot.mleTeam!.name,
        leagueId: slot.mleTeam!.leagueId,
        logoPath: slot.mleTeam!.logoPath,
      }));

    return NextResponse.json({
      manager: team.owner.displayName,
      team: team.displayName,
      league: team.league.name,
      wins: standing?.wins ?? 0,
      losses: standing?.losses ?? 0,
      rank: standing?.rank ?? null,
      totalTeams: standings.length,
      streak,
      totalPoints: standing?.pointsFor ?? 0,
      avgPoints:
        matchups.filter((m) => m.homeScore !== null && m.awayScore !== null).length > 0
          ? (standing?.pointsFor ?? 0) / matchups.filter((m) => m.homeScore !== null && m.awayScore !== null).length
          : 0,
      roster,
    });
  } catch (error) {
    console.error("Error fetching fantasy team overview:", error);
    return NextResponse.json(
      { error: "Failed to fetch team overview" },
      { status: 500 }
    );
  }
}
