import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getTeamSeasonStats, GamemodeLens } from "@/lib/teamSeasonStats";

/**
 * GET /api/mle-teams?mode=2s|3s
 * Get all MLE teams enriched with real cumulative season stats for the
 * given gamemode lens (defaults to "3s").
 */
export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const mode = (searchParams.get("mode") as GamemodeLens) || "3s";

    const mleTeams = await prisma.mLETeam.findMany({
      orderBy: [
        { leagueId: "asc" },
        { name: "asc" },
      ],
    });

    const settings = await prisma.seasonSettings.findFirst({
      orderBy: { season: "desc" },
    });
    const weekDates =
      (settings?.weekDates as Array<{
        week: number;
        startDate: string;
        endDate: string;
      }>) ?? [];
    const configuredWeeks = weekDates
      .filter((w) => w.startDate && w.endDate)
      .map((w) => w.week);
    const throughWeek = configuredWeeks.length > 0 ? Math.max(...configuredWeeks) : 1;

    const statsMap = await getTeamSeasonStats({
      teamIds: mleTeams.map((t) => t.id),
      throughWeek,
      lens: mode,
    });

    const teams = mleTeams.map((team) => {
      const s = statsMap.get(team.id);
      return {
        ...team,
        fpts: s?.fpts ?? 0,
        avg: s?.avg ?? 0,
        last: s?.last ?? 0,
        score: s?.score ?? 0,
        goals: s?.goals ?? 0,
        shots: s?.shots ?? 0,
        saves: s?.saves ?? 0,
        assists: s?.assists ?? 0,
        demos: s?.demosInflicted ?? 0,
        record: s?.record ?? "0-0",
      };
    });

    return NextResponse.json({ teams, throughWeek });
  } catch (error) {
    console.error("Error fetching MLE teams:", error);
    return NextResponse.json(
      { error: "Failed to fetch MLE teams" },
      { status: 500 }
    );
  }
}
