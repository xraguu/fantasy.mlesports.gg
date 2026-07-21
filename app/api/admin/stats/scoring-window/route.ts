import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getCurrentSeasonWeek } from "@/lib/currentWeek";
import { haveMatchesStarted } from "@/lib/autoLock";

/**
 * GET /api/admin/stats/scoring-window
 * The current season/week fantasy scoring is paced at, plus whether that
 * week's real matches have actually started yet (Match Start date, see
 * lib/autoLock.ts's haveMatchesStarted) — used by the Manual Stats page to
 * gate the Recalculate Scores button so it can't be used on a week that's
 * still ahead of when its matches begin, same rule calculateScoresForWeek
 * itself already enforces server-side.
 */
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user || session.user.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const current = await getCurrentSeasonWeek();
    if (!current) {
      return NextResponse.json({ season: null, week: null, matchesStarted: false, matchStart: null });
    }

    const matchesStarted = await haveMatchesStarted(current.season, current.week);

    const settings = await prisma.seasonSettings.findFirst({ where: { season: current.season } });
    const weekDates =
      (settings?.weekDates as Array<{ week: number; matchStart: string }> | undefined) ?? [];
    const matchStart = weekDates.find((w) => w.week === current.week)?.matchStart ?? null;

    return NextResponse.json({ season: current.season, week: current.week, matchesStarted, matchStart });
  } catch (error) {
    console.error("Error fetching scoring window:", error);
    return NextResponse.json({ error: "Failed to fetch scoring window" }, { status: 500 });
  }
}
