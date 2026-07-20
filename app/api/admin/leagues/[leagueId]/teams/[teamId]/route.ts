import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { logAdminActivity } from "@/lib/adminActivity";

// DELETE /api/admin/leagues/[leagueId]/teams/[teamId] - Remove a team from the league (admin only)
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ leagueId: string; teamId: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user || session.user.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { leagueId, teamId } = await params;

    // Check if team exists and belongs to the league
    const team = await prisma.fantasyTeam.findUnique({
      where: { id: teamId },
      include: {
        roster: true,
        homeMatchups: true,
        awayMatchups: true,
        waiverClaims: true,
        proposedTrades: true,
        receivedTrades: true,
      },
    });

    if (!team) {
      return NextResponse.json({ error: "Team not found" }, { status: 404 });
    }

    if (team.fantasyLeagueId !== leagueId) {
      return NextResponse.json(
        { error: "Team does not belong to this league" },
        { status: 400 }
      );
    }

    // A Matchup row belongs to BOTH teams in it — unconditionally deleting
    // every matchup this team was ever part of (the old behavior) also
    // erases that week's result for whichever opponent it played, silently
    // shrinking the opponent's win/loss record and points for/against for
    // weeks that already happened, even though the opponent isn't the one
    // being removed. Once any of this team's matchups actually has a
    // recorded score, this route refuses to proceed rather than corrupt
    // that history — there's no way to remove just this team's side of an
    // already-played matchup without a schema change to make homeTeamId/
    // awayTeamId nullable. Matchups that haven't been played yet (no score
    // on either side) are unaffected by this and still get cleaned up
    // below, same as before.
    const hasPlayedMatchup = [...team.homeMatchups, ...team.awayMatchups].some(
      (m) => m.homeScore !== null || m.awayScore !== null
    );
    if (hasPlayedMatchup) {
      return NextResponse.json(
        {
          error:
            "This team has already-played matchups. Removing it would delete those results and corrupt its opponents' win/loss records and points for/against for weeks that already happened. Remove it before its season starts, or leave it in the league instead.",
        },
        { status: 400 }
      );
    }

    // Delete all related data first (due to foreign key constraints)
    await prisma.$transaction([
      // Delete roster slots
      prisma.rosterSlot.deleteMany({
        where: { fantasyTeamId: teamId },
      }),
      // Delete waiver claims
      prisma.waiverClaim.deleteMany({
        where: { fantasyTeamId: teamId },
      }),
      // Delete trades (both proposed and received)
      prisma.trade.deleteMany({
        where: {
          OR: [{ proposerTeamId: teamId }, { receiverTeamId: teamId }],
        },
      }),
      // Delete matchups (both home and away) — only ever unplayed ones by
      // the time we get here, per the guard above.
      prisma.matchup.deleteMany({
        where: {
          OR: [{ homeTeamId: teamId }, { awayTeamId: teamId }],
        },
      }),
      // Delete draft picks assigned to this team
      prisma.draftPick.updateMany({
        where: { fantasyTeamId: teamId },
        data: { fantasyTeamId: null, mleTeamId: null, pickedAt: null },
      }),
      // Finally delete the team
      prisma.fantasyTeam.delete({
        where: { id: teamId },
      }),
    ]);

    await logAdminActivity({
      adminUserId: session.user.id!,
      action: "team.remove",
      description: `Removed team "${team.displayName}" (${team.shortCode}) from a league`,
      targetType: "FantasyTeam",
      targetId: teamId,
    });

    return NextResponse.json({ success: true, message: "Team removed successfully" });
  } catch (error) {
    console.error("Error removing team from league:", error);
    return NextResponse.json(
      { error: "Failed to remove team from league" },
      { status: 500 }
    );
  }
}

// PATCH /api/admin/leagues/[leagueId]/teams/[teamId] - Update team details (admin only)
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ leagueId: string; teamId: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user || session.user.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { leagueId, teamId } = await params;
    const body = await request.json();
    const { draftPosition } = body;

    // Check if team exists and belongs to the league
    const team = await prisma.fantasyTeam.findUnique({
      where: { id: teamId },
    });

    if (!team) {
      return NextResponse.json({ error: "Team not found" }, { status: 404 });
    }

    if (team.fantasyLeagueId !== leagueId) {
      return NextResponse.json(
        { error: "Team does not belong to this league" },
        { status: 400 }
      );
    }

    // Prepare update data
    const updateData: any = {};

    if (draftPosition !== undefined) {
      updateData.draftPosition = parseInt(draftPosition);
    }

    // Update the team
    const updatedTeam = await prisma.fantasyTeam.update({
      where: { id: teamId },
      data: updateData,
      include: {
        owner: {
          select: {
            id: true,
            displayName: true,
            avatarUrl: true,
          },
        },
      },
    });

    return NextResponse.json({ fantasyTeam: updatedTeam, success: true });
  } catch (error) {
    console.error("Error updating team:", error);
    return NextResponse.json(
      { error: "Failed to update team" },
      { status: 500 }
    );
  }
}
