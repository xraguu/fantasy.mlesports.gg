import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { logAdminActivity } from "@/lib/adminActivity";
import { initializeWaiverPriorityFromDraftOrder } from "@/lib/waiverPriority";

// POST /api/admin/leagues/[leagueId]/skip-draft
// For leagues that drafted outside the website — marks the draft as
// complete with no DraftPick rows, so the post-draft admin roster tools
// (Edit Roster) become available immediately without running a live draft.
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

    const league = await prisma.fantasyLeague.findUnique({
      where: { id: leagueId },
      include: { draftPicks: true },
    });

    if (!league) {
      return NextResponse.json({ error: "League not found" }, { status: 404 });
    }

    if (league.draftPicks.length > 0 || league.draftStatus === "in_progress") {
      return NextResponse.json(
        { error: "Draft has already started for this league — can't skip it now" },
        { status: 400 }
      );
    }

    await prisma.fantasyLeague.update({
      where: { id: leagueId },
      data: { draftStatus: "completed", draftPickDeadline: null },
    });
    await initializeWaiverPriorityFromDraftOrder(leagueId);

    await logAdminActivity({
      adminUserId: session.user.id!,
      action: "draft.skip",
      description: `Skipped the in-app draft for league "${league.name}" — drafted outside the website`,
      targetType: "FantasyLeague",
      targetId: leagueId,
    });

    return NextResponse.json({ success: true, message: "Draft skipped. Use Edit Roster to build out managers' rosters." });
  } catch (error) {
    console.error("Error skipping draft:", error);
    return NextResponse.json({ error: "Failed to skip draft" }, { status: 500 });
  }
}
