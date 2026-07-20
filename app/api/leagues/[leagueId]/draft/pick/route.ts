import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { executeDraftPick } from "@/lib/draftPick";

/**
 * POST /api/leagues/[leagueId]/draft/pick
 * Submit a draft pick
 * Body: { mleTeamId: string }
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ leagueId: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { leagueId } = await params;
    const body = await req.json();
    const { mleTeamId } = body;

    if (!mleTeamId) {
      return NextResponse.json(
        { error: "mleTeamId is required" },
        { status: 400 }
      );
    }

    // Get the league and draft state
    const league = await prisma.fantasyLeague.findUnique({
      where: { id: leagueId },
      include: {
        fantasyTeams: {
          where: {
            ownerUserId: session.user.id,
          },
        },
        draftPicks: {
          orderBy: {
            overallPick: "asc",
          },
        },
      },
    });

    if (!league) {
      return NextResponse.json(
        { error: "Fantasy league not found" },
        { status: 404 }
      );
    }

    const draftStatus = (league as any).draftStatus || "not_started";
    if (draftStatus !== "in_progress") {
      return NextResponse.json(
        { error: "Draft is not currently in progress" },
        { status: 400 }
      );
    }

    // Find current pick
    const currentPick = league.draftPicks.find((pick) => !pick.pickedAt);
    if (!currentPick) {
      return NextResponse.json(
        { error: "No picks remaining" },
        { status: 400 }
      );
    }

    // Get user's fantasy team in this league
    const userTeam = league.fantasyTeams[0];
    if (!userTeam) {
      return NextResponse.json(
        { error: "You are not in this league" },
        { status: 403 }
      );
    }

    // Check if it's this user's pick
    if (currentPick.fantasyTeamId !== userTeam.id) {
      return NextResponse.json(
        { error: "It is not your turn to pick" },
        { status: 403 }
      );
    }

    // Verify the MLE team exists and hasn't been picked
    const mleTeam = await prisma.mLETeam.findUnique({
      where: { id: mleTeamId },
    });

    if (!mleTeam) {
      return NextResponse.json(
        { error: "MLE team not found" },
        { status: 404 }
      );
    }

    // Check if team is already drafted
    const alreadyPicked = league.draftPicks.some(
      (pick) => pick.mleTeamId === mleTeamId && pick.pickedAt
    );
    if (alreadyPicked) {
      return NextResponse.json(
        { error: "This team has already been drafted" },
        { status: 400 }
      );
    }

    // Also flip autodraft back off — a manual pick means the manager is
    // actively here, so the "autodraft kicked in" label no longer applies.
    await prisma.fantasyTeam.update({
      where: { id: userTeam.id },
      data: { autodraftEnabled: false },
    });

    const { draftCompleted } = await executeDraftPick(leagueId, currentPick.id, mleTeamId);

    return NextResponse.json({
      success: true,
      draftCompleted,
    });
  } catch (error) {
    console.error("Error making draft pick:", error);
    // executeDraftPick throws plain Errors with a user-facing message for
    // expected conflicts (pick already claimed, team already drafted by a
    // race with another pick) — surface those as a 409 so the client can
    // just refetch and let the manager pick again, instead of a generic
    // 500 that reads like the server broke.
    if (
      error instanceof Error &&
      (error.message === "Pick is not available to be made" ||
        error.message === "This team has already been drafted")
    ) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    return NextResponse.json(
      { error: "Failed to make draft pick" },
      { status: 500 }
    );
  }
}
