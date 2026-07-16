import { NextRequest, NextResponse } from "next/server";
import { runStatsRefresh } from "@/lib/statsRefresh";

/**
 * GET /api/cron/refresh-stats
 * The actual automatic schedule lives in-process now (see
 * instrumentation.ts) since this app runs as a long-lived Docker container
 * on a droplet, not Vercel — there's no external cron platform calling this
 * route. Left in place as a manually-triggerable endpoint (e.g. an external
 * monitor, or a droplet crontab curl as a belt-and-suspenders backup).
 *
 * Protected by CRON_SECRET if it's set (`Authorization: Bearer $CRON_SECRET`)
 * — if the env var isn't set, the route still works (useful for local
 * testing) but logs a warning since it's then an unauthenticated public
 * endpoint.
 */
export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const authHeader = request.headers.get("authorization");
    if (authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  } else {
    console.warn(
      "CRON_SECRET is not set — /api/cron/refresh-stats is running without authentication."
    );
  }

  try {
    const result = await runStatsRefresh();
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Refresh failed";
    console.error("Scheduled stats refresh failed:", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
