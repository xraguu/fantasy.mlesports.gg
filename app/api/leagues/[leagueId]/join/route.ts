import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { generateFantasyTeamId } from "@/lib/id-generator";
import { generateAndSaveRegularSeason } from "@/lib/scheduleGenerator";

// POST /api/leagues/[leagueId]/join - Join a fantasy league
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ leagueId: string }> }
) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Check if user is suspended
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { id: true, status: true, displayName: true },
    });

    if (user?.status === "suspended") {
      return NextResponse.json(
        { error: "Suspended users cannot join leagues" },
        { status: 403 }
      );
    }

    if (!user) {
      return NextResponse.json(
        { error: "User not found" },
        { status: 400 }
      );
    }

    const { leagueId } = await params;
    const body = await request.json();
    const { teamName, shortCode } = body;

    // Validation
    if (!teamName || !shortCode) {
      return NextResponse.json(
        { error: "Team name and short code are required" },
        { status: 400 }
      );
    }

    if (shortCode.length < 1 || shortCode.length > 3) {
      return NextResponse.json(
        { error: "Short code must be 1-3 characters" },
        { status: 400 }
      );
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
      (team) => team.ownerUserId === session.user.id
    );

    if (existingTeam) {
      return NextResponse.json(
        { error: "You are already a member of this league" },
        { status: 400 }
      );
    }

    // Check if short code is already taken in this league
    const shortCodeTaken = league.fantasyTeams.some(
      (team) => team.shortCode.toLowerCase() === shortCode.toLowerCase()
    );

    if (shortCodeTaken) {
      return NextResponse.json(
        { error: "Short code is already taken in this league" },
        { status: 400 }
      );
    }

    // Check if team name is already taken in this league
    const nameTaken = league.fantasyTeams.some(
      (team) => team.displayName.toLowerCase() === teamName.trim().toLowerCase()
    );

    if (nameTaken) {
      return NextResponse.json(
        { error: "Team name is already taken in this league" },
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
        ownerUserId: session.user.id,
        displayName: teamName,
        shortCode: shortCode.toUpperCase(),
        draftPosition: league.fantasyTeams.length + 1,
        faabRemaining: league.waiverSystem === "faab" ? league.faabBudget : null,
        waiverPriority: league.waiverSystem !== "faab" ? league.fantasyTeams.length + 1 : null,
      },
      include: {
        owner: {
          select: {
            id: true,
            displayName: true,
            avatarUrl: true,
          },
        },
        league: true,
      },
    });

    // Auto-generate the regular season schedule the moment the league fills up
    if (league.fantasyTeams.length + 1 === league.maxTeams) {
      try {
        await generateAndSaveRegularSeason(leagueId);
      } catch (scheduleError) {
        console.error("Error auto-generating schedule after league filled:", scheduleError);
      }
    }

    return NextResponse.json({ fantasyTeam }, { status: 201 });
  } catch (error) {
    console.error("Error joining league:", error);
    return NextResponse.json(
      { error: "Failed to join league" },
      { status: 500 }
    );
  }
}
