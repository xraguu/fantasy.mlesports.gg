import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/admin/database/status
 * Real table counts + database size for the admin Database Tools page.
 */
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user || session.user.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const [
      users,
      fantasyLeagues,
      fantasyTeams,
      mleTeams,
      mlePlayers,
      rosterSlots,
      waiverClaims,
      trades,
      matchups,
      transactions,
      sizeResult,
    ] = await Promise.all([
      prisma.user.count(),
      prisma.fantasyLeague.count(),
      prisma.fantasyTeam.count(),
      prisma.mLETeam.count(),
      prisma.mLEPlayer.count(),
      prisma.rosterSlot.count(),
      prisma.waiverClaim.count(),
      prisma.trade.count(),
      prisma.matchup.count(),
      prisma.transaction.count(),
      prisma.$queryRaw<{ size: string }[]>`SELECT pg_size_pretty(pg_database_size(current_database())) as size`,
    ]);

    const tables = {
      users,
      fantasyLeagues,
      fantasyTeams,
      mleTeams,
      mlePlayers,
      rosterSlots,
      waiverClaims,
      trades,
      matchups,
      transactions,
    };

    return NextResponse.json({
      status: "connected",
      size: sizeResult[0]?.size ?? "unknown",
      tables,
      totalRecords: Object.values(tables).reduce((a, b) => a + b, 0),
    });
  } catch (error) {
    console.error("Error fetching database status:", error);
    return NextResponse.json(
      { status: "error", error: "Failed to fetch database status" },
      { status: 500 }
    );
  }
}
