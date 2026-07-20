import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

// POST /api/admin/leagues/[leagueId]/reorder-teams - Reorder all teams' draft positions at once
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ leagueId: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user || session.user.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { leagueId } = await params;
    const body = await request.json();
    const { teamOrders } = body; // Array of { teamId, draftPosition }

    if (!Array.isArray(teamOrders) || teamOrders.length === 0) {
      return NextResponse.json(
        { error: "teamOrders array is required" },
        { status: 400 }
      );
    }

    // Validate all teams belong to the league
    const league = await prisma.fantasyLeague.findUnique({
      where: { id: leagueId },
      include: {
        fantasyTeams: true,
      },
    });

    if (!league) {
      return NextResponse.json({ error: "League not found" }, { status: 404 });
    }

    // Draft position only matters before the draft actually starts —
    // initialize-draft snapshots it into each DraftPick's team assignment,
    // and draft-completion seeds waiver priority from it too. Reordering
    // after either of those has happened desyncs the displayed order from
    // the picks/priority that already got generated from the old one.
    if (league.draftStatus !== "not_started") {
      return NextResponse.json(
        { error: "Draft order can only be changed before the draft starts" },
        { status: 400 }
      );
    }

    // Update all teams in a transaction
    await prisma.$transaction(
      teamOrders.map(({ teamId, draftPosition }) =>
        prisma.fantasyTeam.update({
          where: { id: teamId },
          data: { draftPosition: parseInt(draftPosition) },
        })
      )
    );

    return NextResponse.json({ success: true, message: "Draft order updated" });
  } catch (error) {
    console.error("Error reordering teams:", error);
    return NextResponse.json(
      { error: "Failed to reorder teams" },
      { status: 500 }
    );
  }
}
