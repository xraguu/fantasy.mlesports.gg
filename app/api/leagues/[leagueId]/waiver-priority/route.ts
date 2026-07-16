import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { runWaiverProcessingSweep } from "@/lib/waiverProcessing";

/**
 * GET /api/leagues/[leagueId]/waiver-priority
 * The full waiver priority order (rolling/fixed) or FAAB budgets, for every
 * team in the league — backs the My Roster "Waivers" tab's league-wide view.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ leagueId: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { leagueId } = await params;
    await runWaiverProcessingSweep(leagueId);

    const league = await prisma.fantasyLeague.findUnique({
      where: { id: leagueId },
      select: {
        waiverSystem: true,
        fantasyTeams: {
          select: {
            id: true,
            displayName: true,
            waiverPriority: true,
            faabRemaining: true,
            owner: { select: { displayName: true } },
          },
        },
      },
    });

    if (!league) {
      return NextResponse.json({ error: "League not found" }, { status: 404 });
    }

    const teams = league.fantasyTeams
      .map((t) => ({
        id: t.id,
        teamName: t.displayName,
        managerName: t.owner.displayName,
        waiverPriority: t.waiverPriority,
        faabRemaining: t.faabRemaining,
      }))
      .sort((a, b) =>
        league.waiverSystem === "faab"
          ? (b.faabRemaining ?? 0) - (a.faabRemaining ?? 0)
          : (a.waiverPriority ?? 999) - (b.waiverPriority ?? 999)
      );

    return NextResponse.json({ waiverSystem: league.waiverSystem, teams });
  } catch (error) {
    console.error("Error fetching waiver priority:", error);
    return NextResponse.json(
      { error: "Failed to fetch waiver priority" },
      { status: 500 }
    );
  }
}
