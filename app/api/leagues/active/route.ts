import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getCurrentSeason } from "@/lib/currentWeek";

/**
 * GET /api/leagues/active
 * Every non-archived league that has at least one manager, whether or not
 * the signed-in user is in it — for the home page's "By League" standings
 * picker. Same active boundary as GET /api/leagues (season >= current).
 */
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const currentSeason = await getCurrentSeason();

    const leagues = await prisma.fantasyLeague.findMany({
      where: {
        fantasyTeams: { some: {} },
        ...(currentSeason !== null ? { season: { gte: currentSeason } } : {}),
      },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    });

    return NextResponse.json({ leagues });
  } catch (error) {
    console.error("Error fetching active leagues:", error);
    return NextResponse.json(
      { error: "Failed to fetch leagues" },
      { status: 500 }
    );
  }
}
