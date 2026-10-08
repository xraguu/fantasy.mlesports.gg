import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getCurrentSeason } from "@/lib/currentWeek";
import { getFantasyStandings } from "@/lib/standings";
import { getFinalStandingsPlacement } from "@/lib/scheduleGenerator";

/**
 * GET /api/leagues/past
 * The signed-in user's archived leagues (season older than the current
 * season — same boundary the admin League Archive page uses), each with the
 * user's team, their regular-season record, and their final placement once
 * that league's playoff bracket has finished (null if it never did).
 */
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const currentSeason = await getCurrentSeason();
    if (currentSeason === null) {
      return NextResponse.json({ leagues: [] });
    }

    const leagues = await prisma.fantasyLeague.findMany({
      where: {
        season: { lt: currentSeason },
        fantasyTeams: { some: { ownerUserId: session.user.id } },
      },
      select: {
        id: true,
        name: true,
        season: true,
        maxTeams: true,
        fantasyTeams: {
          where: { ownerUserId: session.user.id },
          select: { id: true, displayName: true },
        },
      },
      orderBy: [{ season: "desc" }, { name: "asc" }],
    });

    const pastLeagues = await Promise.all(
      leagues.map(async (league) => {
        const team = league.fantasyTeams[0];
        const standings = await getFantasyStandings(league.id);
        const record = standings.find((s) => s.teamId === team.id);

        let finalPlace: number | null = null;
        try {
          const placement = await getFinalStandingsPlacement(league.id);
          finalPlace = placement.get(team.id) ?? null;
        } catch {
          // Bracket never finished (or this league size has no bracket) —
          // there's simply no final placement to show.
        }

        return {
          leagueId: league.id,
          leagueName: league.name,
          season: league.season,
          totalTeams: league.maxTeams,
          teamName: team.displayName,
          wins: record?.wins ?? 0,
          losses: record?.losses ?? 0,
          finalPlace,
        };
      })
    );

    return NextResponse.json({ leagues: pastLeagues });
  } catch (error) {
    console.error("Error fetching past leagues:", error);
    return NextResponse.json({ error: "Failed to fetch past leagues" }, { status: 500 });
  }
}
