import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { logAdminActivity } from "@/lib/adminActivity";
import { generateDraftPickOrder } from "@/lib/draftPickOrder";

// POST /api/admin/leagues/[leagueId]/initialize-draft - Initialize draft picks for the league
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

    // Get league with teams
    const league = await prisma.fantasyLeague.findUnique({
      where: { id: leagueId },
      include: {
        fantasyTeams: {
          orderBy: { draftPosition: "asc" },
        },
        draftPicks: true,
      },
    });

    if (!league) {
      return NextResponse.json({ error: "League not found" }, { status: 404 });
    }

    // Check if teams have draft positions assigned
    const teamsWithoutPosition = league.fantasyTeams.filter(
      (team) => team.draftPosition === null
    );

    if (teamsWithoutPosition.length > 0) {
      return NextResponse.json(
        { error: "All teams must have draft positions assigned before initializing draft" },
        { status: 400 }
      );
    }

    // Check if draft picks already exist
    if (league.draftPicks.length > 0) {
      return NextResponse.json(
        { error: "Draft picks already initialized for this league" },
        { status: 400 }
      );
    }

    const numTeams = league.fantasyTeams.length;
    if (numTeams === 0) {
      return NextResponse.json(
        { error: "Cannot initialize draft with no teams" },
        { status: 400 }
      );
    }

    // Calculate number of rounds (8 teams per fantasy team based on default roster config)
    const rosterConfig = league.rosterConfig as any;
    const totalRosterSlots =
      (rosterConfig["2s"] || 0) +
      (rosterConfig["3s"] || 0) +
      (rosterConfig["flx"] || 0) +
      (rosterConfig["be"] || 0);
    const numRounds = totalRosterSlots;

    // Generate draft picks
    const draftPicks = generateDraftPickOrder(league.fantasyTeams, league.draftType, numRounds).map(
      (entry) => ({
        fantasyLeagueId: leagueId,
        round: entry.round,
        pickNumber: entry.pickNumber,
        overallPick: entry.overallPick,
        fantasyTeamId: entry.fantasyTeamId,
        mleTeamId: null,
        pickedAt: null,
      })
    );

    // Create all draft picks and start the draft
    const pickTimeSeconds = league.draftPickTimeSeconds || 90;
    const firstPickDeadline = new Date(Date.now() + pickTimeSeconds * 1000);

    await prisma.$transaction([
      prisma.draftPick.createMany({
        data: draftPicks,
      }),
      prisma.fantasyLeague.update({
        where: { id: leagueId },
        data: {
          draftStatus: "in_progress",
          draftPickDeadline: firstPickDeadline,
        },
      }),
    ]);

    await logAdminActivity({
      adminUserId: session.user.id!,
      action: "draft.start",
      description: `Started draft for league "${league.name}" (${numRounds} rounds x ${numTeams} teams)`,
      targetType: "FantasyLeague",
      targetId: leagueId,
    });

    return NextResponse.json({
      success: true,
      message: "Draft started!",
      picksCreated: draftPicks.length,
      firstPickDeadline,
    });
  } catch (error) {
    console.error("Error initializing draft:", error);
    return NextResponse.json(
      { error: "Failed to initialize draft" },
      { status: 500 }
    );
  }
}
