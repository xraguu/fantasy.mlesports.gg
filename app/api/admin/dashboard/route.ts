import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { processExpiredTradeVetoWindows } from "@/lib/tradeExecution";

/**
 * GET /api/admin/dashboard
 * Real stat totals for the admin dashboard quick-stats row.
 */
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user || session.user.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    await processExpiredTradeVetoWindows();

    const [totalLeagues, activeManagers, pendingWaivers, pendingTrades, latestSeasonSettings] =
      await Promise.all([
        prisma.fantasyLeague.count(),
        prisma.user.count({
          where: { status: "active", fantasyTeams: { some: {} } },
        }),
        prisma.waiverClaim.count({ where: { status: "pending" } }),
        prisma.trade.count({ where: { status: { in: ["pending", "awaiting_veto"] } } }),
        prisma.seasonSettings.findFirst({ orderBy: { season: "desc" } }),
      ]);

    return NextResponse.json({
      totalLeagues,
      activeManagers,
      currentWeek: latestSeasonSettings?.currentWeek ?? null,
      pendingTransactions: pendingWaivers + pendingTrades,
    });
  } catch (error) {
    console.error("Error fetching admin dashboard stats:", error);
    return NextResponse.json(
      { error: "Failed to fetch dashboard stats" },
      { status: 500 }
    );
  }
}
