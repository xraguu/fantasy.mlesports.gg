import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/teams/[teamId]/players
 * Get all players for a specific MLE team
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ teamId: string }> }
) {
  try {
    const { teamId } = await params;

    // Find the team first to ensure it exists
    const team = await prisma.mLETeam.findUnique({
      where: { id: teamId },
      select: {
        id: true,
        name: true,
        leagueId: true,
      },
    });

    if (!team) {
      return NextResponse.json({ error: "Team not found" }, { status: 404 });
    }

    // Fetch players for this team
    const players = await prisma.mLEPlayer.findMany({
      where: {
        teamId: teamId,
      },
      select: {
        id: true,
        name: true,
        skillGroup: true,
        salary: true,
        memberId: true,
        staffPosition: true,
        rosterSlot: true,
      },
    });

    // Get historical stats for each player (we'll aggregate them for current season)
    const playersWithStats = await Promise.all(
      players.map(async (player) => {
        // Get the most recent REGULAR SEASON stats for both game modes.
        // Season labels are free text like "Season 19" / "Season 19
        // Playoffs" — excluding "Playoffs" rows here matters because
        // "Season 19 Playoffs" sorts ahead of "Season 19" in a plain
        // string ORDER BY DESC, which was silently showing a player's much
        // smaller playoffs sample (sometimes 0 games in a mode) mislabeled
        // as their season totals.
        const doublesStats = await prisma.playerHistoricalStats.findFirst({
          where: {
            playerId: player.id,
            gamemode: "RL_DOUBLES",
            NOT: { season: { contains: "Playoffs" } },
          },
          orderBy: {
            season: "desc",
          },
        });

        const standardStats = await prisma.playerHistoricalStats.findFirst({
          where: {
            playerId: player.id,
            gamemode: "RL_STANDARD",
            NOT: { season: { contains: "Playoffs" } },
          },
          orderBy: {
            season: "desc",
          },
        });

        return {
          ...player,
          doublesStats: doublesStats || null,
          standardStats: standardStats || null,
        };
      })
    );

    return NextResponse.json({
      team: {
        id: team.id,
        name: team.name,
        leagueId: team.leagueId,
      },
      players: playersWithStats,
    });
  } catch (error) {
    console.error("Error fetching team players:", error);
    return NextResponse.json(
      { error: "Failed to fetch team players" },
      { status: 500 }
    );
  }
}
