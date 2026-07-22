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

    const leagueTeamIds = new Set(league.fantasyTeams.map((t) => t.id));
    for (const { teamId } of teamOrders) {
      if (!leagueTeamIds.has(teamId)) {
        return NextResponse.json(
          { error: "One or more teams don't belong to this league" },
          { status: 400 }
        );
      }
    }

    // Two-phase update: `@@unique([fantasyLeagueId, draftPosition])` means
    // any reorder that moves more than one team (i.e. every real reorder,
    // since dragging one team shifts the rest) will try to assign a
    // position another team in this same batch still holds at that instant
    // — e.g. swapping positions 1 and 2 fails the moment team A is set to
    // 2 while team B still sits at 2. Stage everyone onto guaranteed-unique
    // negative placeholders first, then apply the real positions, all
    // inside one transaction so a failure can't leave the league half-reordered.
    await prisma.$transaction(async (tx) => {
      let placeholder = 0;
      for (const { teamId } of teamOrders) {
        placeholder -= 1;
        await tx.fantasyTeam.update({
          where: { id: teamId },
          data: { draftPosition: placeholder },
        });
      }
      for (const { teamId, draftPosition } of teamOrders) {
        await tx.fantasyTeam.update({
          where: { id: teamId },
          data: { draftPosition: parseInt(draftPosition) },
        });
      }
    });

    return NextResponse.json({ success: true, message: "Draft order updated" });
  } catch (error) {
    console.error("Error reordering teams:", error);
    return NextResponse.json(
      { error: "Failed to reorder teams" },
      { status: 500 }
    );
  }
}
