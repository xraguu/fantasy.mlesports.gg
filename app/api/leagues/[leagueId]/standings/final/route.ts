import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getFantasyStandings } from "@/lib/standings";
import { getFinalStandingsPlacement } from "@/lib/scheduleGenerator";

/**
 * GET /api/leagues/[leagueId]/standings/final
 * Final 1..maxTeams placement once the season's playoff bracket has fully
 * finished — regular-season record/points (same numbers the main Standings
 * page shows; playoff matchups never count toward win/loss/points, see
 * lib/standings.ts), just re-ranked by the bracket outcome instead of
 * regular-season win rate. Returns `error` (not a 500) while the bracket
 * hasn't finished yet, mirroring the Playoffs page's "not ready" pattern.
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

    const league = await prisma.fantasyLeague.findUnique({
      where: { id: leagueId },
      select: { id: true, name: true, currentWeek: true, maxTeams: true },
    });

    if (!league) {
      return NextResponse.json({ error: "League not found" }, { status: 404 });
    }

    let placement: Map<string, number>;
    try {
      placement = await getFinalStandingsPlacement(leagueId);
    } catch (e) {
      return NextResponse.json({
        error: e instanceof Error ? e.message : "The season isn't finished yet",
        standings: [],
        league: { id: league.id, name: league.name, currentWeek: league.currentWeek, maxTeams: league.maxTeams },
      });
    }

    const fantasyTeams = await prisma.fantasyTeam.findMany({
      where: { fantasyLeagueId: leagueId },
      include: { owner: { select: { id: true, displayName: true } } },
    });

    const fantasyStandings = await getFantasyStandings(leagueId);
    const standingByTeamId = new Map(fantasyStandings.map((s) => [s.teamId, s]));

    const standings = fantasyTeams.map((team) => {
      const base = standingByTeamId.get(team.id);
      return {
        rank: placement.get(team.id) ?? league.maxTeams,
        fantasyTeamId: team.id,
        manager: team.owner.displayName,
        team: team.displayName,
        wins: base?.wins ?? 0,
        losses: base?.losses ?? 0,
        points: base?.pointsFor ?? 0,
        pointsAgainst: base?.pointsAgainst ?? 0,
        isYou: team.ownerUserId === session.user.id,
      };
    });

    standings.sort((a, b) => a.rank - b.rank);

    return NextResponse.json({
      error: null,
      standings,
      league: { id: league.id, name: league.name, currentWeek: league.currentWeek, maxTeams: league.maxTeams },
    });
  } catch (error) {
    console.error("Error fetching final standings:", error);
    return NextResponse.json(
      { error: "Failed to fetch final standings" },
      { status: 500 }
    );
  }
}
