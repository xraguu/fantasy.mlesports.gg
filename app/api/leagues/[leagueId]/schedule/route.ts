import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getFantasyStandings, formatPlacement } from "@/lib/standings";

/**
 * GET /api/leagues/[leagueId]/schedule?teamId=xxx
 * Get schedule for a specific fantasy team
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
    const { searchParams } = new URL(req.url);
    const teamId = searchParams.get("teamId");

    if (!teamId) {
      return NextResponse.json({ error: "teamId is required" }, { status: 400 });
    }

    // Get the league
    const league = await prisma.fantasyLeague.findUnique({
      where: { id: leagueId },
      select: {
        id: true,
        name: true,
        currentWeek: true,
      },
    });

    if (!league) {
      return NextResponse.json({ error: "League not found" }, { status: 404 });
    }

    // Get the fantasy team
    const fantasyTeam = await prisma.fantasyTeam.findUnique({
      where: { id: teamId },
      include: {
        owner: {
          select: {
            id: true,
            displayName: true,
          },
        },
      },
    });

    if (!fantasyTeam || fantasyTeam.fantasyLeagueId !== leagueId) {
      return NextResponse.json({ error: "Team not found in this league" }, { status: 404 });
    }

    // Get all matchups for this team
    const matchups = await prisma.matchup.findMany({
      where: {
        fantasyLeagueId: leagueId,
        OR: [
          { homeTeamId: teamId },
          { awayTeamId: teamId },
        ],
      },
      include: {
        homeTeam: {
          include: {
            owner: {
              select: {
                id: true,
                displayName: true,
              },
            },
          },
        },
        awayTeam: {
          include: {
            owner: {
              select: {
                id: true,
                displayName: true,
              },
            },
          },
        },
      },
      orderBy: {
        week: "asc",
      },
    });

    // Shared win/loss/points/rank source (honors double-win if enabled)
    const fantasyStandings = await getFantasyStandings(leagueId);
    const teamRecords = new Map(
      fantasyStandings.map((s) => [s.teamId, { wins: s.wins, losses: s.losses }])
    );

    const getPlacement = (teamId: string) => {
      const standing = fantasyStandings.find((s) => s.teamId === teamId);
      return standing ? formatPlacement(standing.rank) : "-";
    };

    // Format schedule data
    const schedule = matchups.map((matchup) => {
      const isHome = matchup.homeTeamId === teamId;
      const opponent = isHome ? matchup.awayTeam : matchup.homeTeam;
      // Null check, not a truthiness check — a legitimately-scored 0 (e.g.
      // every active roster slot came up scoreless that week) is a real
      // played result, not "not played yet", and `0 && ...` would otherwise
      // make this whole expression falsy and wrongly show "-".
      const played = matchup.homeScore !== null && matchup.awayScore !== null;
      const myScore = played
        ? (isHome ? matchup.homeScore : matchup.awayScore)
        : null;
      const oppScore = played
        ? (isHome ? matchup.awayScore : matchup.homeScore)
        : null;

      let result = null;
      if (myScore !== null && oppScore !== null) {
        result = myScore > oppScore ? "W" : myScore < oppScore ? "L" : "T";
      }

      const oppRecord = teamRecords.get(opponent.id) || { wins: 0, losses: 0 };
      const oppRecordString = `${oppRecord.wins}-${oppRecord.losses}`;
      const oppPlace = getPlacement(opponent.id);

      return {
        week: matchup.week,
        result,
        myScore,
        oppScore,
        opponent: opponent.displayName,
        oppRecord: oppRecordString,
        oppPlace,
        manager: opponent.owner.displayName,
        opponentTeamId: opponent.id,
        isPlayoff: matchup.isPlayoff,
      };
    });

    return NextResponse.json({
      schedule,
      team: {
        id: fantasyTeam.id,
        displayName: fantasyTeam.displayName,
        manager: fantasyTeam.owner.displayName,
      },
      league: {
        id: league.id,
        name: league.name,
        currentWeek: league.currentWeek,
      },
    });
  } catch (error) {
    console.error("Error fetching schedule:", error);
    return NextResponse.json(
      { error: "Failed to fetch schedule" },
      { status: 500 }
    );
  }
}
