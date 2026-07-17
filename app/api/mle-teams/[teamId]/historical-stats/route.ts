import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getTeamHistoricalStats, resolveDraftStatsSeason } from "@/lib/teamHistoricalStats";

/**
 * GET /api/mle-teams/[teamId]/historical-stats
 * One team's stats for whichever completed season is configured as the
 * draft room's "last season" (Admin Settings' "Draft Room 'Last Season'
 * Stats" — same season resolution as the draft state endpoint, so this can
 * never show a different season than the Available Teams tab did). Always
 * the combined (2s+3s) lens, since this is a general team profile, not tied
 * to whatever gamemode filter a caller happened to have selected.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ teamId: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { teamId } = await params;

    const season = await resolveDraftStatsSeason();
    if (!season) {
      return NextResponse.json({ season: null, stats: null });
    }

    const statsByTeam = await getTeamHistoricalStats(season, "combined");
    const stats = statsByTeam.get(teamId) ?? null;

    return NextResponse.json({ season, stats });
  } catch (error) {
    console.error("Error fetching team historical stats:", error);
    return NextResponse.json(
      { error: "Failed to fetch team historical stats" },
      { status: 500 }
    );
  }
}
