import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { generateFantasyTeamId } from "@/lib/id-generator";
import { logAdminActivity } from "@/lib/adminActivity";
import { generateAndSaveRegularSeason } from "@/lib/scheduleGenerator";
import { uniqueShortCode, uniqueTeamName } from "@/lib/teamNaming";

// POST /api/admin/leagues/[leagueId]/teams - Add a user to the league (admin only)
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
    const { userId } = body;

    // Validation
    if (!userId) {
      return NextResponse.json(
        { error: "userId is required" },
        { status: 400 }
      );
    }

    // Check if user exists
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, displayName: true },
    });

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // Check if league exists
    const league = await prisma.fantasyLeague.findUnique({
      where: { id: leagueId },
      include: {
        fantasyTeams: true,
      },
    });

    if (!league) {
      return NextResponse.json({ error: "League not found" }, { status: 404 });
    }

    // Check if league is full
    if (league.fantasyTeams.length >= league.maxTeams) {
      return NextResponse.json(
        { error: "League is full" },
        { status: 400 }
      );
    }

    // Check if user is already in the league
    const existingTeam = league.fantasyTeams.find(
      (team) => team.ownerUserId === userId
    );

    if (existingTeam) {
      return NextResponse.json(
        { error: "User is already a member of this league" },
        { status: 400 }
      );
    }

    const takenShortCodes = new Set(
      league.fantasyTeams.map((t) => t.shortCode.toLowerCase())
    );
    const takenNames = new Set(
      league.fantasyTeams.map((t) => t.displayName.toLowerCase())
    );
    const teamName = uniqueTeamName(user.displayName, takenNames);
    const shortCode = uniqueShortCode(user.displayName, takenShortCodes);

    // Generate custom team ID
    const teamId = generateFantasyTeamId(leagueId, user.id);

    // Lowest open draftPosition/waiverPriority, not just count + 1 — a
    // league that's had a manager removed has a GAP in that sequence (the
    // remaining teams never get renumbered), and count + 1 can land on a
    // position an existing team still occupies, violating the (league,
    // draftPosition) unique constraint and failing the add outright.
    const usedDraftPositions = new Set(
      league.fantasyTeams.map((t) => t.draftPosition).filter((p): p is number => p != null)
    );
    const usedWaiverPriorities = new Set(
      league.fantasyTeams.map((t) => t.waiverPriority).filter((p): p is number => p != null)
    );
    function nextOpenSlot(used: Set<number>): number {
      let pos = 1;
      while (used.has(pos)) pos++;
      return pos;
    }

    // Create the fantasy team
    const fantasyTeam = await prisma.fantasyTeam.create({
      data: {
        id: teamId,
        fantasyLeagueId: leagueId,
        ownerUserId: userId,
        displayName: teamName,
        shortCode,
        draftPosition: nextOpenSlot(usedDraftPositions),
        faabRemaining: league.waiverSystem === "faab" ? league.faabBudget : null,
        // Every waiver system uses this now — for rolling/fixed it's the
        // real claim order, for FAAB it's the tiebreaker between equal bids
        // (see resetWaiverPriorityToReverseStandings in lib/waiverPriority.ts).
        waiverPriority: nextOpenSlot(usedWaiverPriorities),
      },
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

    await logAdminActivity({
      adminUserId: session.user.id!,
      action: "team.add",
      description: `Added manager "${fantasyTeam.owner.displayName}" as "${fantasyTeam.displayName}" (${fantasyTeam.shortCode}) to league "${league.name}"`,
      targetType: "FantasyTeam",
      targetId: fantasyTeam.id,
    });

    if (league.fantasyTeams.length + 1 === league.maxTeams) {
      try {
        await generateAndSaveRegularSeason(leagueId);
      } catch (scheduleError) {
        console.error("Error auto-generating schedule after league filled:", scheduleError);
      }
    }

    return NextResponse.json({ fantasyTeam, success: true }, { status: 201 });
  } catch (error) {
    console.error("Error adding user to league:", error);
    return NextResponse.json(
      { error: "Failed to add user to league" },
      { status: 500 }
    );
  }
}
