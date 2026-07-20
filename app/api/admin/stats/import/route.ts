import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { importSprocketStatsForWeek } from "@/lib/sprocketStats";
import { getCurrentSeasonWeek } from "@/lib/currentWeek";
import { logAdminActivity } from "@/lib/adminActivity";

/**
 * POST /api/admin/stats/import
 * Re-imports Sprocket stats for the current week only (does not recalculate
 * fantasy scores — use /api/admin/stats/recalculate for that, separately,
 * for whichever week the admin picks).
 */
export async function POST() {
  try {
    const session = await auth();
    if (!session?.user || session.user.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const current = await getCurrentSeasonWeek();
    if (!current) {
      return NextResponse.json(
        { error: "Could not determine the current season/week — configure week dates in Settings first." },
        { status: 400 }
      );
    }

    const result = await importSprocketStatsForWeek(current.week, current.season);

    await logAdminActivity({
      adminUserId: session.user.id!,
      action: "stats.manual_import",
      description: `Manually re-imported stats for season ${current.season} week ${current.week} (${result.imported} teams imported)`,
    });

    return NextResponse.json({ success: true, season: current.season, week: current.week, import: result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Import failed";
    console.error("Manual stats import error:", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
