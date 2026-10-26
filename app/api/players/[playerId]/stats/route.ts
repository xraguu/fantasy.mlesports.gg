import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/players/[playerId]/stats
 * Get historical stats for a player, plus their current salary
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ playerId: string }> }
) {
  try {
    const { playerId } = await params;

    const stats = await prisma.playerHistoricalStats.findMany({
      where: {
        playerId: playerId,
      },
      orderBy: [
        { season: "desc" },
        { gamemode: "asc" },
      ],
    });

    // From players.csv's "salary" column; null if the player has none
    const player = await prisma.mLEPlayer.findUnique({
      where: { id: playerId },
      select: { salary: true },
    });

    return NextResponse.json({
      stats,
      salary: player?.salary ?? null,
    });
  } catch (error) {
    console.error("Error fetching player stats:", error);
    return NextResponse.json(
      { error: "Failed to fetch player stats" },
      { status: 500 }
    );
  }
}
