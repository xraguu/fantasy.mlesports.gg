import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { calculateScoresForWeek } from "@/lib/scoringService";
import { logAdminActivity } from "@/lib/adminActivity";
import { runAutoLockSweep } from "@/lib/autoLock";

// Not currently wired to any admin page (recalculate/route.ts is the one
// the UI actually calls) — kept for parity/manual use, but made to match
// its sibling's behavior exactly so it can't silently skip the global
// auto-lock sweep or the admin activity log if it's ever wired up later.
export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user || session.user.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { week, leagueId } = body;

    if (!week) {
      return NextResponse.json({ error: "week is required" }, { status: 400 });
    }

    const weekNum = parseInt(week);
    if (weekNum < 1 || weekNum > 10) {
      return NextResponse.json(
        { error: "week must be between 1 and 10" },
        { status: 400 }
      );
    }

    await runAutoLockSweep();

    const result = await calculateScoresForWeek(
      weekNum,
      leagueId || undefined,
      session.user.id
    );

    await logAdminActivity({
      adminUserId: session.user.id!,
      action: "stats.calculate_scores",
      description: `Calculated scores for week ${weekNum}${leagueId ? ` (league ${leagueId})` : ""} (${result.slotsScored} slots scored, ${result.matchupsUpdated} matchups updated)`,
    });

    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Score calculation failed";
    console.error("Score calculation error:", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
