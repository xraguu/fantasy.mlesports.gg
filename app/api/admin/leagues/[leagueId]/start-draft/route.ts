import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { logAdminActivity } from "@/lib/adminActivity";

// POST /api/admin/leagues/[leagueId]/start-draft - Start the draft
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

    // Get league with draft picks
    const league = await prisma.fantasyLeague.findUnique({
      where: { id: leagueId },
      include: {
        draftPicks: {
          orderBy: { overallPick: "asc" },
        },
        fantasyTeams: true,
      },
    });

    if (!league) {
      return NextResponse.json({ error: "League not found" }, { status: 404 });
    }

    // Check if draft picks have been initialized
    if (league.draftPicks.length === 0) {
      return NextResponse.json(
        { error: "Draft picks must be initialized before starting the draft" },
        { status: 400 }
      );
    }

    // Check if draft is already started
    if (league.draftStatus === "in_progress") {
      return NextResponse.json(
        { error: "Draft is already in progress" },
        { status: 400 }
      );
    }

    if (league.draftStatus === "completed") {
      return NextResponse.json(
        { error: "Draft has already been completed" },
        { status: 400 }
      );
    }

    // Check if all teams have draft positions
    const teamsWithoutPosition = league.fantasyTeams.filter(
      (team) => team.draftPosition === null
    );

    if (teamsWithoutPosition.length > 0) {
      return NextResponse.json(
        { error: "All teams must have draft positions assigned before starting" },
        { status: 400 }
      );
    }

    // Set initial pick deadline
    const pickTimeSeconds = league.draftPickTimeSeconds || 90;
    const firstPickDeadline = new Date(Date.now() + pickTimeSeconds * 1000);

    // Update league to start draft
    const updatedLeague = await prisma.fantasyLeague.update({
      where: { id: leagueId },
      data: {
        draftStatus: "in_progress",
        draftPickDeadline: firstPickDeadline,
      },
    });

    await logAdminActivity({
      adminUserId: session.user.id!,
      action: "draft.start",
      description: `Started draft for league "${updatedLeague.name}"`,
      targetType: "FantasyLeague",
      targetId: leagueId,
    });

    return NextResponse.json({
      success: true,
      message: "Draft started successfully!",
      league: updatedLeague,
      firstPickDeadline,
    });
  } catch (error) {
    console.error("Error starting draft:", error);
    return NextResponse.json(
      { error: "Failed to start draft" },
      { status: 500 }
    );
  }
}
