import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { generateFantasyTeamId } from "@/lib/id-generator";
import { logAdminActivity } from "@/lib/adminActivity";
import { generateAndSaveRegularSeason } from "@/lib/scheduleGenerator";

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
    const { userId, teamName, shortCode } = body;

    // Validation
    if (!userId || !teamName || !shortCode) {
      return NextResponse.json(
        { error: "userId, teamName, and shortCode are required" },
        { status: 400 }
      );
    }

    if (shortCode.length < 1 || shortCode.length > 3) {
      return NextResponse.json(
        { error: "Short code must be 1-3 characters" },
        { status: 400 }
      );
    }

    // Check if user exists
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true },
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

    // Check if short code is already taken
    const shortCodeTaken = league.fantasyTeams.some(
      (team) => team.shortCode.toLowerCase() === shortCode.toLowerCase()
    );

    if (shortCodeTaken) {
      return NextResponse.json(
        { error: "Short code is already taken in this league" },
        { status: 400 }
      );
    }

    // Generate custom team ID
    const teamId = generateFantasyTeamId(leagueId, user.id);

    // Create the fantasy team
    const fantasyTeam = await prisma.fantasyTeam.create({
      data: {
        id: teamId,
        fantasyLeagueId: leagueId,
        ownerUserId: userId,
        displayName: teamName,
        shortCode: shortCode.toUpperCase(),
        draftPosition: league.fantasyTeams.length + 1,
        faabRemaining: league.waiverSystem === "faab" ? league.faabBudget : null,
        waiverPriority:
          league.waiverSystem !== "faab" ? league.fantasyTeams.length + 1 : null,
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
