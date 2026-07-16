import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { runStatsRefresh } from "@/lib/statsRefresh";
import { logAdminActivity } from "@/lib/adminActivity";

/**
 * POST /api/admin/stats/refresh
 * Manual on-demand trigger for the same import + calculate refresh the
 * scheduled cron job runs every 120 minutes — lets an admin force a refresh
 * right away instead of waiting for the next scheduled run.
 */
export async function POST() {
  try {
    const session = await auth();
    if (!session?.user || session.user.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const result = await runStatsRefresh(session.user.id);

    await logAdminActivity({
      adminUserId: session.user.id!,
      action: "stats.manual_refresh",
      description: `Manually refreshed stats for season ${result.season} week ${result.week} (${result.import.imported} teams imported, ${result.calculate.slotsScored} slots scored)`,
    });

    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Refresh failed";
    console.error("Manual stats refresh error:", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
