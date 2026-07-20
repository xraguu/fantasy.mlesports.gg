import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getCurrentSeasonWeek } from "@/lib/currentWeek";
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

    // The real MLE match data already exists for every configured week
    // (the season's already over), but this app still paces fantasy stats
    // one week at a time — this used to take the LAST configured week
    // unconditionally (effectively always the full season), which meant
    // Team Portal's team stats were showing full-season totals no matter
    // what week it actually is. `getCurrentSeasonWeek` is the same real
    // "what week is it right now" the automatic stats refresh itself uses.
    const current = await getCurrentSeasonWeek();
    const throughWeek = current?.week ?? 1;

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
