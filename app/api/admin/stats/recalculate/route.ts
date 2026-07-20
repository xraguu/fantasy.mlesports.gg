import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { calculateScoresForWeek } from "@/lib/scoringService";
import { logAdminActivity } from "@/lib/adminActivity";
import { runAutoLockSweep } from "@/lib/autoLock";

/**
 * POST /api/admin/stats/recalculate
 * Recalculates fantasy scores for an admin-chosen week from whatever
 * TeamWeeklyStats/RosterSlot data already exists — does not re-import
 * Sprocket stats first (use /api/admin/stats/import for that). Lets an
 * admin fix a specific week's scores (e.g. after a roster correction)
 * without disturbing every other week.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user || session.user.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const week = parseInt(body.week);
    if (isNaN(week) || week < 1 || week > 14) {
      return NextResponse.json({ error: "Invalid week" }, { status: 400 });
    }

    // A league nobody's opened since its week boundary passed otherwise
    // never advances its own currentWeek/lock state/roster carry-forward —
    // without this, recalculating week N would find zero roster rows for
    // any such league and silently score nothing for it.
    await runAutoLockSweep();

    const result = await calculateScoresForWeek(week, undefined, session.user.id);

    await logAdminActivity({
      adminUserId: session.user.id!,
      action: "stats.manual_recalculate",
      description: `Manually recalculated scores for week ${week} (${result.slotsScored} slots scored, ${result.matchupsUpdated} matchups updated)`,
    });

    return NextResponse.json({ success: true, week, calculate: result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Recalculate failed";
    console.error("Manual score recalculate error:", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
